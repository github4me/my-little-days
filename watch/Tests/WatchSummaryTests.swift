import XCTest
@testable import LittleDaysWatchProtocol

final class WatchSummaryTests: XCTestCase {
  private var now: Date { WatchClock.date("2026-09-18T12:30:00Z")! }
  private var utc: Calendar {
    var value = Calendar(identifier: .gregorian)
    value.timeZone = TimeZone(secondsFromGMT: 0)!
    return value
  }
  private func context(sequence: Int = 8, generation: Int = 3, entries: [WatchEntry] = [],
    milk: Double = 0, nappies: Int = 0, sleepRanges: [[Double]]? = []) -> WatchContext {
    WatchContext(schemaVersion: 1, workspaceKey: "family-a", bridgeId: "bridge-a", generation: generation,
      sequence: sequence, status: "ready", mode: "family", expiresAt: "2026-09-19T12:00:00Z",
      publishedAt: "2026-09-18T12:00:00Z", profile: .init(name: "Fixture", birthDate: "2026-01-01"),
      entries: entries, language: "en", totals: .init(feedMl: milk, feedCount: entries.filter { $0.type == "feed" }.count,
        diaperCount: nappies, sleepMinutes: WatchSummary.sleepMinutes(sleepRanges ?? [])),
      totalsDate: "2026-09-18", sleepRanges: sleepRanges)
  }
  private func create(_ entry: WatchEntry) -> WatchCommand {
    WatchCommand(schemaVersion: 1, commandId: UUID().uuidString, recordId: entry.id, workspaceKey: "family-a",
      bridgeId: "bridge-a", generation: 3, snapshotSequence: 8, createdAt: entry.start, kind: "create", entry: entry)
  }
  private func finish(_ entry: WatchEntry, stop: String, amount: Double? = nil, dependency: String? = nil) -> WatchCommand {
    WatchCommand(schemaVersion: 1, commandId: UUID().uuidString, recordId: entry.id, workspaceKey: "family-a",
      bridgeId: "bridge-a", generation: 3, snapshotSequence: 8, createdAt: stop,
      kind: entry.type == "sleep" ? "finish-sleep" : "finish-feed", stoppedAt: stop,
      amount: amount, expectedEntry: entry, dependsOn: dependency)
  }
  private func acknowledge(_ disk: inout WatchDisk, index: Int, sequence: Int, status: String = "saved") {
    let c = disk.outbox[index].command
    disk.outbox[index].receipt = WatchReceipt(schemaVersion: 1, commandId: c.id, recordId: c.recordId,
      workspaceKey: c.workspaceKey, bridgeId: c.bridgeId, generation: c.generation,
      status: status, error: nil, contextSequence: sequence)
    disk.reconcileProjection()
  }
  private func bottle() -> WatchEntry {
    WatchEntry(id: "feed", type: "feed", start: "2026-09-18T12:00:00Z", feedRunning: true, amount: 0, feedKind: "formula")
  }

