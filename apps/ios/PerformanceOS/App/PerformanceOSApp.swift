import SwiftUI

@main
struct PerformanceOSApp: App {
    @StateObject private var syncViewModel = SyncStatusViewModel(
        syncService: WorkoutSyncService.live,
        stateStore: SyncStateStore()
    )

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(syncViewModel)
                .task {
                    await syncViewModel.loadState()
                }
        }
    }
}
