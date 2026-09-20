import CryptoKit
import Foundation
import WidgetKit

/// Called only on the companion's serialized access queue, including clear.
enum TodayWidgetPublisher {
  static func clear() throws {
    guard let url = TodayWidgetSnapshot.fileURL() else { return }
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
      WidgetCenter.shared.reloadTimelines(ofKind: TodayWidgetSnapshot.kind)
    }
  }

  static func publish(_ context: [String: Any]) throws {
    let now = Date()
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let expires = context["expiresAt"] as? String,
          let expiry = formatter.date(from: expires), expiry > now,
          let day = context["totalsDate"] as? String,
          let workspace = context["workspaceKey"] as? String,
          let generation = context["generation"] as? Int,
          let bridge = context["bridgeId"] as? String,
          let totals = context["widgetTotals"] as? [String: Any],
          let milk = totals["feedMl"] as? Double,
          let nappy = totals["diaperCount"] as? Int,
          let sleep = totals["sleepMinutes"] as? Double else {
      try clear(); return
    }
    let binding = SHA256.hash(data: Data("\(bridge)|\(generation)|\(workspace)".utf8))
      .map { String(format: "%02x", $0) }.joined()
    let language = context["language"] as? String == "zh" ? "zh" : "en"
    let locale = TodayWidgetSnapshot.canonicalLocale(context["locale"] as? String) ??
      (language == "zh" ? "zh-Hans" : "en")
    let snapshot = TodayWidgetSnapshot(schemaVersion: 1, binding: binding,
      day: day, timeZone: TimeZone.current.identifier,
      language: language,
      locale: locale,
      formattingLocale: TodayWidgetSnapshot.canonicalFormattingLocale(
        context["formattingLocale"] as? String, for: locale) ??
        TodayWidgetSnapshot.defaultFormattingLocales[locale],
      feedMl: milk, diaperCount: nappy, sleepMinutes: sleep,
      updatedAt: now, expiresAt: expiry)
    guard snapshot.isCurrent(at: now), var url = TodayWidgetSnapshot.fileURL() else {
      try clear(); return
    }
    if let previous = TodayWidgetSnapshot.read(), snapshot.hasSameContent(as: previous),
       previous.isCurrent(at: now), now.timeIntervalSince(previous.updatedAt) < 900,
       abs(expiry.timeIntervalSince(previous.expiresAt)) < 300 { return }
    do {
      // Exclude the directory before writing data, so atomic replacements also
      // inherit backup exclusion without an intermediate backup-visible window.
      var directory = url.deletingLastPathComponent()
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
      guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
        throw NSError(domain: "LittleDaysWidget", code: 1)
      }
      try JSONEncoder().encode(snapshot).write(to: url,
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      try url.setResourceValues(values)
      guard try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
        throw NSError(domain: "LittleDaysWidget", code: 1)
      }
      WidgetCenter.shared.reloadTimelines(ofKind: TodayWidgetSnapshot.kind)
    } catch {
      try clear()
      throw error
    }
  }
}
