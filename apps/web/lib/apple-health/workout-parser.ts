import type { ActualWorkoutInput } from '@/lib/training-plan/types';

type ParsedAttributes = Record<string, string>;

const WORKOUT_TYPE_LABELS: Record<string, string> = {
  HKWorkoutActivityTypeRunning: 'Outdoor Run',
  HKWorkoutActivityTypeTraditionalStrengthTraining: 'Strength Training',
  HKWorkoutActivityTypeCycling: 'Cycling',
  HKWorkoutActivityTypeHiking: 'Hiking',
  HKWorkoutActivityTypeWalking: 'Walking',
};

function parseAttributes(raw: string): ParsedAttributes {
  const attributes: ParsedAttributes = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function normalizeAppleDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  if (!match) return undefined;
  return new Date(`${match[1]}T${match[2]}${match[3]}:${match[4]}`).toISOString();
}

function toNumber(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function durationToSeconds(
  value: string | undefined,
  unit: string | undefined,
  startedAtIso?: string,
  endedAtIso?: string,
): number | undefined {
  if (startedAtIso && endedAtIso) {
    const delta = Math.round((new Date(endedAtIso).getTime() - new Date(startedAtIso).getTime()) / 1000);
    if (Number.isFinite(delta) && delta > 0) {
      return delta;
    }
  }

  const parsed = toNumber(value);
  if (parsed == null) return undefined;
  switch (unit) {
    case 'min':
      return Math.round(parsed * 60);
    case 's':
    case 'sec':
    case 'second':
      return Math.round(parsed);
    case 'h':
    case 'hr':
      return Math.round(parsed * 3600);
    default:
      return Math.round(parsed * 60);
  }
}

function mapWorkoutType(activityType: string | undefined): string {
  if (!activityType) return 'Workout';
  return WORKOUT_TYPE_LABELS[activityType] ?? activityType.replace('HKWorkoutActivityType', '');
}

function parseHeartRate(block: string): { avgHeartRate?: number; maxHeartRate?: number } {
  const statsMatch = block.match(/<WorkoutStatistics\b([^>]*)\/>/);
  if (!statsMatch) return {};
  const attributes = parseAttributes(statsMatch[1]);
  if (attributes.type !== 'HKQuantityTypeIdentifierHeartRate') return {};
  return {
    avgHeartRate: toNumber(attributes.average),
    maxHeartRate: toNumber(attributes.maximum),
  };
}

function parseMetadata(block: string): Record<string, unknown> {
  const metadataMatch = block.match(/<MetadataEntry\b([^>]*)\/>/);
  const attributes = metadataMatch ? parseAttributes(metadataMatch[1]) : {};
  return {
    indoorWorkout: attributes.key === 'HKIndoorWorkout' ? attributes.value === '1' : undefined,
  };
}

export function parseAppleHealthWorkoutExport(xml: string): ActualWorkoutInput[] {
  const workouts: ActualWorkoutInput[] = [];
  const regex = /<Workout\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Workout>)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const innerBlock = match[2] ?? '';
    const startedAt = normalizeAppleDate(attributes.startDate);
    const endedAt = normalizeAppleDate(attributes.endDate);
    if (!startedAt) continue;

    const heartRate = parseHeartRate(innerBlock);
    const metadata = parseMetadata(innerBlock);
    const workoutType = mapWorkoutType(attributes.workoutActivityType);

    workouts.push({
      source: 'apple_health',
      externalId: `apple_health:${startedAt}:${attributes.workoutActivityType}`,
      workoutType,
      startedAt,
      endedAt,
      localDate: startedAt.slice(0, 10),
      durationSeconds: durationToSeconds(attributes.duration, attributes.durationUnit, startedAt, endedAt),
      distanceMeters: toNumber(attributes.totalDistance),
      energyKcal: toNumber(attributes.totalEnergyBurned),
      avgHeartRate: heartRate.avgHeartRate,
      maxHeartRate: heartRate.maxHeartRate,
      metadata: {
        sourceName: attributes.sourceName,
        sourceVersion: attributes.sourceVersion,
        activityType: attributes.workoutActivityType,
        ...metadata,
      },
      rawPayload: {
        workoutAttributes: attributes,
      },
    });
  }

  return workouts;
}
