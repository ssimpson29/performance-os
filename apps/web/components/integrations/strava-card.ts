import * as React from 'react';

import { DisconnectIntegrationButton } from './disconnect-integration-button';
import { RegisterStravaWebhookButton } from './register-strava-webhook-button';
import { SyncStravaButton } from './sync-strava-button';

export type StravaIntegrationState =
  | { connected: false }
  | {
      connected: true;
      lastSyncedAt: string | null;
      externalUserId: string | null;
      status: string | null;
    };

function formatLastSynced(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'never';
  return date.toUTCString();
}

/**
 * Post-auth Strava connection card. Server component; the page resolves the
 * athlete's Strava integration row and passes the derived state in. Mirrors
 * the OuraUserBindingCard pattern.
 *
 * - When `connected` is false → "Connect Strava" link to
 *   `/api/imports/strava/connect`, which redirects to Strava's OAuth screen.
 * - When `connected` is true → shows the last-synced timestamp plus a
 *   "Sync now" button (client wedge) that POSTs to /api/sync/strava and
 *   surfaces the summary inline.
 */
export function StravaCard({ state }: { state: StravaIntegrationState }) {
  const heading = state.connected ? 'Strava is connected.' : 'Connect your Strava account.';
  const blurb = state.connected
    ? 'Performance OS pulls your recent Strava activities, deduplicates against Apple-sourced workouts, and forwards your Strava descriptions onto the canonical Apple row.'
    : 'OAuth-binds your Strava account so written workout notes flow into the canonical Apple-sourced workout row (Apple still owns the HR/distance/duration metrics).';

  const body: React.ReactNode[] = [
    React.createElement('p', { key: 'eyebrow', className: 'eyebrow' }, 'Strava connection'),
    React.createElement(
      'h3',
      { key: 'h3', className: 'mt-2 text-xl font-semibold text-white' },
      heading,
    ),
    React.createElement(
      'p',
      { key: 'blurb', className: 'mt-2 text-sm leading-6 text-muted' },
      blurb,
    ),
  ];

  if (state.connected) {
    body.push(
      React.createElement(
        'div',
        {
          key: 'panel',
          className: 'mt-4 rounded-2xl border border-white/5 bg-black/20 p-4',
        },
        React.createElement(
          'p',
          { key: 'panel-label', className: 'text-xs uppercase tracking-[0.18em] text-brand2' },
          'Status',
        ),
        React.createElement(
          'p',
          { key: 'panel-status', className: 'mt-2 text-sm font-medium text-white' },
          state.status ?? 'active',
        ),
        React.createElement(
          'p',
          { key: 'panel-last', className: 'mt-2 text-sm text-muted' },
          `Last synced: ${formatLastSynced(state.lastSyncedAt)}`,
        ),
        state.externalUserId
          ? React.createElement(
              'p',
              { key: 'panel-ext', className: 'mt-1 text-xs text-muted' },
              `Strava athlete ID: ${state.externalUserId}`,
            )
          : null,
        React.createElement(
          'div',
          { key: 'panel-actions', className: 'mt-4 flex flex-wrap items-center gap-3' },
          React.createElement(SyncStravaButton, { key: 'sync-btn' }),
          React.createElement(RegisterStravaWebhookButton, { key: 'register-webhook-btn' }),
          React.createElement(DisconnectIntegrationButton, { key: 'disconnect-btn', provider: 'strava', label: 'Strava' }),
          React.createElement(
            'a',
            {
              key: 'reconnect',
              href: '/api/imports/strava/connect',
              className: 'text-sm text-brand2 underline-offset-4 hover:underline',
            },
            'Reconnect',
          ),
        ),
        React.createElement(
          'p',
          { key: 'webhook-hint', className: 'mt-3 text-xs text-muted' },
          'Register webhook once per deployment to get real-time push from Strava after each activity.',
        ),
      ),
    );
  } else {
    body.push(
      React.createElement(
        'div',
        {
          key: 'connect-panel',
          className: 'mt-4 rounded-2xl border border-white/5 bg-black/20 p-4',
        },
        React.createElement(
          'p',
          { key: 'cp-eyebrow', className: 'text-xs uppercase tracking-[0.18em] text-brand2' },
          'Not connected',
        ),
        React.createElement(
          'p',
          { key: 'cp-blurb', className: 'mt-2 text-sm text-muted' },
          'You’ll be redirected to Strava to authorize read access to your recent activities.',
        ),
        React.createElement(
          'a',
          {
            key: 'cp-link',
            href: '/api/imports/strava/connect',
            className: 'mt-4 inline-flex rounded-full bg-brand2 px-4 py-2 text-sm font-medium text-black',
          },
          'Connect Strava',
        ),
      ),
    );
  }

  return React.createElement(
    'div',
    { className: 'rounded-2xl border border-white/5 bg-white/[0.03] p-5' },
    body,
  );
}
