import * as React from 'react';

import { cn } from '@/lib/utils';

import type { PlanVsActualPreview } from './plan-vs-actual-data';

const STATUS_STYLES = {
  completed: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  partial: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
  substituted: 'border-sky-400/20 bg-sky-400/10 text-sky-100',
  missed: 'border-white/10 bg-white/5 text-slate-200',
  upcoming: 'border-indigo-400/20 bg-indigo-400/10 text-indigo-100',
} as const;

function formatStatusLabel(status: PlanVsActualPreview['sessions'][number]['status']) {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'partial':
      return 'Partial';
    case 'substituted':
      return 'Substituted';
    case 'missed':
      return 'Missed';
    case 'upcoming':
      return 'Upcoming';
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDateAddDays(iso: string, deltaDays: number): string {
  const parts = iso.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function statCard(label: string, value: number) {
  return React.createElement(
    'div',
    { className: 'rounded-2xl border border-white/5 bg-white/[0.03] p-3' },
    React.createElement('p', { className: 'text-xs uppercase tracking-[0.18em] text-brand2' }, label),
    React.createElement('p', { className: 'mt-2 text-xl font-semibold text-white' }, String(value)),
  );
}

function sessionCard(session: PlanVsActualPreview['sessions'][number]) {
  return React.createElement(
    'div',
    { key: session.plannedSessionId, className: 'rounded-2xl border border-white/5 bg-white/[0.03] p-4' },
    React.createElement(
      'div',
      { className: 'flex items-start justify-between gap-3' },
      React.createElement(
        'div',
        null,
        React.createElement('p', { className: 'text-sm text-brand2' }, session.sessionDate),
        React.createElement('h3', { className: 'mt-1 text-lg font-semibold text-white' }, session.title),
        React.createElement(
          'p',
          { className: 'mt-2 text-sm text-muted' },
          `Planned duration: ${session.plannedDurationMinutes ? `${session.plannedDurationMinutes} min` : 'Not specified'}`,
        ),
      ),
      React.createElement(
        'span',
        {
          className: cn(
            'rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]',
            STATUS_STYLES[session.status],
          ),
        },
        formatStatusLabel(session.status),
      ),
    ),
    React.createElement(
      'div',
      { className: 'mt-3 grid gap-3 text-sm text-muted md:grid-cols-[1.2fr_1fr]' },
      React.createElement('p', null, session.reasoning),
      React.createElement(
        'div',
        { className: 'rounded-2xl border border-white/5 bg-black/20 p-3' },
        React.createElement('p', { className: 'font-medium text-white' }, 'Observed workout'),
        React.createElement(
          'p',
          { className: 'mt-2' },
          `${session.actualWorkoutType ?? 'No matched workout logged'}${session.actualDurationMinutes ? ` · ${session.actualDurationMinutes} min` : ''}`,
        ),
      ),
    ),
  );
}

function offPlanCard(workout: PlanVsActualPreview['offPlanWorkouts'][number]) {
  return React.createElement(
    'div',
    { key: workout.externalId, className: 'rounded-2xl border border-white/5 bg-white/[0.03] p-4' },
    React.createElement(
      'div',
      { className: 'flex items-center justify-between gap-3' },
      React.createElement('p', { className: 'font-medium text-white' }, workout.workoutType),
      React.createElement('span', { className: 'text-xs uppercase tracking-[0.18em] text-brand2' }, workout.localDate),
    ),
    React.createElement(
      'p',
      { className: 'mt-2 text-sm text-muted' },
      workout.durationMinutes
        ? `${workout.durationMinutes} min logged outside the planned session set.`
        : 'Logged outside the planned session set.',
    ),
  );
}

export function PlanVsActualSection({ preview }: { preview: PlanVsActualPreview }) {
  const hasAnyRecordedData = preview.sessions.length > 0 || preview.offPlanWorkouts.length > 0;

  // Limit the rendered cards to a rolling window so a full-season plan (160+
  // sessions) doesn't drown the page. Past 14 days through next 7 days
  // covers "what just happened" + "what's coming up." Summary counts above
  // still reflect the entire plan.
  const today = todayIsoDate();
  const renderFrom = isoDateAddDays(today, -14);
  const renderTo = isoDateAddDays(today, 7);
  const renderedSessions = preview.sessions.filter(
    (session) => session.sessionDate >= renderFrom && session.sessionDate <= renderTo,
  );
  const hiddenSessionCount = preview.sessions.length - renderedSessions.length;

  return React.createElement(
    'section',
    { className: 'shell grid gap-6 pb-8 lg:grid-cols-[1.65fr_1fr]' },
    React.createElement(
      'div',
      { className: 'panel space-y-4 p-6 shadow-glow' },
      React.createElement(
        'div',
        { className: 'flex items-start justify-between gap-4' },
        React.createElement(
          'div',
          null,
          React.createElement('p', { className: 'eyebrow' }, 'Plan vs actual'),
          React.createElement(
            'h2',
            { className: 'mt-2 text-2xl font-semibold text-white' },
            'Adherence is shown as context, not judgment.',
          ),
          React.createElement(
            'p',
            { className: 'mt-2 max-w-2xl text-sm leading-6 text-muted' },
            'Planned sessions, substitutions, partial completions, and missed work are displayed to help interpret training load and recovery—not to reward or punish behavior.',
          ),
        ),
        React.createElement(
          'div',
          { className: 'grid min-w-48 grid-cols-2 gap-2 text-sm text-muted' },
          statCard('Completed', preview.summary.completed),
          statCard('Partial', preview.summary.partial),
          statCard('Substituted', preview.summary.substituted),
          statCard('Missed', preview.summary.missed),
          statCard('Upcoming', preview.summary.upcoming),
        ),
      ),
      hasAnyRecordedData
        ? React.createElement(
            'div',
            { className: 'space-y-3' },
            ...renderedSessions.map(sessionCard),
            hiddenSessionCount > 0
              ? React.createElement(
                  'p',
                  {
                    key: 'hidden-count',
                    className: 'text-xs text-muted',
                  },
                  `${hiddenSessionCount} additional planned session${hiddenSessionCount === 1 ? '' : 's'} outside the past 14 / next 7 day window are summarized in the totals above.`,
                )
              : null,
          )
        : React.createElement(
            'div',
            { className: 'rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-muted' },
            React.createElement('p', { className: 'font-medium text-white' }, 'No imported plan or workout data yet'),
            React.createElement(
              'p',
              { className: 'mt-2' },
              'Import a training plan and actual workouts to start comparing plan vs actual.',
            ),
          ),
    ),
    React.createElement(
      'div',
      { className: 'panel space-y-4 p-6 shadow-glow' },
      React.createElement(
        'div',
        null,
        React.createElement('p', { className: 'eyebrow' }, 'Off-plan workouts'),
        React.createElement(
          'h2',
          { className: 'mt-2 text-2xl font-semibold text-white' },
          'Unmatched training is still part of the record.',
        ),
        React.createElement(
          'p',
          { className: 'mt-2 text-sm leading-6 text-muted' },
          'Work that does not line up with a planned session stays visible so the coach can interpret load, recovery, and substitution patterns accurately.',
        ),
      ),
      React.createElement(
        'div',
        { className: 'rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-sm text-muted' },
        React.createElement('p', { className: 'font-medium text-white' }, 'Off-plan sessions captured'),
        React.createElement('p', { className: 'mt-2 text-2xl font-semibold text-white' }, String(preview.summary.offPlan)),
      ),
      React.createElement('div', { className: 'space-y-3' }, ...preview.offPlanWorkouts.map(offPlanCard)),
    ),
  );
}
