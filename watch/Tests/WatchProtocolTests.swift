import XCTest
@testable import LittleDaysWatchProtocol

final class WatchProtocolTests: XCTestCase {
  private func context(_ generation: Int = 3, sequence: Int = 8, workspace: String = "family-a", entries: [WatchEntry] = []) -> WatchContext {
    WatchContext(schemaVersion: 1, workspaceKey: workspace, bridgeId: "bridge-a", generation: generation, sequence: sequence,
      status: "ready", mode: "family", expiresAt: "2026-09-19T12:00:00Z", publishedAt: "2026-09-18T12:00:00Z",
      profile: .init(name: "Fixture", birthDate: "2026-01-01"), entries: entries, language: "en",
      totals: .init(feedMl: 0, feedCount: 0, diaperCount: 0, sleepMinutes: 0))
  }

  func testCanonicalLocalePrefersNewFieldAndKeepsLegacyFallbacks() throws {
    XCTAssertEqual(WatchLocale.supported.count, 12)
    XCTAssertEqual(WatchLocale.canonical("zh_TW"), "zh-Hant")
    XCTAssertEqual(WatchLocale.canonical("fr-CA"), "fr")
    XCTAssertEqual(WatchLocale.resolve(locale: "ja", language: "en"), "ja")
    XCTAssertEqual(WatchLocale.resolve(locale: nil, language: "zh"), "zh-Hans")
    XCTAssertEqual(WatchLocale.resolve(locale: "unsupported", language: "en"), "en")
    XCTAssertEqual(WatchLocale.resolveFormatting(locale: "fr", language: "en",
      formattingLocale: "fr-CA"), "fr-CA")
    XCTAssertEqual(WatchLocale.resolveFormatting(locale: "fr", language: "en",
      formattingLocale: "en-US"), "fr-FR", "A mismatched region cannot override the catalog language")
    XCTAssertEqual(WatchLocale.resolveFormatting(locale: nil, language: nil,
      formattingLocale: nil, system: Locale(identifier: "en-GB")), "en-GB")
    XCTAssertEqual(WatchLocale.resolveFormatting(locale: "en", language: "en",
      formattingLocale: nil, system: Locale(identifier: "en-US")), "en-AU",
      "Old phone contexts retain the app's established English default")

    let encoded = try JSONEncoder().encode(context())
    let decoded = try JSONDecoder().decode(WatchContext.self, from: encoded)
    XCTAssertNil(decoded.locale, "Version 1 contexts without locale must still decode")
    XCTAssertNil(decoded.formattingLocale)
  }

  func testContextExpiresAndOldSnapshotsCannotCrossInvalidation() {
    let current = context()
    XCTAssertTrue(current.isValid(at: WatchClock.date("2026-09-19T11:59:59Z")!))
    XCTAssertFalse(current.isValid(at: WatchClock.date("2026-09-19T12:00:00Z")!))
    XCTAssertFalse(current.isValid(at: WatchClock.date("2026-09-17T12:00:00Z")!))
    XCTAssertFalse(context(2, sequence: 999).supersedes(current))
    XCTAssertFalse(context(3, sequence: 9, workspace: "family-b").supersedes(current))
    XCTAssertTrue(context(4, sequence: 9, workspace: "family-b").supersedes(current))
  }

  func testUnacknowledgedStopOverlaysOlderRunningSnapshot() {
    let entry = WatchEntry(id: "record-1", type: "sleep", start: "2026-09-18T12:00:00Z")
    let command = WatchCommand(schemaVersion: 1, commandId: UUID().uuidString, recordId: entry.id,
      workspaceKey: "family-a", bridgeId: "bridge-a", generation: 3, snapshotSequence: 8, createdAt: "2026-09-18T12:05:00Z",
      kind: "finish-sleep", stoppedAt: "2026-09-18T12:05:00Z", expectedEntry: entry)
    var disk = WatchDisk(context: context(entries: [entry]), outbox: [.init(command: command)])
    disk.acceptContext(context(sequence: 9, entries: [entry]))
    XCTAssertTrue(disk.visibleEntries().isEmpty)
  }

