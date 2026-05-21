import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('apple-health automation signing', () => {
  const originalEnv = {
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
    pushSecret: process.env.APPLE_HEALTH_PUSH_SECRET,
  };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.APPLE_HEALTH_PUSH_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv.appUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalEnv.appUrl;
    }
    if (originalEnv.serviceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.serviceRole;
    }
    if (originalEnv.pushSecret === undefined) {
      delete process.env.APPLE_HEALTH_PUSH_SECRET;
    } else {
      process.env.APPLE_HEALTH_PUSH_SECRET = originalEnv.pushSecret;
    }
    vi.resetModules();
  });

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

  it('prefers APPLE_HEALTH_PUSH_SECRET over SUPABASE_SERVICE_ROLE_KEY when both are set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-must-not-be-used';
    process.env.APPLE_HEALTH_PUSH_SECRET = 'dedicated-push-secret';

    const { buildAppleHealthPushUrl, verifyAppleHealthPushSignature } = await import('../lib/apple-health/automation');
    const { createHmac } = await import('node:crypto');

    const url = buildAppleHealthPushUrl('user-xyz');
    const signature = new URL(url).searchParams.get('signature') ?? '';

    const expectedFromDedicated = createHmac('sha256', 'dedicated-push-secret').update('user-xyz').digest('hex');
    const expectedFromServiceRole = createHmac('sha256', 'service-role-key-must-not-be-used').update('user-xyz').digest('hex');

    expect(signature).toBe(expectedFromDedicated);
    expect(signature).not.toBe(expectedFromServiceRole);
    expect(verifyAppleHealthPushSignature('user-xyz', signature)).toBe(true);
  });

  it('falls back to SUPABASE_SERVICE_ROLE_KEY when APPLE_HEALTH_PUSH_SECRET is unset', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fallback-service-role';

    const { buildAppleHealthPushUrl, verifyAppleHealthPushSignature } = await import('../lib/apple-health/automation');
    const { createHmac } = await import('node:crypto');

    const url = buildAppleHealthPushUrl('user-fb');
    const signature = new URL(url).searchParams.get('signature') ?? '';

    const expected = createHmac('sha256', 'fallback-service-role').update('user-fb').digest('hex');
    expect(signature).toBe(expected);
    expect(verifyAppleHealthPushSignature('user-fb', signature)).toBe(true);
  });
});
