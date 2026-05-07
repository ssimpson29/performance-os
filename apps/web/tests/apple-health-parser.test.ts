import { describe, expect, it } from 'vitest';

import { parseAppleHealthWorkoutExport } from '../lib/apple-health/workout-parser';

describe('parseAppleHealthWorkoutExport', () => {
  it('extracts Apple Health workouts into the normalized workout import shape', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="3600" durationUnit="min" startDate="2026-02-07 14:00:00 -0700" endDate="2026-02-07 15:00:00 -0700" totalDistance="16093.4" totalDistanceUnit="m" totalEnergyBurned="1200" totalEnergyBurnedUnit="kcal" sourceName="Scott’s Apple Watch" sourceVersion="10.4">
    <MetadataEntry key="HKIndoorWorkout" value="0"/>
    <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="152" minimum="120" maximum="176" unit="count/min"/>
  </Workout>
  <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" durationUnit="min" startDate="2026-02-08 18:00:00 -0700" endDate="2026-02-08 18:45:00 -0700" totalEnergyBurned="320" totalEnergyBurnedUnit="kcal" sourceName="Scott’s Apple Watch" sourceVersion="10.4"/>
</HealthData>`;

    const parsed = parseAppleHealthWorkoutExport(xml);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      source: 'apple_health',
      externalId: 'apple_health:2026-02-07T21:00:00.000Z:HKWorkoutActivityTypeRunning',
      workoutType: 'Outdoor Run',
      startedAt: '2026-02-07T21:00:00.000Z',
      endedAt: '2026-02-07T22:00:00.000Z',
      localDate: '2026-02-07',
      durationSeconds: 3600,
      distanceMeters: 16093.4,
      energyKcal: 1200,
      avgHeartRate: 152,
      maxHeartRate: 176,
    });
    expect(parsed[0].metadata).toMatchObject({
      sourceName: 'Scott’s Apple Watch',
      activityType: 'HKWorkoutActivityTypeRunning',
      indoorWorkout: false,
    });

    expect(parsed[1]).toMatchObject({
      workoutType: 'Strength Training',
      durationSeconds: 2700,
      energyKcal: 320,
    });
  });

  it('ignores non-workout content and returns an empty array when no workouts exist', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><HealthData><Record type="HKQuantityTypeIdentifierStepCount" value="100"/></HealthData>`;

    expect(parseAppleHealthWorkoutExport(xml)).toEqual([]);
  });
});