  func testOldWorkspaceCommandIsNotProjectedIntoNewWorkspace() {
    let entry = WatchEntry(id: "record-1", type: "sleep", start: "2026-09-18T12:00:00Z")
    let command = WatchCommand(schemaVersion: 1, commandId: UUID().uuidString, recordId: entry.id,
      workspaceKey: "family-a", bridgeId: "bridge-a", generation: 3, snapshotSequence: 8, createdAt: entry.start, kind: "create", entry: entry)
    var disk = WatchDisk(context: context(), outbox: [.init(command: command)])
    XCTAssertEqual(disk.visibleEntries().count, 1)
    disk.acceptContext(context(4, sequence: 9, workspace: "family-b"))
    XCTAssertTrue(disk.visibleEntries().isEmpty)
    XCTAssertEqual(disk.outbox.count, 1, "Keep original-context intent, never silently replay into the new family")
  }

  func testTransportMetadataDoesNotBecomeRecordPayload() {
    let entry = WatchEntry(id: "record", type: "feed", start: "2026-09-18T12:00:00Z", feedRunning: true,
      feedKind: "formula", version: "base-version", canControl: true, pendingOperationId: "pending")
    XCTAssertNil(entry.commandEntry.version)
    XCTAssertNil(entry.commandEntry.canControl)
    XCTAssertNil(entry.commandEntry.pendingOperationId)
  }

  func testReceiptArrivingAfterSnapshotDoesNotLeaveStaleLocalStartOverlay() {
    let entry = WatchEntry(id: "record-1", type: "sleep", start: "2026-09-18T12:00:00Z")
    let command = WatchCommand(schemaVersion: 1, commandId: UUID().uuidString, recordId: entry.id,
      workspaceKey: "family-a", bridgeId: "bridge-a", generation: 3, snapshotSequence: 8,
      createdAt: entry.start, kind: "create", entry: entry)
    var disk = WatchDisk(context: context(sequence: 10, entries: [entry]), outbox: [.init(command: command)])
    disk.outbox[0].receipt = WatchReceipt(schemaVersion: 1, commandId: command.id, recordId: entry.id,
      workspaceKey: "family-a", bridgeId: "bridge-a", generation: 3, status: "shared", error: nil, contextSequence: 10)
    disk.reconcileProjection()
    XCTAssertTrue(disk.outbox[0].projectionReconciled)
    disk.acceptContext(context(sequence: 11))
    XCTAssertTrue(disk.visibleEntries().isEmpty, "A later phone stop must not be replaced by the local start")
  }

  func testRejectedIntentIsNotPrunedWithCompletedReceiptHistory() {
    let entry = WatchEntry(id: "record-1", type: "sleep", start: "2026-09-18T12:00:00Z")
    let command = WatchCommand(schemaVersion: 1, commandId: UUID().uuidString, recordId: entry.id,
      workspaceKey: "family-a", bridgeId: "bridge-a", generation: 3, snapshotSequence: 8,
      createdAt: entry.start, kind: "create", entry: entry)
    let receipt = WatchReceipt(schemaVersion: 1, commandId: command.id, recordId: entry.id,
      workspaceKey: "family-a", bridgeId: "bridge-a", generation: 3, status: "rejected", error: "invalid_record_time", contextSequence: 8)
    var disk = WatchDisk(context: context(), outbox: Array(repeating: .init(command: command, receipt: receipt), count: 150))
    disk.acceptContext(context(sequence: 9))
    XCTAssertEqual(disk.outbox.count, 150)
  }

  func testSharedFixturesDecodeAndReencodeTheDomainNoteAndBottlePlaceholder() throws {
    let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures")
    for file in ["command-v1.json", "feed-start-v1.json"] {
      let command = try JSONDecoder().decode(WatchCommand.self, from: Data(contentsOf: fixtures.appendingPathComponent(file)))
      XCTAssertEqual(command.entry?.note, "")
      let roundTrip = try JSONDecoder().decode(WatchCommand.self, from: Data(command.json().utf8))
      XCTAssertEqual(roundTrip.entry, command.entry)
      if command.entry?.type == "feed" {
        XCTAssertEqual(command.entry?.amount, 0)
        XCTAssertEqual(command.entry?.feedRunning, true)
      }
    }
  }

  private func bottle(_ id: String = "record-1", amount: Double = 0) -> WatchEntry {
    WatchEntry(id: id, type: "feed", start: "2026-09-18T12:00:00Z", feedRunning: true,
      amount: amount, feedKind: "formula")
  }

