import Foundation

enum WatchClock {
  static func string(_ date: Date = Date()) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }
  static func date(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
}

struct WatchEntry: Codable, Equatable, Identifiable {
  let id: String
  let type: String
  let start: String
  var end: String?
  var feedRunning: Bool?
  var amount: Double?
  var feedKind: String?
  var diaperKind: String?
  var version: String?
  var canControl: Bool?
  var pendingOperationId: String?
  var note: String = ""

  var isActive: Bool { (type == "sleep" && end == nil) || (type == "feed" && feedRunning == true) }
  var startedAt: Date { WatchClock.date(start) ?? .distantPast }
  var isBottle: Bool { feedKind == "formula" || feedKind == "expressed" }
  var commandEntry: WatchEntry {
    var value = self
    value.version = nil
    value.canControl = nil
    value.pendingOperationId = nil
    return value
  }
}

struct WatchContext: Codable {
  struct Profile: Codable { let name: String; let birthDate: String }
  struct Totals: Codable { let feedMl: Double; let feedCount: Int; let diaperCount: Int; let sleepMinutes: Double }
  let schemaVersion: Int
  let workspaceKey: String
  let bridgeId: String
  let generation: Int
  let sequence: Int
  let status: String
  let mode: String?
  let expiresAt: String?
  let publishedAt: String?
  let profile: Profile?
  let entries: [WatchEntry]?
  let language: String?
  let totals: Totals?
  var totalsDate: String?

  func isValid(at now: Date) -> Bool {
    guard schemaVersion == 1, status == "ready", !workspaceKey.isEmpty,
          let expiresAt, let expiry = WatchClock.date(expiresAt),
          let publishedAt, let published = WatchClock.date(publishedAt) else { return false }
    return now >= published.addingTimeInterval(-60) && now < min(expiry, published.addingTimeInterval(24 * 60 * 60))
  }
  func supersedes(_ old: WatchContext?) -> Bool {
    guard let old else { return true }
    if bridgeId != old.bridgeId { return true }
    return generation > old.generation || (generation == old.generation && sequence > old.sequence && workspaceKey == old.workspaceKey)
  }
}

struct WatchCommand: Codable, Identifiable {
  let schemaVersion: Int
  let commandId: String
  let recordId: String
  let workspaceKey: String
  let bridgeId: String
  let generation: Int
  let snapshotSequence: Int
  let createdAt: String
  let kind: String
  var entry: WatchEntry?
  var stoppedAt: String?
  var amount: Double?
  var baseVersion: String?
  var expectedEntry: WatchEntry?
  var dependsOn: String?
  var id: String { commandId }

  func json() throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return String(decoding: try encoder.encode(self), as: UTF8.self)
  }
}

struct WatchReceipt: Codable {
  let schemaVersion: Int
  let commandId: String
  let recordId: String?
  let workspaceKey: String
  var bridgeId: String?
  let generation: Int
  let status: String
  let error: String?
  let contextSequence: Int?
}

struct WatchOutboxItem: Codable, Identifiable {
  let command: WatchCommand
  var receivedByPhone = false
  var receipt: WatchReceipt?
  var projectionReconciled = false
  var id: String { command.commandId }
  var terminal: Bool { ["saved", "shared", "rejected"].contains(receipt?.status ?? "") }
}

struct WatchDisk: Codable {
  var context: WatchContext?
  var outbox: [WatchOutboxItem] = []
  var retiredBridgeIds: [String] = []

  func visibleEntries() -> [WatchEntry] {
    guard let context else { return [] }
    var values = context.entries ?? []
    for item in outbox where item.command.bridgeId == context.bridgeId && item.command.workspaceKey == context.workspaceKey && item.command.generation == context.generation {
      guard item.receipt?.status != "rejected", !item.projectionReconciled else { continue }
      let command = item.command
      if command.kind == "create", let entry = command.entry {
        values.removeAll { $0.id == entry.id }
        if entry.isActive { values.append(entry) }
      } else if command.kind == "finish-sleep" || command.kind == "finish-feed" {
        values.removeAll { $0.id == command.recordId }
      }
    }
    return values.filter(\.isActive)
  }

  mutating func acceptContext(_ value: WatchContext) {
    guard value.schemaVersion == 1, !retiredBridgeIds.contains(value.bridgeId), value.supersedes(context) else { return }
    if let old = context, old.bridgeId != value.bridgeId { retiredBridgeIds.append(old.bridgeId) }
    context = value
    reconcileProjection()
  }

  mutating func reconcileProjection() {
    guard let value = context, value.status == "ready" else { return }
    for index in outbox.indices {
      let item = outbox[index]
      guard !item.projectionReconciled,
            item.command.workspaceKey == value.workspaceKey,
            item.command.bridgeId == value.bridgeId,
            item.command.generation == value.generation,
            let receipt = item.receipt, receipt.status != "rejected",
            value.sequence >= (receipt.contextSequence ?? Int.max) else { continue }
      let present = value.entries?.contains { $0.id == item.command.recordId && $0.isActive } ?? false
      if item.command.kind == "create" {
        // Only replace an active local start once the phone snapshot contains it.
        outbox[index].projectionReconciled = item.command.entry?.isActive != true || present ||
          (item.terminal && value.sequence > (receipt.contextSequence ?? Int.max))
      } else {
        outbox[index].projectionReconciled = !present
      }
    }
    // Retain bounded terminal receipt history, not unsynced work. Quarantined old
    // generations are never replayed or rendered under the new workspace.
    let finished = outbox.filter { ["saved", "shared"].contains($0.receipt?.status ?? "") && $0.projectionReconciled }
    let removable = Set(finished.dropLast(100).map(\.id))
    outbox.removeAll { removable.contains($0.id) }
  }
}
