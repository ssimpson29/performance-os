import Foundation

enum AppConfig {
    /// Replace with a stable deployed API host later.
    static let apiBaseURL = URL(string: "http://10.80.0.210:3000")!

    /// Replace with the signed Apple Health push URL bound to the active user.
    static let appleHealthPushPath = "/api/imports/apple-health/push?userId=REPLACE_ME&signature=REPLACE_ME"

    static var appleHealthPushURL: URL {
        apiBaseURL.appending(path: appleHealthPushPath)
    }

    static let manualSyncFallbackDays = 7
}
