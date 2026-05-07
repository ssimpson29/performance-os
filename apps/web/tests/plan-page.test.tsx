import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildPlanVsActualPreview } from '../app/plan/plan-vs-actual-data';
import { PlanVsActualSection } from '../app/plan/plan-vs-actual-section';

describe('Plan page plan-vs-actual UI', () => {
  it('renders informational adherence states and off-plan workouts without gamification', () => {
    const preview = buildPlanVsActualPreview();
    const html = renderToStaticMarkup(
      React.createElement(PlanVsActualSection, {
        preview,
      }),
    );

    expect(preview.sessions.map((session) => session.status)).toEqual(
      expect.arrayContaining(['completed', 'partial', 'substituted', 'missed']),
    );
    expect(preview.offPlanWorkouts).toHaveLength(1);

    expect(html).toContain('Plan vs actual');
    expect(html).toContain('Completed');
    expect(html).toContain('Partial');
    expect(html).toContain('Substituted');
    expect(html).toContain('Missed');
    expect(html).toContain('Off-plan workouts');
    expect(html).not.toContain('streak');
    expect(html).not.toContain('points');
    expect(html).not.toContain('confetti');
    expect(html).not.toContain('badge');
  });

  it('renders a calm empty state when no imported plan or workout data exists yet', () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanVsActualSection, {
        preview: {
          dataSource: 'live',
          planName: null,
          sessions: [],
          offPlanWorkouts: [],
          summary: {
            completed: 0,
            partial: 0,
            substituted: 0,
            missed: 0,
            offPlan: 0,
          },
        },
      }),
    );

    expect(html).toContain('No imported plan or workout data yet');
    expect(html).toContain('Import a training plan and actual workouts to start comparing plan vs actual.');
  });
});
