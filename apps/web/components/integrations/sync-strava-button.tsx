'use client';

import { useState } from 'react';

type SyncResult = {
  ok?: boolean;
  activitiesFetched?: number;
  workoutsInserted?: number;
  workoutsLinkedToApple?: number;
  workoutsAlreadyPresent?: number;
  workoutsFailed?: number;
};

/**
 * Client-side "Sync now" trigger for the Strava integration card. POSTs to
 * /api/sync/strava with an empty body and surfaces the JSON result inline so
 * the athlete sees how many activities came back without leaving the
 * Integrations page.
 */
export function SyncStravaButton() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'error' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    if (status === 'sending') return;
    setStatus('sending');
    setMessage(null);
    try {
      const response = await fetch('/api/sync/strava', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await response.json().catch(() => null)) as
        | (SyncResult & { error?: string })
        | null;
      if (!response.ok || data?.ok === false) {
        setStatus('error');
        setMessage(data?.error ?? `Sync failed (${response.status})`);
        return;
      }
      setStatus('done');
      const failedSegment = data?.workoutsFailed && data.workoutsFailed > 0
        ? ` · failed ${data.workoutsFailed}`
        : '';
      const summary =
        data && typeof data === 'object'
          ? `Fetched ${data.activitiesFetched ?? 0} · new ${data.workoutsInserted ?? 0} · linked to Apple ${data.workoutsLinkedToApple ?? 0} · already present ${data.workoutsAlreadyPresent ?? 0}${failedSegment}`
          : 'Sync complete.';
      setMessage(summary);
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
        className="rounded-full bg-brand2 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {status === 'sending' ? 'Syncing…' : 'Sync now'}
      </button>
      {message ? (
        <p className={status === 'error' ? 'text-sm text-red-300' : 'text-sm text-muted'}>{message}</p>
      ) : null}
    </div>
  );
}
