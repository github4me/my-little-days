import XCTest
@testable import LittleDaysWidgetModel

final class TodayWidgetSnapshotTests: XCTestCase {
  private var calendar: Calendar {
    var value = Calendar(identifier: .gregorian)
    value.timeZone = TimeZone(identifier: "Australia/Sydney")!
    return value
  }
  private func fixture(_ now: Date, milk: Double = 150, locale: String? = nil,
    formattingLocale: String? = nil) -> TodayWidgetSnapshot {
    TodayWidgetSnapshot(schemaVersion: 1, binding: "opaque", day: TodayWidgetSnapshot.dayKey(now, calendar: calendar),
      timeZone: calendar.timeZone.identifier, language: "en", locale: locale,
      formattingLocale: formattingLocale, feedMl: milk, diaperCount: 0, sleepMinutes: 0,
      updatedAt: now, expiresAt: now.addingTimeInterval(3600))
  }
  func testZeroAndRoundTrip() throws {
    let now = ISO8601DateFormatter().date(from: "2026-09-18T00:00:00Z")!
    let data = try JSONEncoder().encode(fixture(now, milk: 0))
    let snapshot = try JSONDecoder().decode(TodayWidgetSnapshot.self, from: data)
    XCTAssertTrue(snapshot.isCurrent(at: now, calendar: calendar))
    XCTAssertEqual(snapshot.feedMl, 0)
  }
  func testExpiryAndClockRollbackHideData() {
    let now = Date()
    let snapshot = fixture(now)
    XCTAssertFalse(snapshot.isCurrent(at: now.addingTimeInterval(3600), calendar: calendar))
    XCTAssertFalse(snapshot.isCurrent(at: now.addingTimeInterval(-61), calendar: calendar))
  }
  func testMidnightAndTimeZoneChangeHideYesterday() {
    let now = ISO8601DateFormatter().date(from: "2026-09-18T13:59:00Z")!
    let snapshot = fixture(now)
    XCTAssertTrue(snapshot.isCurrent(at: now, calendar: calendar))
    XCTAssertFalse(snapshot.isCurrent(at: now.addingTimeInterval(60), calendar: calendar))
    var changed = calendar
    changed.timeZone = TimeZone(identifier: "UTC")!
    XCTAssertFalse(snapshot.isCurrent(at: now, calendar: changed))
  }
  func testDSTDayKeyAndCorruptTotals() {
    let now = ISO8601DateFormatter().date(from: "2026-10-03T16:30:00Z")!
    XCTAssertEqual(TodayWidgetSnapshot.dayKey(now, calendar: calendar), "2026-10-04")
    XCTAssertFalse(fixture(now, milk: -.infinity).isCurrent(at: now, calendar: calendar))
    XCTAssertFalse(fixture(now, milk: -1).isCurrent(at: now, calendar: calendar))
  }
  func testChangesInvalidateDeduplication() {
    let now = Date()
    XCTAssertTrue(fixture(now).hasSameContent(as: fixture(now.addingTimeInterval(1))))
    XCTAssertTrue(fixture(now).hasSameContent(as: fixture(now, locale: "en")),
      "Adding an equivalent canonical locale does not change rendered content")
    XCTAssertTrue(fixture(now).hasSameContent(as: fixture(now, locale: "en", formattingLocale: "en-AU")))
    XCTAssertFalse(fixture(now).hasSameContent(as: fixture(now, locale: "en", formattingLocale: "en-US")))
    XCTAssertFalse(fixture(now).hasSameContent(as: fixture(now, locale: "fr")))
    XCTAssertFalse(fixture(now).hasSameContent(as: fixture(now, milk: 90)))
  }

  func testLegacySnapshotDecodesAndCanonicalLocaleHandlesRegionAliases() throws {
    let now = Date()
    let data = try JSONEncoder().encode(fixture(now))
    let legacy = try JSONDecoder().decode(TodayWidgetSnapshot.self, from: data)
    XCTAssertNil(legacy.locale)
    XCTAssertNil(legacy.formattingLocale)
    XCTAssertEqual(legacy.resolvedLocale, "en")
    XCTAssertEqual(legacy.resolvedFormattingLocale, "en-AU")
    XCTAssertEqual(TodayWidgetSnapshot.canonicalLocale("zh_TW"), "zh-Hant")
    XCTAssertEqual(TodayWidgetSnapshot.canonicalLocale("es-MX"), "es")
    XCTAssertNil(TodayWidgetSnapshot.canonicalLocale("ar"))
    XCTAssertEqual(TodayWidgetSnapshot.canonicalFormattingLocale("fr_CA", for: "fr"), "fr-CA")
    XCTAssertNil(TodayWidgetSnapshot.canonicalFormattingLocale("en-US", for: "fr"))
  }
}
