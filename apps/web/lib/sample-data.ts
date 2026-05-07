import type { ActualWorkoutInput, PlannedSessionForMatching } from '@/lib/training-plan/types';

export type MetricCard = {
  label: string;
  value: string;
  trend?: number;
  tone?: 'default' | 'good' | 'caution';
};

export const dailySnapshot: MetricCard[] = [
  { label: 'Readiness', value: '84 / 100', trend: 6, tone: 'good' },
  { label: 'Sleep debt', value: '0:42', trend: -18, tone: 'good' },
  { label: 'Training load', value: '5.8', trend: 12, tone: 'caution' },
  { label: 'Recovery reserve', value: 'High', tone: 'good' },
];

export const coachMoments = [
  {
    title: 'Lift with intent, cap fatigue',
    body: 'Your readiness is strong, but the seven-day load is rising. Keep today at RPE 7-8 and leave one set in reserve on accessories.',
  },
  {
    title: 'Move zone 2 to the afternoon',
    body: 'Oura-style recovery patterns suggest you absorb endurance volume better after lunch than early morning on strength days.',
  },
  {
    title: 'Re-test ferritin after block 2',
    body: 'Longevity review flags iron-status monitoring as a useful checkpoint if fatigue trends persist through the next mesocycle.',
  },
] as const;

export const planBlocks = [
  {
    week: 'Week 1',
    goal: 'Rebuild aerobic base + tissue tolerance',
    focus: ['3 strength exposures', '2 zone 2 sessions', '1 mobility reset'],
  },
  {
    week: 'Week 2',
    goal: 'Progress strength density',
    focus: ['Lower-body volume wave', 'Sprint mechanics', 'Sleep consistency'],
  },
  {
    week: 'Week 3',
    goal: 'Peak workload before deload',
    focus: ['Threshold intervals', 'Upper-body intensity', 'Travel-ready recovery plan'],
  },
];

export const biomarkers = [
  { name: 'ApoB', latest: '78 mg/dL', status: 'On target', note: 'Maintain current nutrition cadence.' },
  { name: 'HbA1c', latest: '5.3%', status: 'Stable', note: 'Good glycemic control, keep post-meal walks.' },
  { name: 'Vitamin D', latest: '31 ng/mL', status: 'Watch', note: 'Consider supplementation workflow and retest timing.' },
  { name: 'Ferritin', latest: '41 ng/mL', status: 'Context needed', note: 'Interpret alongside load, sleep, and symptoms.' },
] as const;

export const planVsActualPlannedSessions: PlannedSessionForMatching[] = [
  {
    id: 'plan-1',
    sessionDate: '2026-02-07',
    title: 'Long Run',
    discipline: 'Long Run',
    durationMinutes: 180,
    objective: 'Steady uphill aerobic work',
    notes: 'Target 3h with vert',
  },
  {
    id: 'plan-2',
    sessionDate: '2026-02-09',
    title: 'Quality Session',
    discipline: 'Quality',
    durationMinutes: 60,
    objective: 'Threshold intervals',
  },
  {
    id: 'plan-3',
    sessionDate: '2026-02-10',
    title: 'Recovery Run',
    discipline: 'Recovery Run',
    durationMinutes: 45,
    objective: 'Easy aerobic recovery',
  },
  {
    id: 'plan-4',
    sessionDate: '2026-02-12',
    title: 'Aerobic Run',
    discipline: 'Aerobic Run',
    durationMinutes: 75,
    objective: 'Zone 2 volume',
  },
];

export const planVsActualWorkouts: (ActualWorkoutInput & { durationMinutes?: number })[] = [
  {
    source: 'apple_health',
    externalId: 'long-run',
    workoutType: 'Trail Run',
    startedAt: '2026-02-07T14:00:00Z',
    durationMinutes: 170,
    distanceMeters: 30000,
  },
  {
    source: 'manual',
    externalId: 'quality-lite',
    workoutType: 'Interval Run',
    startedAt: '2026-02-09T12:00:00Z',
    durationMinutes: 30,
  },
  {
    source: 'apple_watch',
    externalId: 'bike-sub',
    workoutType: 'Cycling',
    startedAt: '2026-02-10T12:00:00Z',
    durationMinutes: 48,
  },
  {
    source: 'manual',
    externalId: 'off-plan-strength',
    workoutType: 'Strength Training',
    startedAt: '2026-02-11T18:00:00Z',
    durationMinutes: 50,
  },
];
