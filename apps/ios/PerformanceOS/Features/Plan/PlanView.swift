import SwiftUI

struct PlanView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Plan") {
                    Text("Plan view will reuse backend plan-vs-actual data.")
                    Text("This stays intentionally thin in v1.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Plan")
        }
    }
}
