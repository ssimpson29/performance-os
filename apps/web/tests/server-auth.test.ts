import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookiesMock = vi.fn();
const createServerClientMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}));

function mockSupabaseGetUserResult(result: { data?: { user: unknown }; error?: unknown }) {
  const getUser = vi.fn().mockResolvedValue(result);
  createServerClientMock.mockReturnValue({
    auth: { getUser },
  });
  return { getUser };
}

describe('server-auth primitives', () => {
  const originalEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };

  beforeEach(() => {
    vi.resetModules();
    cookiesMock.mockReset();
    createServerClientMock.mockReset();
    cookiesMock.mockResolvedValue({
      getAll: () => [{ name: 'sb-token', value: 'irrelevant-for-mocking' }],
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  });

  afterEach(() => {
    if (originalEnv.url === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv.url;
    }
    if (originalEnv.publishable === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalEnv.publishable;
    }
  });

  it('getAuthenticatedUser returns the user when supabase resolves a session', async () => {
    mockSupabaseGetUserResult({ data: { user: { id: 'user-1', email: 'a@b.com' } } });

    const { getAuthenticatedUser } = await import('../lib/server-auth');
    const user = await getAuthenticatedUser();

    expect(user).toEqual({ id: 'user-1', email: 'a@b.com' });
  });

  it('getAuthenticatedUser returns null when supabase reports an auth error', async () => {
    mockSupabaseGetUserResult({ error: { message: 'Auth session missing!' } });

    const { getAuthenticatedUser } = await import('../lib/server-auth');
    const user = await getAuthenticatedUser();

    expect(user).toBeNull();
  });

  it('getAuthenticatedUser returns null when supabase resolves no user', async () => {
    mockSupabaseGetUserResult({ data: { user: null } });

    const { getAuthenticatedUser } = await import('../lib/server-auth');
    const user = await getAuthenticatedUser();

    expect(user).toBeNull();
  });

  it('getAuthenticatedUserId returns the id when authenticated', async () => {
    mockSupabaseGetUserResult({ data: { user: { id: 'user-42' } } });

    const { getAuthenticatedUserId } = await import('../lib/server-auth');
    const id = await getAuthenticatedUserId();

    expect(id).toBe('user-42');
  });

  it('getAuthenticatedUserId returns null when not authenticated', async () => {
    mockSupabaseGetUserResult({ data: { user: null } });

    const { getAuthenticatedUserId } = await import('../lib/server-auth');
    const id = await getAuthenticatedUserId();

    expect(id).toBeNull();
  });

  it('passes cookie store getAll through to supabase ssr client', async () => {
    mockSupabaseGetUserResult({ data: { user: null } });

    const { getAuthenticatedUser } = await import('../lib/server-auth');
    await getAuthenticatedUser();

    expect(createServerClientMock).toHaveBeenCalledTimes(1);
    const [url, key, options] = createServerClientMock.mock.calls[0];
    expect(url).toBe('https://test.supabase.co');
    expect(key).toBe('test-publishable');
    expect(options.cookies.getAll()).toEqual([{ name: 'sb-token', value: 'irrelevant-for-mocking' }]);
  });

  it('throws when Supabase env vars are missing (deployment misconfig)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const { getAuthenticatedUser } = await import('../lib/server-auth');
    await expect(getAuthenticatedUser()).rejects.toThrow(/Supabase environment variables/);
  });
});
