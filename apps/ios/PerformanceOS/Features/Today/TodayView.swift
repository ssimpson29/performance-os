import SwiftUI

struct TodayView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Today") {
                    Text("Native athlete command surface starts here.")
                    Text("Next slice: fetch backend Today summary and coach recommendation.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Today")
        }
    }
}
