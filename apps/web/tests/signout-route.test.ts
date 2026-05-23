import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn(async () => ({ error: null }));
const createServerClient = vi.fn(() => ({
  auth: { signOut },
}));

vi.mock('@supabase/ssr', () => ({ createServerClient }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [] })),
}));

describe('POST /api/auth/signout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'key';
  });

  it('calls signOut and returns ok:true', async () => {
    const { POST } = await import('../app/api/auth/signout/route');
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(signOut).toHaveBeenCalled();
  });

  it('returns 500 when supabase env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { POST } = await import('../app/api/auth/signout/route');
    const res = await POST();
    expect(res.status).toBe(500);
    expect(signOut).not.toHaveBeenCalled();
  });
});
