import Foundation

struct SyncState: Codable, Equatable {
    var lastAttemptAt: Date?
    var lastSuccessfulSyncAt: Date?
    var lastErrorMessage: String?
    var lastSyncedWorkoutCount: Int?

    static let empty = SyncState(
        lastAttemptAt: nil,
        lastSuccessfulSyncAt: nil,
        lastErrorMessage: nil,
        lastSyncedWorkoutCount: nil
    )
}
