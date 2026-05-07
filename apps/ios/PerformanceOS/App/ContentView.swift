import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem {
                    Label("Today", systemImage: "sun.max.fill")
                }

            PlanView()
                .tabItem {
                    Label("Plan", systemImage: "calendar")
                }

            RecoveryView()
                .tabItem {
                    Label("Recovery", systemImage: "heart.text.square")
                }

            SyncSettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
    }
}
