import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const loadAthleteContext = vi.fn();
const runLongevityChat = vi.fn();
const persistLongevityChatRun = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/lib/agents/athlete-context', () => ({ loadAthleteContext }));
vi.mock('@/lib/agents/longevity-chat', () => ({
  runLongevityChat,
  persistLongevityChatRun,
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/longevity/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/longevity/message', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { resetRateLimitStore } = await import('../lib/rate-limit');
    resetRateLimitStore();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 when not signed in', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { POST } = await import('../app/api/longevity/message/route');
    const res = await POST(makeRequest({ message: 'hi' }));
    expect(res.status).toBe(401);
    expect(loadAthleteContext).not.toHaveBeenCalled();
    expect(runLongevityChat).not.toHaveBeenCalled();
  });

  it('happy path: loads context, runs chat, persists, returns shape', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    createServerSupabaseClient.mockReturnValue({} as never);
    loadAthleteContext.mockResolvedValue({ userId: 'user-1', today: '2026-05-23' });
    runLongevityChat.mockResolvedValue({
      message: 'Your apoB is 80 mg/dL — Attia-framing target is <70.',
      conversation: [
        { role: 'athlete', text: 'what about apoB?', at: '2026-05-23T10:00:00Z' },
        { role: 'guru', text: 'Your apoB is 80 mg/dL — Attia-framing target is <70.', at: '2026-05-23T10:00:01Z' },
      ],
      soulUpdated: false,
      llmInvoked: true,
      toolTrace: [
        { iteration: 0, toolName: 'getRecentBiomarkers', argsPreview: '{}', resultPreview: '...' },
      ],
    });
    persistLongevityChatRun.mockResolvedValue({ summaryId: 'sum-1' });

    const { POST } = await import('../app/api/longevity/message/route');
    const res = await POST(makeRequest({ message: 'what about apoB?' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('apoB');
    expect(json.conversation).toHaveLength(2);
    expect(json.soulUpdated).toBe(false);
    expect(json.llmInvoked).toBe(true);
    expect(json.toolTrace[0].toolName).toBe('getRecentBiomarkers');

    expect(loadAthleteContext).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.objectContaining({ today: expect.any(String) }));
    expect(runLongevityChat).toHaveBeenCalledTimes(1);
    expect(persistLongevityChatRun).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when athlete context load fails', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    createServerSupabaseClient.mockReturnValue({} as never);
    loadAthleteContext.mockRejectedValue(new Error('biomarkers table missing'));

    const { POST } = await import('../app/api/longevity/message/route');
    const res = await POST(makeRequest({ message: 'hello' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/biomarkers table missing/);
    expect(runLongevityChat).not.toHaveBeenCalled();
  });

  it('persistence failure is non-fatal — message still returns', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    createServerSupabaseClient.mockReturnValue({} as never);
    loadAthleteContext.mockResolvedValue({ userId: 'user-1', today: '2026-05-23' });
    runLongevityChat.mockResolvedValue({
      message: 'reply',
      conversation: [{ role: 'guru', text: 'reply', at: '2026-05-23T10:00:00Z' }],
      soulUpdated: false,
      llmInvoked: true,
      toolTrace: [],
    });
    persistLongevityChatRun.mockRejectedValue(new Error('write failed'));

    const { POST } = await import('../app/api/longevity/message/route');
    const res = await POST(makeRequest({ message: 'hi' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('reply');
  });
});
