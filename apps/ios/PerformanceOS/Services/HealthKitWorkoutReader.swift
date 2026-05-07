import Foundation
import HealthKit

final class HealthKitWorkoutReader {
    private let healthStore = HKHealthStore()
    private let isoFormatter = ISO8601DateFormatter()

    func requestAuthorization() async throws {
        let workoutType = HKObjectType.workoutType()
        try await healthStore.requestAuthorization(toShare: [], read: [workoutType])
    }

    func fetchWorkouts(since date: Date?) async throws -> [WorkoutPayload] {
        let startDate = date ?? Calendar.current.date(byAdding: .day, value: -AppConfig.manualSyncFallbackDays, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: predicate,
                limit: 50,
                sortDescriptors: [sortDescriptor]
            ) { [weak self] _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let self, let workouts = samples as? [HKWorkout] else {
                    continuation.resume(returning: [])
                    return
                }

                let payloads = workouts.map { workout in
                    let durationSeconds = Int(workout.duration.rounded())
                    return WorkoutPayload(
                        externalId: workout.uuid.uuidString,
                        workoutType: self.label(for: workout.workoutActivityType),
                        startedAt: self.isoFormatter.string(from: workout.startDate),
                        endedAt: self.isoFormatter.string(from: workout.endDate),
                        durationSeconds: durationSeconds,
                        distanceMeters: self.distanceMeters(for: workout),
                        energyKcal: self.energyKilocalories(for: workout),
                        avgHeartRate: nil,
                        maxHeartRate: nil
                    )
                }

                continuation.resume(returning: payloads)
            }

            healthStore.execute(query)
        }
    }

    private func label(for activityType: HKWorkoutActivityType) -> String {
        switch activityType {
        case .running: return "Outdoor Run"
        case .walking: return "Walking"
        case .hiking: return "Hiking"
        case .cycling: return "Cycling"
        case .traditionalStrengthTraining: return "Strength Training"
        default: return String(describing: activityType)
        }
    }

    private func distanceMeters(for workout: HKWorkout) -> Double? {
        workout.totalDistance?.doubleValue(for: .meter())
    }

    private func energyKilocalories(for workout: HKWorkout) -> Double? {
        workout.totalEnergyBurned?.doubleValue(for: .kilocalorie())
    }
}
