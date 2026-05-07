import Foundation

struct WorkoutSyncRequest: Codable {
    let workouts: [WorkoutPayload]
}
