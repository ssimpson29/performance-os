import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const upsertAthleteProfile = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/lib/profile/profile-writer', () => ({ upsertAthleteProfile }));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('PATCH /api/profile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 when not signed in', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { PATCH } = await import('../app/api/profile/route');
    const res = await PATCH(makeRequest({ heightCm: 180 }));
    expect(res.status).toBe(401);
    expect(upsertAthleteProfile).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    const { PATCH } = await import('../app/api/profile/route');
    const res = await PATCH(makeRequest('{not-json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    const { PATCH } = await import('../app/api/profile/route');
    const res = await PATCH(makeRequest('"a string"'));
    expect(res.status).toBe(400);
  });

  it('happy path: upserts profile and returns it', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    createServerSupabaseClient.mockReturnValue({} as never);
    upsertAthleteProfile.mockResolvedValue({
      userId: 'user-1',
      heightCm: 182,
      primaryGoal: 'Boston BQ',
    });
    const { PATCH } = await import('../app/api/profile/route');
    const res = await PATCH(makeRequest({ heightCm: 182, primaryGoal: 'Boston BQ' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.profile.heightCm).toBe(182);
    expect(upsertAthleteProfile).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.objectContaining({ heightCm: 182, primaryGoal: 'Boston BQ' }),
    );
  });
});
