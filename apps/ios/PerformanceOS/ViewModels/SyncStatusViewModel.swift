import Foundation
import SwiftUI

@MainActor
final class SyncStatusViewModel: ObservableObject {
    @Published private(set) var state: SyncState = .empty
    @Published private(set) var isSyncing = false

    private let syncService: WorkoutSyncService
    private let stateStore: SyncStateStore

    init(syncService: WorkoutSyncService, stateStore: SyncStateStore) {
        self.syncService = syncService
        self.stateStore = stateStore
    }

    func loadState() async {
        state = stateStore.load()
    }

    func syncNow() async {
        isSyncing = true
        var nextState = state
        nextState.lastAttemptAt = Date()
        nextState.lastErrorMessage = nil
        state = nextState
        stateStore.save(nextState)

        do {
            let syncedCount = try await syncService.syncRecentWorkouts(state.lastSuccessfulSyncAt)
            nextState.lastSuccessfulSyncAt = Date()
            nextState.lastSyncedWorkoutCount = syncedCount
            nextState.lastErrorMessage = nil
        } catch {
            nextState.lastErrorMessage = error.localizedDescription
        }

        state = nextState
        stateStore.save(nextState)
        isSyncing = false
    }
}
