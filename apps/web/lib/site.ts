export const appConfig = {
  name: 'Performance OS',
  tagline: 'A personal performance operating system for training, recovery, and longevity.',
  navigation: [
    { href: '/today', label: 'Today' },
    { href: '/plan', label: 'Plan' },
    { href: '/recovery', label: 'Recovery' },
    { href: '/longevity', label: 'Longevity' },
    { href: '/coach', label: 'Coach' },
    { href: '/settings/integrations', label: 'Integrations' },
  ],
} as const;

export const integrations = [
  {
    name: 'Apple Health / Apple Watch',
    status: 'Priority',
    notes: 'Primary workout, HR, HRV, sleep, and activity data source for MVP.',
  },
  {
    name: 'Oura',
    status: 'Planned',
    notes: 'Recovery overlays including readiness, sleep timing, and resilience trends.',
  },
  {
    name: 'CSV / Excel plan import',
    status: 'Planned',
    notes: 'Bootstrap coach-authored programming before in-app plan builder matures.',
  },
  {
    name: 'Blood work uploads',
    status: 'Exploration',
    notes: 'Labs normalized into a longitudinal biomarker timeline with coaching prompts.',
  },
] as const;
