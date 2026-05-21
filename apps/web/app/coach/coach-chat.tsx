'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type {
  CoachConversationMessage,
  CoachFollowUp,
} from '@/lib/agents/training-coach';

export type CoachChatProps = {
  initialMessage: string | null;
  initialRecommendations: string[];
  initialCautions: string[];
  initialRationale: string | null;
  initialConversation: CoachConversationMessage[];
  initialFollowUp: CoachFollowUp | null;
};

type ApiResponse = {
  message?: string;
  recommendations?: string[];
  cautions?: string[];
  rationale?: string;
  followUp?: CoachFollowUp | null;
  injurySignal?: { detected: boolean; bodyPart?: string };
  recoverySignal?: { detected: boolean };
  llmInvoked?: boolean;
  error?: string;
};

function formatTimestamp(at: string | undefined): string {
  if (!at) return '';
  try {
    const date = new Date(at);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function CoachChat(props: CoachChatProps) {
  const [latestMessage, setLatestMessage] = useState<string | null>(props.initialMessage);
  const [recommendations, setRecommendations] = useState<string[]>(props.initialRecommendations);
  const [cautions, setCautions] = useState<string[]>(props.initialCautions);
  const [rationale, setRationale] = useState<string | null>(props.initialRationale);
  const [conversation, setConversation] = useState<CoachConversationMessage[]>(props.initialConversation);
  const [followUp, setFollowUp] = useState<CoachFollowUp | null>(props.initialFollowUp);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sending = status === 'sending';
  const followUpActive = followUp?.status === 'active';

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    // Optimistic append.
    const optimisticAthlete: CoachConversationMessage = {
      role: 'athlete',
      text: trimmed,
      at: new Date().toISOString(),
    };
    setConversation((prior) => [...prior, optimisticAthlete]);
    setDraft('');
    setStatus('sending');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/coach/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok) {
        const reason = data?.error ?? `Request failed (${response.status})`;
        setStatus('error');
        setErrorMessage(reason);
        // Roll back the optimistic append.
        setConversation((prior) => prior.slice(0, -1));
        return;
      }

      setLatestMessage(data.message ?? null);
      setRecommendations(data.recommendations ?? []);
      setCautions(data.cautions ?? []);
      setRationale(data.rationale ?? null);
      setFollowUp(data.followUp ?? null);

      // The API returns the full conversation in its merge; for now append
      // the coach reply locally for snappy UX. A future refinement would be
      // to return + use the server-side trimmed conversation directly.
      const coachReply: CoachConversationMessage = {
        role: 'coach',
        text: data.message ?? '',
        at: new Date().toISOString(),
      };
      setConversation((prior) => [...prior, coachReply]);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
      setConversation((prior) => prior.slice(0, -1));
    }
  }

  return (
    <div className="space-y-6">
      {followUpActive ? (
        <Card className="border-amber-400/30 bg-amber-400/[0.05] space-y-2">
          <p className="eyebrow text-amber-300">Active follow-up</p>
          <h3 className="text-lg font-semibold text-white">
            Keep work easy through {followUp.easyThroughDate}
            {followUp.bodyPart ? ` — watching the ${followUp.bodyPart}` : ''}
          </h3>
          <p className="text-sm text-muted">
            Coach will re-evaluate on {followUp.checkInDate}. Tell me how it feels when you check in.
          </p>
        </Card>
      ) : null}

      <Card className="space-y-4">
        <div>
          <p className="eyebrow">Today&apos;s call</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            {latestMessage ?? 'No coach run yet today. Send a message below to get started.'}
          </h2>
          {rationale ? <p className="mt-3 text-xs text-muted">Engine: {rationale}</p> : null}
        </div>
        {recommendations.length ? (
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-brand2">Recommendations</p>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {recommendations.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {cautions.length ? (
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Cautions</p>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {cautions.map((c, i) => (
                <li key={i}>• {c}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <div>
          <p className="eyebrow">Conversation</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Tell the coach what&apos;s going on.</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Mention strain or pain and the coach will set an easy-through window automatically. Say &ldquo;pain free&rdquo; or &ldquo;back to normal&rdquo; on a follow-up to close it.
          </p>
        </div>

        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2" aria-live="polite">
          {conversation.length === 0 ? (
            <p className="text-sm italic text-muted">No conversation yet today.</p>
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
                  <span>{m.role}</span>
                  <span>{formatTimestamp(m.at)}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-white">{m.text}</p>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSend} className="space-y-2">
          <label htmlFor="coach-input" className="text-xs uppercase tracking-[0.18em] text-muted">
            Message your coach
          </label>
          <textarea
            id="coach-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={sending}
            rows={3}
            placeholder="E.g., foot hurts after the long run, or how should I run today"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white outline-none placeholder:text-muted focus:border-brand2/60"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">
              {sending ? 'Coach is thinking…' : 'Press Send when ready.'}
            </span>
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              Send
            </button>
          </div>
          {errorMessage ? (
            <p className="text-sm text-red-300">{errorMessage}</p>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
