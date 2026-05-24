'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Card } from '@/components/ui/card';
import type { TodaysCall } from '@/lib/agents/todays-call';
import type {
  CoachConversationMessage,
  CoachFollowUp,
} from '@/lib/agents/training-coach';
import type { WeeklyStructureSession } from '@/lib/training-plan/types';

export type CoachChatProps = {
  /** ISO date (YYYY-MM-DD) representing "today" — used for the headline label. */
  today: string;
  /** Day-of-week name (e.g. "Tuesday") matching today's `weeklyStructure` row. */
  day: string;
  /**
   * The planned session for today, looked up by day-of-week from the
   * athlete's active training plan. Null when the plan has no row for
   * today's day-of-week (off day, malformed import). Used as the
   * fallback when `todaysCall` is null (LLM composer unavailable).
   */
  plannedSession: WeeklyStructureSession | null;
  /**
   * LLM-composed structured workout call for today. When present, this
   * is the source of truth for the Today's Call card — phase context,
   * specific session, exact work, fuel, strength, rationale. Falls
   * back to plannedSession when null.
   */
  todaysCall: TodaysCall | null;
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

/**
 * Render the structured Today's Call as a stack of labeled rows.
 * Each field is independently rendered + skipped when empty so the
 * card stays clean for rest days / minimal compositions.
 */
function TodaysCallBody({ call }: { call: TodaysCall }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (call.details?.trim()) rows.push({ label: 'Details', value: call.details });
  if (call.exactWork?.trim()) rows.push({ label: 'Exact work', value: call.exactWork });
  if (call.strengthMobility?.trim())
    rows.push({ label: 'Strength / mobility', value: call.strengthMobility });
  if (call.fuel?.trim()) rows.push({ label: 'Fuel + hydration', value: call.fuel });
  return (
    <>
      {rows.length ? (
        <dl className="space-y-2 text-sm leading-6 text-muted">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-xs uppercase tracking-[0.18em] text-brand2">{r.label}</dt>
              <dd className="mt-1 text-white">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {call.rationale?.trim() ? (
        <p className="mt-3 border-t border-white/5 pt-3 text-xs leading-6 text-muted">
          <span className="uppercase tracking-[0.18em] text-brand2/80">Why this </span>·{' '}
          {call.rationale}
        </p>
      ) : null}
      {!call.llmInvoked ? (
        <p className="mt-1 text-xs text-amber-300/80">
          Deterministic fallback — LLM composer was unavailable for this call.
        </p>
      ) : null}
    </>
  );
}

/**
 * Render a WeeklyStructureSession as a small stack of labeled lines.
 * Skips fields that are empty / whitespace so an off day with only a
 * `runSession` doesn't render four blank rows.
 */
function PlannedSessionDetails({ session }: { session: WeeklyStructureSession }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (session.details?.trim()) rows.push({ label: 'Details', value: session.details });
  if (session.exactWork?.trim()) rows.push({ label: 'Exact work', value: session.exactWork });
  if (session.strengthMobility?.trim())
    rows.push({ label: 'Strength / mobility', value: session.strengthMobility });
  if (rows.length === 0) return null;
  return (
    <dl className="mt-3 space-y-2 text-sm leading-6 text-muted">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-xs uppercase tracking-[0.18em] text-brand2">{r.label}</dt>
          <dd className="mt-1 text-white">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CoachChat(props: CoachChatProps) {
  const router = useRouter();
  const [conversation, setConversation] = useState<CoachConversationMessage[]>(props.initialConversation);
  const [followUp, setFollowUp] = useState<CoachFollowUp | null>(props.initialFollowUp);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const sending = status === 'sending';
  const followUpActive = followUp?.status === 'active';

  // Auto-scroll the conversation thread to the bottom. Default browser
  // behavior on page reload leaves a scrollable div at scrollTop=0, so a
  // long history dumped the athlete at the very first message — they had
  // to scroll all the way down every refresh. Two effects:
  //  1. Mount → jump to bottom (no animation, just be at the latest).
  //  2. conversation.length change → smooth-scroll so a new reply
  //     visibly appears at the bottom instead of silently appending
  //     below the visible area.
  const threadRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Empty dep array — mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [conversation.length]);

  /**
   * Start fresh — clears today's coach conversation, follow-up window,
   * and cached Today's Call so the next compose runs against a clean
   * slate. Souls survive (durable memory by design — see CLAUDE.md
   * "Athlete souls"). Confirms before destroying state.
   */
  async function handleStartFresh() {
    if (resetting || sending) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        "Start a fresh conversation with the coach for today? Today's Call will recompose, and the easy-through window (if any) clears. Your training soul / saved facts are kept.",
      );
      if (!ok) return;
    }
    setResetting(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/coach/conversation', { method: 'DELETE' });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(data?.error ?? `Reset failed (${response.status})`);
        return;
      }
      setConversation([]);
      setFollowUp(null);

      // Soft-refresh so the "Today's Call" card recomposes against the
      // freshly cleared state. The DELETE endpoint already stripped the
      // cached call; without this refresh the card would still display
      // whatever it had before the reset, contradicting the now-empty
      // thread below it.
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
    } finally {
      setResetting(false);
    }
  }

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

      // Update follow-up state — it can open/close on any turn.
      setFollowUp(data.followUp ?? null);

      // Append the coach reply to the conversation thread. The reply
      // shape (`message`) is what the coach SAID in chat — distinct from
      // the structured Today's Call card that lives in the SSR'd portion
      // of the page. The chat thread is reactive (athlete asks, coach
      // answers); the Today's Call card is proactive (composed on page
      // load against current phase / recovery / posture).
      const coachReply: CoachConversationMessage = {
        role: 'coach',
        text: data.message ?? '',
        at: new Date().toISOString(),
      };
      setConversation((prior) => [...prior, coachReply]);
      setStatus('idle');

      // Soft-refresh server components so the "Today's Call" card at the
      // top of the page picks up whatever the chat turn just changed.
      // `persistTrainingCoachRun` already stripped `summary.todaysCall`
      // from the cache when this turn landed; the next render is a cache
      // miss → `composeTodaysCall` runs fresh against the updated
      // conversation context (new injury report, recovery report,
      // "I'm handling more than the plan", etc.) and renders the new
      // call. Without this, the card stays at whatever was composed on
      // the initial page load and the athlete sees a stale headline
      // that contradicts what the coach just told them in chat.
      //
      // `router.refresh()` is a soft refresh — server components re-render
      // but client state (this `conversation` useState, the draft input,
      // scroll position) is preserved. The page passes a new
      // `initialConversation` prop down, but useState ignores prop
      // changes after mount, so the optimistic + server-confirmed thread
      // we just built stays intact.
      router.refresh();
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

      <Card className="space-y-3">
        <div>
          <p className="eyebrow">
            Today&apos;s call · {props.day} {props.today}
          </p>
          {props.todaysCall?.phaseContext ? (
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-brand2/80">
              {props.todaysCall.phaseContext}
            </p>
          ) : null}
        </div>

        {props.todaysCall ? (
          <>
            <h2 className="text-2xl font-semibold text-white">{props.todaysCall.headline}</h2>
            <TodaysCallBody call={props.todaysCall} />
          </>
        ) : props.plannedSession ? (
          // Fallback when the LLM composer was unavailable (env missing,
          // network failure). Renders the plan's weekly-structure entry
          // verbatim so the athlete sees something useful regardless.
          <>
            <h2 className="text-2xl font-semibold text-white">
              {props.plannedSession.runSession || 'Session planned for today'}
            </h2>
            <PlannedSessionDetails session={props.plannedSession} />
            <p className="mt-2 text-xs text-amber-300/80">
              Live composer unavailable — showing your plan template.
            </p>
          </>
        ) : (
          <h2 className="text-2xl font-semibold text-white">
            No session planned for {props.day} in your active plan.
          </h2>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Conversation</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Tell the coach what&apos;s going on.</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Mention strain or pain and the coach will set an easy-through window automatically. Say &ldquo;pain free&rdquo; or &ldquo;back to normal&rdquo; on a follow-up to close it.
            </p>
          </div>
          {conversation.length > 0 ? (
            <button
              type="button"
              onClick={handleStartFresh}
              disabled={resetting || sending}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-muted transition hover:border-brand2/40 hover:text-brand2 disabled:opacity-50"
              title="Clear today's conversation. Souls / saved facts survive."
            >
              {resetting ? 'Clearing…' : 'Start fresh'}
            </button>
          ) : null}
        </div>

        <div ref={threadRef} className="space-y-3 max-h-[420px] overflow-y-auto pr-2" aria-live="polite">
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
