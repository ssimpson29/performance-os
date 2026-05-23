export const appConfig = {
  name: 'Performance OS',
  tagline: 'A personal performance operating system for training, recovery, and longevity.',
  // Live, athlete-facing surfaces. /today and /recovery exist as direct-URL
  // routes but are 'Preview' placeholders right now (see audit follow-ups) —
  // not surfaced here so signed-in athletes aren't routed to dead ends.
  navigation: [
    { href: '/plan', label: 'Plan' },
    { href: '/coach', label: 'Coach' },
    { href: '/longevity', label: 'Longevity' },
    { href: '/settings/integrations', label: 'Integrations' },
    { href: '/account', label: 'Account' },
  ],
} as const;

// Status values: 'Live' (shipped end-to-end), 'Beta' (works but rough edges),
// 'Planned' (designed, not built), 'Exploration' (idea stage).
// Keep this list honest — anyone landing on the home page should see what
// they can actually do today, not what's on the roadmap.
export const integrations = [
  {
    name: 'Training plan import (Excel)',
    status: 'Live',
    notes: 'Upload a workbook at /plan/import. Parser extracts weekly structure, phase blocks, and race context, then powers the race-aware adaptive coach.',
  },
  {
    name: 'Apple Health / Apple Watch',
    status: 'Live',
    notes: 'Signed iPhone Shortcut and native iOS app both POST workouts to /api/imports/apple-health/push. Workouts land in Supabase and feed the coach.',
  },
  {
    name: 'Oura',
    status: 'Live',
    notes: 'OAuth flow at /api/imports/oura/connect. Daily recovery, sleep, and readiness sync into recovery_daily and feed the coach\'s recovery trend detection.',
  },
  {
    name: 'Blood work uploads (image or JSON)',
    status: 'Live',
    notes: 'Vision LLM extracts panels from a lab report image at /longevity/import; or POST structured JSON to /api/imports/biomarker-panel. Feeds the Longevity Guru\'s reference-range and trend layers.',
  },
] as const;
