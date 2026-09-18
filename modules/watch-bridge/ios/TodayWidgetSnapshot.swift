import Foundation

/// Deliberately excludes record bodies, personal details and credentials.
struct TodayWidgetSnapshot: Codable, Equatable {
  let schemaVersion: Int
  let binding: String
  let day: String
  let timeZone: String
  let language: String
  let feedMl: Double
  let diaperCount: Int
  let sleepMinutes: Double
  let updatedAt: Date
  let expiresAt: Date

  static let kind = "LittleDaysToday"
  static let filename = "today-v1.json"

  static var localCalendar: Calendar { Calendar(identifier: .gregorian) }

  static func dayKey(_ date: Date, calendar: Calendar = localCalendar) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  func isCurrent(at date: Date, calendar: Calendar = localCalendar) -> Bool {
    schemaVersion == 1 && date < expiresAt && updatedAt <= date.addingTimeInterval(60)
      && day == Self.dayKey(date, calendar: calendar)
      && timeZone == calendar.timeZone.identifier
      && feedMl.isFinite && feedMl >= 0 && diaperCount >= 0
      && sleepMinutes.isFinite && sleepMinutes >= 0
  }

  func hasSameContent(as other: Self) -> Bool {
    binding == other.binding && day == other.day && timeZone == other.timeZone
      && language == other.language && feedMl == other.feedMl
      && diaperCount == other.diaperCount
      && displaySleepHours == other.displaySleepHours
  }

  // One rounding policy for rendering and reload deduplication, including ties.
  var displaySleepHours: Double { (sleepMinutes / 6).rounded() / 10 }

  #if os(iOS)
  static func fileURL() -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "LittleDaysWidgetAppGroup") as? String,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent("LittleDaysWidget", isDirectory: true).appendingPathComponent(filename)
  }

  static func read() -> Self? {
    guard let url = fileURL(), let data = try? Data(contentsOf: url), data.count <= 4096 else { return nil }
    return try? JSONDecoder().decode(Self.self, from: data)
  }
  #endif
}
