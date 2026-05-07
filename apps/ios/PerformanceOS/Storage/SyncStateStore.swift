import Foundation

final class SyncStateStore {
    private let key = "performance_os_sync_state"
    private let defaults = UserDefaults.standard

    func load() -> SyncState {
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode(SyncState.self, from: data) else {
            return .empty
        }

        return decoded
    }

    func save(_ state: SyncState) {
        guard let data = try? JSONEncoder().encode(state) else {
            return
        }

        defaults.set(data, forKey: key)
    }
}
