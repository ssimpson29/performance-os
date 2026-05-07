export function normalizeImportedWorkoutType(label: string): string {
  if (label === 'Outdoor Run') return 'Running';
  return label;
}
