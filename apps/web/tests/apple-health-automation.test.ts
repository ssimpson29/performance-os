import { describe, expect, it } from 'vitest';

describe('apple-health automation signing', () => {
  it('builds a stable signed push URL for a bound user', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-secret';

    const { buildAppleHealthPushUrl, verifyAppleHealthPushSignature } = await import('../lib/apple-health/automation');

    const url = buildAppleHealthPushUrl('user-123');
    const parsed = new URL(url);
    const signature = parsed.searchParams.get('signature');

    expect(parsed.origin).toBe('http://localhost:3000');
    expect(parsed.pathname).toBe('/api/imports/apple-health/push');
    expect(parsed.searchParams.get('userId')).toBe('user-123');
    expect(signature).toBeTruthy();
    expect(verifyAppleHealthPushSignature('user-123', signature ?? '')).toBe(true);
    expect(verifyAppleHealthPushSignature('user-123', 'bad-signature')).toBe(false);
  });
});
