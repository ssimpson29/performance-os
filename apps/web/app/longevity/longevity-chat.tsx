'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';

import type { LongevityConversationMessageView } from './longevity-data';

/**
 * Inline chat surface for the Longevity Guru — sits beneath the
 * priorities / narrative / watching cards on /longevity. Mirrors the
 * Training Coach's coach-chat.tsx pattern: optimistic athlete-message
 * append, fetch /api/longevity/message, on success append the guru's
 * reply; on error roll back the optimistic add.
 */

type ApiResponse = {
  message?: string;
  conversation?: LongevityConversationMessageView[];
  soulUpdated?: boolean;
  llmInvoked?: boolean;
  error?: string;
};

function formatTimestamp(at: string | undefined): string {
  if (!at) return '';
  try {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function LongevityChat({
  initialConversation,
}: {
  initialConversation: LongevityConversationMessageView[];
}) {
  const [conversation, setConversation] = useState<LongevityConversationMessageView[]>(
    initialConversation,
  );
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [soulFlashed, setSoulFlashed] = useState(false);

  const sending = status === 'sending';

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    // Optimistic athlete append.
    const optimisticAthlete: LongevityConversationMessageView = {
      role: 'athlete',
      text: trimmed,
      at: new Date().toISOString(),
    };
    setConversation((prior) => [...prior, optimisticAthlete]);
    setDraft('');
    setStatus('sending');
    setErrorMessage(null);
    setSoulFlashed(false);

    try {
      const response = await fetch('/api/longevity/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok) {
        const reason = data?.error ?? `Request failed (${response.status})`;
        setStatus('error');
        setErrorMessage(reason);
        setConversation((prior) => prior.slice(0, -1));
        return;
      }

      // Server returns the full trimmed conversation including the new
      // athlete + guru turns — use that as ground truth to avoid drift.
      if (data.conversation && data.conversation.length) {
        setConversation(data.conversation);
      } else if (data.message) {
        // Defensive fallback: server didn't return conversation but did
        // return a message. Append it locally so the UX is responsive.
        setConversation((prior) => [
          ...prior,
          { role: 'guru', text: data.message ?? '', at: new Date().toISOString() },
        ]);
      }
      if (data.soulUpdated) {
        setSoulFlashed(true);
        // Auto-clear the affordance after a few seconds so it doesn't linger.
        setTimeout(() => setSoulFlashed(false), 6000);
      }
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
      setConversation((prior) => prior.slice(0, -1));
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <p className="eyebrow">Ask the guru</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Conversation</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          The Longevity Guru reads your most recent panel, marker history, and longevity soul. Ask about a marker, a tradeoff, a doctor&apos;s view you want filtered through.
        </p>
      </div>

      <div
        className="space-y-3 max-h-[420px] overflow-y-auto pr-2"
        aria-live="polite"
      >
        {conversation.length === 0 ? (
          <p className="text-sm italic text-muted">No conversation yet. Ask something below.</p>
        ) : (
          conversation.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'athlete'
                  ? 'rounded-2xl border border-brand2/30 bg-brand2/[0.06] p-3'
                  : 'rounded-2xl border border-white/10 bg-white/[0.04] p-3'
              }
            >
              <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.18em] text-muted">
                <span>{m.role === 'guru' ? 'Longevity Guru' : 'You'}</span>
                <span>{formatTimestamp(m.at)}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-white">{m.text}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className="space-y-2">
        <label
          htmlFor="longevity-input"
          className="text-xs uppercase tracking-[0.18em] text-muted"
        >
          Message the guru
        </label>
        <textarea
          id="longevity-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
          rows={3}
          placeholder="E.g., my anion gap came back at 6 — what does that mean and should I do anything? Or: what's Attia's take on apoB targets at my age?"
          className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white outline-none placeholder:text-muted focus:border-brand2/60"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {sending
              ? 'Guru is thinking…'
              : soulFlashed
              ? 'Saved a durable fact to your longevity soul.'
              : 'Press Send when ready.'}
          </span>
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Send
          </button>
        </div>
        {errorMessage ? <p className="text-sm text-red-300">{errorMessage}</p> : null}
      </form>
    </Card>
  );
}
