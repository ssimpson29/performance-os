import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const updateSoul = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/lib/profile/soul-writer', () => ({ updateSoul }));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/souls', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('PATCH /api/souls', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 when not signed in', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { PATCH } = await import('../app/api/souls/route');
    const res = await PATCH(makeRequest({ kind: 'training', content: 'hi' }));
    expect(res.status).toBe(401);
  });

  it.each([
    [{ kind: 'wrong', content: 'x' }, /kind/],
    [{ kind: 'training', content: 42 }, /content/],
    [{ content: 'no kind' }, /kind/],
  ])('returns 400 on invalid payload %j', async (payload, expectedError) => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    const { PATCH } = await import('../app/api/souls/route');
    const res = await PATCH(makeRequest(payload));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(expectedError);
  });

  it("happy path: writes with updated_by='athlete' and returns the soul", async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    createServerSupabaseClient.mockReturnValue({} as never);
    updateSoul.mockResolvedValue({
      userId: 'user-1',
      kind: 'longevity',
      content: 'attia + saladino frame health.',
      updatedBy: 'athlete',
      updatedAt: '2026-05-23T10:00:00Z',
    });
    const { PATCH } = await import('../app/api/souls/route');
    const res = await PATCH(
      makeRequest({ kind: 'longevity', content: 'attia + saladino frame health.' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.soul.kind).toBe('longevity');
    expect(json.soul.updatedBy).toBe('athlete');
    expect(updateSoul).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
      kind: 'longevity',
      content: 'attia + saladino frame health.',
      updatedBy: 'athlete',
    });
  });
});
