import SwiftUI

struct SyncSettingsView: View {
    @EnvironmentObject private var viewModel: SyncStatusViewModel

    var body: some View {
        NavigationStack {
            List {
                Section("Apple Health sync") {
                    LabeledContent("Last attempt", value: formatted(viewModel.state.lastAttemptAt))
                    LabeledContent("Last success", value: formatted(viewModel.state.lastSuccessfulSyncAt))
                    LabeledContent("Last count", value: viewModel.state.lastSyncedWorkoutCount.map(String.init) ?? "—")

                    if let lastError = viewModel.state.lastErrorMessage {
                        Text(lastError)
                            .foregroundStyle(.red)
                    }

                    Button(viewModel.isSyncing ? "Syncing…" : "Sync now") {
                        Task {
                            await viewModel.syncNow()
                        }
                    }
                    .disabled(viewModel.isSyncing)
                }

                Section("Notes") {
                    Text("Use the signed Apple Health push endpoint already implemented in the backend.")
                    Text("Background refresh can be added after the manual sync path is solid.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func formatted(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
