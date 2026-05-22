'use client';

import { useState } from 'react';

type RegisterResult = {
  ok?: boolean;
  subscription?: { id: number; callback_url?: string };
  callbackUrl?: string;
  replacedCount?: number;
  error?: string;
};

/**
 * Client-side trigger for /api/strava/register-webhook. Registers Strava's
 * push subscription against this deployment's webhook URL so activities
 * push in real time after Apple finishes uploading. One-time setup per
 * deployment (or any time the callback URL changes).
 */
export function RegisterStravaWebhookButton() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'error' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    if (status === 'sending') return;
    setStatus('sending');
    setMessage(null);
    try {
      const response = await fetch('/api/strava/register-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await response.json().catch(() => null)) as RegisterResult | null;
      if (!response.ok || data?.ok === false) {
        setStatus('error');
        setMessage(data?.error ?? `Register failed (${response.status})`);
        return;
      }
      setStatus('done');
      const id = data?.subscription?.id;
      const callback = data?.callbackUrl ?? data?.subscription?.callback_url ?? '';
      const replaced = data?.replacedCount ?? 0;
      setMessage(
        id != null
          ? `Subscription #${id} → ${callback}${replaced > 0 ? ` (replaced ${replaced})` : ''}`
          : 'Webhook registered.',
      );
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Network error');
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'sending'}
        className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === 'sending' ? 'Registering…' : 'Register webhook'}
      </button>
      {message ? (
        <p className={status === 'error' ? 'text-sm text-red-300' : 'text-sm text-muted'}>{message}</p>
      ) : null}
    </div>
  );
}
