import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';

import { CoachChat } from './coach-chat';
import { loadCoachPageState } from './coach-data';

const raceAwareSurfaces = [
  {
    title: 'Phase position',
    body: 'Where the athlete is in the race build today — phase name, week within the phase, weeks to race, and whether load raises are permitted in the current phase. Taper and race week lock the plan.',
  },
  {
    title: 'Plan-level adaptation',
    body: 'A block-level raise / hold / lower suggestion grounded in prescribed-vs-completed delta and recovery trend. Raises only fire on healthy over-performance in a non-taper / non-race-week phase. Distinct from per-day recommendations.',
  },
  {
    title: 'Recovery trend',
    body: 'Improving / stable / degrading over the recent window, with a confidence score. A degrading trend with high confidence defers Tuesday quality even without weekend overload.',
  },
  {
    title: 'Performance vs. plan',
    body: 'Over / on / under signal computed from prescribed volume and intensity vs. what the athlete actually completed. Drives adapt-up on consistent over-performance and adapt-down on lagging adherence.',
  },
];

export default async function CoachPage() {
  const state = await loadCoachPageState();

  return (
    <main>
      <PageHero
        eyebrow="Training Coach"
        title="Talk to the coach. Get the call for today."
        description="The coach reads your plan, recent workouts, and recovery, then composes the call. Mention pain or strain and the follow-up window opens automatically."
        badge={state.kind === 'ready' ? 'Live coach' : 'Coach preview'}
      />

      <section className="shell pb-8">
        {state.kind === 'unauthenticated' ? (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Sign in to talk to your coach</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                The coach reads your plan, workouts, and recovery — so it needs to know who you are first.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Head to Integrations to send yourself a magic link. Once you&apos;re signed in, come back here.
              </p>
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center justify-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Integrations
            </Link>
          </Card>
        ) : null}

        {state.kind === 'no-plan' ? (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Upload a training plan</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                The coach needs your plan to answer &ldquo;what should I do today?&rdquo;
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Visit the Plan page to import your workbook. Once your plan is in, race date and phase blocks are available, the coach can start adapting it.
              </p>
            </div>
            <Link
              href="/plan"
              className="inline-flex items-center justify-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Plan
            </Link>
          </Card>
        ) : null}

        {state.kind === 'ready' ? (
          <div className="space-y-4">
            <Card className="space-y-2">
              <p className="eyebrow">Active plan</p>
              <h2 className="text-xl font-semibold text-white">
                {state.planName ?? 'Imported plan'}
              </h2>
              <p className="text-sm leading-6 text-muted">
                {state.goal ?? 'Goal not set'}
                {state.raceDate ? ` · race ${state.raceDate}` : ''}
              </p>
            </Card>
            <CoachChat
              today={state.today}
              day={state.day}
              plannedSession={state.plannedSession}
              initialConversation={state.conversation}
              initialFollowUp={state.followUp}
            />
          </div>
        ) : null}
      </section>

      <section className="shell pb-16">
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Behind the coach — what the deterministic engine surfaces</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Four signals behind every daily call.</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              The coach reads four race-aware signals from the deterministic engine before any narrative is composed. See <code className="text-brand2">docs/two-coach-architecture.md</code>
              {' '}for the higher-level model and worked examples.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {raceAwareSurfaces.map((surface) => (
              <div key={surface.title} className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-brand2">{surface.title}</p>
                <p className="mt-3 text-sm leading-6 text-muted">{surface.body}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
