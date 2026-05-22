import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const extractPanelFromImage = vi.fn();
const matchRawNameToCatalogKey = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/longevity/image-extraction', () => ({
  extractPanelFromImage,
  matchRawNameToCatalogKey,
}));

function makeRequest(file: File | null) {
  const formData = new FormData();
  if (file) formData.set('image', file);
  return new Request('http://localhost/api/imports/biomarker-panel-image', {
    method: 'POST',
    body: formData,
  });
}

function imageFile(mime = 'image/jpeg') {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], 'panel.jpg', { type: mime });
}

describe('POST /api/imports/biomarker-panel-image', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { resetRateLimitStore } = await import('../lib/rate-limit');
    resetRateLimitStore();
    // Default matcher: returns null. Tests override per-call.
    matchRawNameToCatalogKey.mockReturnValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const response = await POST(makeRequest(imageFile()));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(extractPanelFromImage).not.toHaveBeenCalled();
  });

  it("returns 400 when 'image' field is missing", async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const response = await POST(makeRequest(null));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Missing 'image'/) });
  });

  it('returns 400 on unsupported MIME type', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const response = await POST(makeRequest(imageFile('image/gif')));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Unsupported MIME/) });
  });

  it('returns 503 when LLM env is unset (extractor returns null)', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    extractPanelFromImage.mockResolvedValue(null);
    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const response = await POST(makeRequest(imageFile()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Vision LLM is not configured/) });
  });

  it('returns 502 when LLM extraction throws (non-JSON or malformed payload)', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    extractPanelFromImage.mockRejectedValue(new Error('Vision LLM returned non-JSON output'));
    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const response = await POST(makeRequest(imageFile()));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/non-JSON/) });
  });

  it('happy path: matches catalog keys, flags unit mismatches + unmatched markers as warnings, does NOT save', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    extractPanelFromImage.mockResolvedValue({
      panelDate: '2026-05-01',
      provider: 'Quest',
      panelName: 'Annual',
      markers: [
        { rawName: 'Apolipoprotein B', value: 80, unit: 'mg/dL' },
        { rawName: 'LDL Cholesterol', value: 2.5, unit: 'mmol/L' }, // unit mismatch
        { rawName: 'Sodium', value: 140, unit: 'mmol/L' }, // unmatched
      ],
    });
    matchRawNameToCatalogKey.mockImplementation((name: string) => {
      if (name === 'Apolipoprotein B') return 'apob';
      if (name === 'LDL Cholesterol') return 'ldl_c';
      return null;
    });

    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const response = await POST(makeRequest(imageFile()));
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      panelDate: string | null;
      markers: Array<{
        rawName: string;
        markerKey: string | null;
        inCatalog: boolean;
        unitMatchesCanonical: boolean;
      }>;
      warnings: string[];
    };

    expect(data.panelDate).toBe('2026-05-01');
    expect(data.markers).toHaveLength(3);

    const apob = data.markers.find((m) => m.rawName === 'Apolipoprotein B')!;
    expect(apob.markerKey).toBe('apob');
    expect(apob.inCatalog).toBe(true);
    expect(apob.unitMatchesCanonical).toBe(true);

    const ldl = data.markers.find((m) => m.rawName === 'LDL Cholesterol')!;
    expect(ldl.markerKey).toBe('ldl_c');
    expect(ldl.unitMatchesCanonical).toBe(false);

    const sodium = data.markers.find((m) => m.rawName === 'Sodium')!;
    expect(sodium.markerKey).toBeNull();
    expect(sodium.inCatalog).toBe(false);

    // Warnings include both unit-mismatch and unmatched marker.
    expect(data.warnings.some((w) => /Convert before saving/.test(w))).toBe(true);
    expect(data.warnings.some((w) => /Sodium/.test(w))).toBe(true);
  });

  it('flags missing panel date as a warning', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    extractPanelFromImage.mockResolvedValue({
      panelDate: null,
      provider: null,
      panelName: null,
      markers: [{ rawName: 'Apolipoprotein B', value: 80, unit: 'mg/dL' }],
    });
    matchRawNameToCatalogKey.mockReturnValue('apob');
    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const response = await POST(makeRequest(imageFile()));
    const data = (await response.json()) as { warnings: string[] };
    expect(data.warnings.some((w) => /panel date/i.test(w))).toBe(true);
  });
});


describe('POST /api/imports/biomarker-panel-image — limits', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { resetRateLimitStore } = await import('../lib/rate-limit');
    resetRateLimitStore();
  });

  it('returns 413 when the image exceeds the 10MB ceiling', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    // Build a File whose .size exceeds the ceiling without actually allocating
    // 10MB of bytes — File reads .size from the provided buffer length, so we
    // need to actually allocate. Use a Uint8Array of 11MB.
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    const formData = new FormData();
    formData.set('image', big);
    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const response = await POST(new Request('http://localhost/api/imports/biomarker-panel-image', { method: 'POST', body: formData }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/upload limit/) });
    expect(extractPanelFromImage).not.toHaveBeenCalled();
  });

  it('rate-limits per user after 3 calls/minute', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    extractPanelFromImage.mockResolvedValue({
      panelDate: '2026-05-01', provider: null, panelName: null,
      markers: [{ rawName: 'Apolipoprotein B', value: 80, unit: 'mg/dL' }],
    });
    matchRawNameToCatalogKey.mockReturnValue('apob');
    const { POST } = await import('../app/api/imports/biomarker-panel-image/route');
    const makeReq = () => {
      const f = new FormData();
      f.set('image', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' }));
      return new Request('http://localhost/api/imports/biomarker-panel-image', { method: 'POST', body: f });
    };

    const a = await POST(makeReq());
    const b = await POST(makeReq());
    const c = await POST(makeReq());
    const d = await POST(makeReq());

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(200);
    expect(d.status).toBe(429);
    expect(d.headers.get('Retry-After')).toBeTruthy();
  });
});