  func testSelectedBottleAmountSurvivesPhoneEchoAndWatchRestartWithoutChangingRecord() throws {
    let feed = bottle()
    var disk = WatchDisk(context: context(entries: [feed]))
    disk.rememberMilkAmount(150, for: feed)
    disk.acceptContext(context(sequence: 9, entries: [feed]))
    let restored = try JSONDecoder().decode(WatchDisk.self, from: JSONEncoder().encode(disk))
    XCTAssertEqual(restored.initialMilkAmount(for: feed), 150)
    XCTAssertEqual(restored.visibleEntries().first?.amount, 0, "Prepared milk is not consumed milk")
    XCTAssertEqual(restored.visibleEntries().first?.commandEntry.amount, 0)
    XCTAssertEqual(restored.initialMilkAmount(for: bottle("other-feed")), 120)
  }

  func testAmountDraftSurvivesPendingStartBeforePhoneSnapshot() {
    let feed = bottle()
    let command = WatchCommand(schemaVersion: 1, commandId: UUID().uuidString, recordId: feed.id,
      workspaceKey: "family-a", bridgeId: "bridge-a", generation: 3, snapshotSequence: 8,
      createdAt: feed.start, kind: "create", entry: feed)
    var disk = WatchDisk(context: context(), outbox: [.init(command: command)])
    disk.rememberMilkAmount(150, for: feed)
    disk.acceptContext(context(sequence: 9))
    XCTAssertEqual(disk.initialMilkAmount(for: feed), 150)
    disk.outbox[0].receipt = WatchReceipt(schemaVersion: 1, commandId: command.id, recordId: feed.id,
      workspaceKey: "family-a", bridgeId: "bridge-a", generation: 3, status: "rejected", error: "running_feed", contextSequence: 9)
    disk.reconcileProjection()
    XCTAssertNil(disk.milkAmountDraft)
  }

  func testAmountDraftNeverCrossesFamilyOrGenerationAndClearsWhenFeedEnds() {
    let feed = bottle()
    var disk = WatchDisk(context: context(entries: [feed]))
    disk.rememberMilkAmount(150, for: feed)
    var switched = disk
    switched.acceptContext(context(4, sequence: 9, workspace: "family-b", entries: [feed]))
    XCTAssertNil(switched.milkAmountDraft)
    XCTAssertEqual(switched.initialMilkAmount(for: feed), 120)
    switched = disk
    switched.acceptContext(context(4, sequence: 9, entries: [feed]))
    XCTAssertNil(switched.milkAmountDraft)
    disk.acceptContext(context(sequence: 9))
    XCTAssertNil(disk.milkAmountDraft)
  }

  func testMilkAmountBoundsAndOldDiskCompatibility() throws {
    let feed = bottle()
    var disk = try JSONDecoder().decode(WatchDisk.self, from: Data("{\"outbox\":[],\"retiredBridgeIds\":[]}".utf8))
    XCTAssertNil(disk.milkAmountDraft)
    XCTAssertEqual(disk.initialMilkAmount(for: feed), 120, "Unfinished zero placeholder is not the selected amount")
    XCTAssertEqual(disk.initialMilkAmount(for: bottle(amount: 150)), 150)
    XCTAssertEqual(disk.initialMilkAmount(for: bottle(amount: .infinity)), 120)
    XCTAssertEqual(disk.initialMilkAmount(for: bottle(amount: 2_001)), 120)
    disk.acceptContext(context(entries: [feed]))
    for amount in [0, 150, 2_000] {
      disk.rememberMilkAmount(amount, for: feed)
      XCTAssertEqual(disk.initialMilkAmount(for: feed), amount)
    }
    for invalid in [-1, 2_001] {
      disk.rememberMilkAmount(invalid, for: feed)
      XCTAssertEqual(disk.initialMilkAmount(for: feed), 2_000)
    }
    let breast = WatchEntry(id: "breast", type: "feed", start: feed.start, feedRunning: true, feedKind: "breast-left")
    disk.rememberMilkAmount(90, for: breast)
    XCTAssertEqual(disk.milkAmountDraft?.recordId, feed.id)
  }
}
