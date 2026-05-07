import Foundation

struct WorkoutSyncService {
    var syncRecentWorkouts: (_ lastSuccessfulSyncAt: Date?) async throws -> Int
}

extension WorkoutSyncService {
    static let live = WorkoutSyncService { lastSuccessfulSyncAt in
        let reader = HealthKitWorkoutReader()
        let apiClient = APIClient.live

        try await reader.requestAuthorization()
        let workouts = try await reader.fetchWorkouts(since: lastSuccessfulSyncAt)

        guard !workouts.isEmpty else {
            return 0
        }

        try await apiClient.pushAppleHealthWorkouts(WorkoutSyncRequest(workouts: workouts))
        return workouts.count
    }
}
