import Foundation

enum APIClientError: LocalizedError {
    case invalidResponse
    case server(statusCode: Int, message: String)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The server returned an invalid response."
        case let .server(statusCode, message):
            return "Server error \(statusCode): \(message)"
        case let .transport(error):
            return error.localizedDescription
        }
    }
}

struct APIClient {
    var pushAppleHealthWorkouts: (_ request: WorkoutSyncRequest) async throws -> Void
}

extension APIClient {
    static let live = APIClient { request in
        var urlRequest = URLRequest(url: AppConfig.appleHealthPushURL)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        do {
            let (_, response) = try await URLSession.shared.data(for: urlRequest)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIClientError.invalidResponse
            }

            guard (200...299).contains(httpResponse.statusCode) else {
                throw APIClientError.server(statusCode: httpResponse.statusCode, message: "Workout sync failed.")
            }
        } catch let error as APIClientError {
            throw error
        } catch {
            throw APIClientError.transport(error)
        }
    }
}
