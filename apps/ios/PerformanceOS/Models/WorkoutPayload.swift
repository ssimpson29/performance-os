import Foundation

struct WorkoutPayload: Codable, Identifiable, Hashable {
    var id: String { externalId }

    let externalId: String
    let workoutType: String
    let startedAt: String
    let endedAt: String?
    let durationSeconds: Int?
    let distanceMeters: Double?
    let energyKcal: Double?
    let avgHeartRate: Int?
    let maxHeartRate: Int?

    static func fallbackExternalId(activityType: String, startedAt: Date, durationSeconds: Int?) -> String {
        let formatter = ISO8601DateFormatter()
        let startedAtString = formatter.string(from: startedAt)
        let durationPart = durationSeconds.map(String.init) ?? "unknown"
        return "healthkit:\(activityType):\(startedAtString):\(durationPart)"
    }
}