  func testTotalsUpdateLocallyAndDoNotDoubleCountEitherReceiptArrivalOrder() {
    for snapshotFirst in [false, true] {
      var disk = WatchDisk(context: context(nappies: 2))
      disk.append(create(WatchEntry(id: "nappy", type: "diaper", start: WatchClock.string(now))))
      XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 3)
      if snapshotFirst { disk.acceptContext(context(sequence: 9, nappies: 3)) }
      acknowledge(&disk, index: 0, sequence: 9)
      XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 3)
      if !snapshotFirst { disk.acceptContext(context(sequence: 9, nappies: 3)) }
      XCTAssertNil(disk.summaryBase)
      XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 3)
      disk.acceptContext(context(sequence: 8, nappies: 2))
      XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 3)
    }
  }

  func testMilkBatchPersistsAndCountsSelectedConsumptionOnlyOnce() throws {
    let feed = bottle()
    var disk = WatchDisk(context: context(milk: 100))
    let start = create(feed)
    disk.append(start)
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.feedMl, 100)
    disk.append(finish(feed, stop: WatchClock.string(now), amount: 150, dependency: start.id))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.feedMl, 250)
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.feedCount, 1)
    acknowledge(&disk, index: 0, sequence: 9)
    disk.acceptContext(context(sequence: 9, entries: [feed], milk: 100))
    let restored = try JSONDecoder().decode(WatchDisk.self, from: JSONEncoder().encode(disk))
    XCTAssertEqual(restored.summary(at: now, calendar: utc)?.totals.feedMl, 250)
    disk.acceptContext(context(sequence: 10, milk: 250))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.feedMl, 250)
    acknowledge(&disk, index: 1, sequence: 10)
    XCTAssertNil(disk.summaryBase)
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.feedMl, 250)
  }

  func testPhoneStartedFeedChangesAmountWithoutAddingAnotherFeed() {
    let feed = bottle()
    var disk = WatchDisk(context: context(entries: [feed], milk: 100))
    disk.append(finish(feed, stop: WatchClock.string(now), amount: 150))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.feedMl, 250)
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.feedCount, 1)
  }

  func testRejectedStartAndDependentFinishAreRemovedFromLocalTotals() {
    let feed = bottle()
    var disk = WatchDisk(context: context(milk: 100))
    let start = create(feed)
    disk.append(start)
    disk.append(finish(feed, stop: WatchClock.string(now), amount: 150, dependency: start.id))
    acknowledge(&disk, index: 0, sequence: 9, status: "rejected")
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.feedMl, 100)
    acknowledge(&disk, index: 1, sequence: 9, status: "rejected")
    XCTAssertNil(disk.summaryBase)
  }

  func testCompletedSleepUnionsOverlapsAndMistapAddsNoMinutes() {
    let sleep = WatchEntry(id: "sleep", type: "sleep", start: "2026-09-18T12:00:00Z")
    let beginning = sleep.startedAt.timeIntervalSince1970
    var disk = WatchDisk(context: context(entries: [sleep], sleepRanges: [[beginning - 600, beginning + 600]]))
    disk.append(finish(sleep, stop: "2026-09-18T12:20:00Z"))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.sleepMinutes, 30)
    disk = WatchDisk(context: context())
    let start = create(sleep)
    disk.append(start)
    disk.append(finish(sleep, stop: "2026-09-18T12:00:59Z", dependency: start.id))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.sleepMinutes, 0)
    disk = WatchDisk(context: context(entries: [sleep]))
    disk.append(finish(sleep, stop: "2026-09-18T12:01:00Z"))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.sleepMinutes, 1)
  }

  func testNewDayNeverRelabelsYesterdayTotalsAndScopeChangesClearOverlay() {
    let nextDay = WatchClock.date("2026-09-19T00:10:00Z")!
    var disk = WatchDisk(context: context(milk: 250, nappies: 4))
    disk.append(create(WatchEntry(id: "nappy", type: "diaper", start: WatchClock.string(nextDay))))
    let summary = disk.summary(at: nextDay, calendar: utc)
    XCTAssertEqual(summary?.totals.diaperCount, 1)
    XCTAssertEqual(summary?.totals.feedMl, 0)
    XCTAssertEqual(summary?.needsPhoneUpdate, true)
    disk.acceptContext(context(sequence: 9, generation: 4))
    XCTAssertNil(disk.summaryBase)
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 0)
    XCTAssertNil(disk.summary(at: WatchClock.date("2026-09-20T00:00:00Z")!, calendar: utc))
  }

  func testMissingSleepMetadataUsesPhoneTotalRatherThanInventingOverlapAccuracy() {
    let sleep = WatchEntry(id: "sleep", type: "sleep", start: "2026-09-18T12:00:00Z")
    var disk = WatchDisk(context: context(entries: [sleep], sleepRanges: nil))
    disk.append(finish(sleep, stop: "2026-09-18T12:20:00Z"))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.sleepMinutes, 0)
  }

  func testPartialBatchAndNewLocalActionDoNotLoseAcknowledgedContribution() {
    var disk = WatchDisk(context: context(nappies: 2))
    for id in ["first", "second"] {
      disk.append(create(WatchEntry(id: id, type: "diaper", start: WatchClock.string(now))))
    }
    disk.acceptContext(context(sequence: 9, nappies: 3))
    acknowledge(&disk, index: 0, sequence: 9, status: "pending")
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 4)
    disk.append(create(WatchEntry(id: "third", type: "diaper", start: WatchClock.string(now))))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 5)
    disk.acceptContext(context(sequence: 10, nappies: 5))
    acknowledge(&disk, index: 1, sequence: 10, status: "pending")
    acknowledge(&disk, index: 2, sequence: 10, status: "pending")
    XCTAssertNil(disk.summaryBase)
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 5)
    XCTAssertTrue(disk.outbox.allSatisfy { !$0.terminal }, "Local projection is not server confirmation")
  }

  func testPhonePauseHidesButDoesNotDropDurableProjection() throws {
    var disk = WatchDisk(context: context(nappies: 2))
    disk.append(create(WatchEntry(id: "nappy", type: "diaper", start: WatchClock.string(now))))
    var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(context(sequence: 9))) as? [String: Any])
    json["status"] = "unavailable"
    let paused = try JSONDecoder().decode(WatchContext.self, from: JSONSerialization.data(withJSONObject: json))
    disk.acceptContext(paused)
    XCTAssertNil(disk.summary(at: now, calendar: utc))
    XCTAssertNotNil(disk.summaryBase)
    disk.acceptContext(context(sequence: 10, nappies: 2))
    XCTAssertEqual(disk.summary(at: now, calendar: utc)?.totals.diaperCount, 3)
  }
}
