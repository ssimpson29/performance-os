'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Provider = 'oura' | 'strava';

type DisconnectResult = {
  ok?: boolean;
  error?: string;
  deletedRecovery?: number;
  deletedWorkouts?: number;
};

/**
 * Two-step "Disconnect" control for an integration card. Because disconnecting
 * DELETES the data synced from the provider (terms compliance), the first
 * click reveals an explicit confirm so it can't be a one-tap accident.
 */
export function DisconnectIntegrationButton({ provider, label }: { provider: Provider; label: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'sending' | 'error' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function disconnect() {
    setPhase('sending');
    setMessage(null);
    try {
      const res = await fetch('/api/integrations/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = (await res.json().catch(() => null)) as DisconnectResult | null;
      if (!res.ok || data?.ok === false) {
        setPhase('error');
        setMessage(data?.error ?? `Disconnect failed (${res.status})`);
        return;
      }
      setPhase('done');
      const deleted: string[] = [];
      if (data?.deletedRecovery) deleted.push(`${data.deletedRecovery} recovery days`);
      if (data?.deletedWorkouts) deleted.push(`${data.deletedWorkouts} workouts`);
      setMessage(`Disconnected ${label}. Deleted ${deleted.length ? deleted.join(' + ') : 'no stored data'}.`);
      router.refresh();
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Network error');
    }
  }

  if (phase === 'done') {
    return <p className="text-sm text-muted">{message}</p>;
  }

  if (phase === 'confirm' || phase === 'sending' || phase === 'error') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-amber-300">
          Disconnecting deletes the data we synced from {label}. This can’t be undone.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={disconnect}
            disabled={phase === 'sending'}
            className="rounded-full bg-rose-500/80 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {phase === 'sending' ? 'Disconnecting…' : `Disconnect & delete ${label} data`}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhase('idle');
              setMessage(null);
            }}
            disabled={phase === 'sending'}
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-muted disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {phase === 'error' && message ? <p className="text-sm text-red-300">{message}</p> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPhase('confirm')}
      className="text-sm text-muted underline underline-offset-4 hover:text-white"
    >
      Disconnect
    </button>
  );
}
