import Foundation

enum DriverPointPolicy {
  enum Recovery: Equatable { case retry, split, quarantine }

  static func accepts(recordedAt: Date, startedAt: Date, expiresAt: Date, now: Date) -> Bool {
    recordedAt >= startedAt.addingTimeInterval(-60)
      && recordedAt > now.addingTimeInterval(-120)
      && recordedAt <= min(now.addingTimeInterval(60), expiresAt)
  }

  static func recovery(status: Int, count: Int) -> Recovery {
    if status == 401 { return .quarantine }
    guard status == 400 else { return .retry }
    return count > 1 ? .split : .quarantine
  }
}
