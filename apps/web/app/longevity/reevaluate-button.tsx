'use client';

import { useState } from 'react';

export function ReevaluateButton() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'error' | 'done'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick() {
    if (status === 'sending') return;
    setStatus('sending');
    setErrorMessage(null);
    try {
      const response = await fetch('/api/longevity/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus('error');
        setErrorMessage(data?.error ?? `Request failed (${response.status})`);
        return;
      }
      setStatus('done');
      // Reload to show the freshly persisted state.
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'sending'}
        className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {status === 'sending' ? 'Evaluating…' : 'Re-evaluate now'}
      </button>
      {errorMessage ? <p className="text-sm text-red-300">{errorMessage}</p> : null}
    </div>
  );
}
