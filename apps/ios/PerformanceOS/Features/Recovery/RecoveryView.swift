import SwiftUI

struct RecoveryView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Recovery") {
                    Text("Recovery screen will consume Oura-backed backend data.")
                    Text("Keep the source of truth in the backend, not locally.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Recovery")
        }
    }
}
