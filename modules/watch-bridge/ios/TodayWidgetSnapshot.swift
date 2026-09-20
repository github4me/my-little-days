import Foundation

/// Deliberately excludes record bodies, personal details and credentials.
struct TodayWidgetSnapshot: Codable, Equatable {
  let schemaVersion: Int
  let binding: String
  let day: String
  let timeZone: String
  let language: String
  /// Canonical app-selected locale. Optional so version 1 snapshots written by
  /// earlier builds continue to decode.
  var locale: String?
  /// Regional formatting locale. Optional for version 1 snapshot compatibility.
  var formattingLocale: String?
  let feedMl: Double
  let diaperCount: Int
  let sleepMinutes: Double
  let updatedAt: Date
  let expiresAt: Date

  static let kind = "LittleDaysToday"
  static let filename = "today-v1.json"
  static let supportedLocales = [
    "en", "zh-Hans", "zh-Hant", "fr", "de", "hi",
    "it", "ja", "ko", "es", "th", "vi",
  ]
  static let defaultFormattingLocales = [
    "en": "en-AU", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW",
    "fr": "fr-FR", "de": "de-DE", "hi": "hi-IN", "it": "it-IT",
    "ja": "ja-JP", "ko": "ko-KR", "es": "es-ES", "th": "th-TH",
    "vi": "vi-VN",
  ]

  init(schemaVersion: Int, binding: String, day: String, timeZone: String,
    language: String, locale: String? = nil, formattingLocale: String? = nil,
    feedMl: Double, diaperCount: Int, sleepMinutes: Double, updatedAt: Date,
    expiresAt: Date) {
    self.schemaVersion = schemaVersion
    self.binding = binding
    self.day = day
    self.timeZone = timeZone
    self.language = language
    self.locale = locale
    self.formattingLocale = formattingLocale
    self.feedMl = feedMl
    self.diaperCount = diaperCount
    self.sleepMinutes = sleepMinutes
    self.updatedAt = updatedAt
    self.expiresAt = expiresAt
  }

  static func canonicalLocale(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized = value.replacingOccurrences(of: "_", with: "-").lowercased()
    if normalized.hasPrefix("zh-") || normalized == "zh" {
      return normalized.contains("hant") || normalized.contains("-tw") ||
        normalized.contains("-hk") || normalized.contains("-mo") ? "zh-Hant" : "zh-Hans"
    }
    let language = normalized.split(separator: "-").first.map(String.init) ?? normalized
    return supportedLocales.first { $0.lowercased() == language }
  }

  static func canonicalFormattingLocale(_ value: String?, for catalog: String) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "_", with: "-")
    guard !normalized.isEmpty, normalized.count <= 64,
          canonicalLocale(normalized) == catalog else { return nil }
    return normalized
  }

  var resolvedLocale: String {
    Self.canonicalLocale(locale) ?? (language == "zh" ? "zh-Hans" : "en")
  }

  var resolvedFormattingLocale: String {
    Self.canonicalFormattingLocale(formattingLocale, for: resolvedLocale)
      ?? Self.defaultFormattingLocales[resolvedLocale] ?? "en-AU"
  }

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
      && language == other.language && resolvedLocale == other.resolvedLocale
      && resolvedFormattingLocale == other.resolvedFormattingLocale && feedMl == other.feedMl
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
