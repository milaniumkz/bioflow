import Foundation

@main
struct DriverPointPolicyTests {
  static func main() {
    let now = Date(timeIntervalSince1970: 1_000)
    let started = now.addingTimeInterval(-10)
    let expires = now.addingTimeInterval(3_600)
    func accepted(_ seconds: Double, start: Date = started, end: Date = expires) -> Bool {
      DriverPointPolicy.accepts(recordedAt: now.addingTimeInterval(seconds), startedAt: start, expiresAt: end, now: now)
    }
    precondition(accepted(0))
    precondition(accepted(-70))
    precondition(!accepted(-71), "Cached GPS predating the server's session window must not enter the outbox")
    precondition(!accepted(-121, start: now.addingTimeInterval(-1_000)))
    precondition(accepted(60))
    precondition(!accepted(61))
    precondition(accepted(0, end: now))
    precondition(!accepted(1, end: now))
    precondition(DriverPointPolicy.recovery(status: 400, count: 10) == .split)
    precondition(DriverPointPolicy.recovery(status: 400, count: 1) == .quarantine)
    precondition(DriverPointPolicy.recovery(status: 401, count: 100) == .quarantine)
    for code in [0, 200, 409, 429, 500, 503] {
      precondition(DriverPointPolicy.recovery(status: code, count: 1) == .retry)
    }
    print("Driver point policy: 17 checks passed")
  }
}
