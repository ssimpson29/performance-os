import { createHmac, timingSafeEqual } from 'node:crypto';

import { getAppEnv } from '@/lib/env';

function getAppleHealthPushSecret() {
  const secret = process.env.APPLE_HEALTH_PUSH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error('Missing Apple Health push secret. Set APPLE_HEALTH_PUSH_SECRET or SUPABASE_SERVICE_ROLE_KEY.');
  }

  return secret;
}

export function signAppleHealthPushUser(userId: string) {
  return createHmac('sha256', getAppleHealthPushSecret()).update(userId).digest('hex');
}

export function verifyAppleHealthPushSignature(userId: string, signature: string) {
  if (!userId || !signature) return false;

  const expected = signAppleHealthPushUser(userId);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function buildAppleHealthPushUrl(userId: string) {
  const { appUrl } = getAppEnv();
  const baseUrl = (appUrl ?? 'http://localhost:3000').replace(/\/$/, '');
  const url = new URL(`${baseUrl}/api/imports/apple-health/push`);
  url.searchParams.set('userId', userId);
  url.searchParams.set('signature', signAppleHealthPushUser(userId));
  return url.toString();
}
