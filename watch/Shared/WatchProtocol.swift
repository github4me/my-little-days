import Foundation

enum WatchLocale {
  static let supported = [
    "en", "zh-Hans", "zh-Hant", "fr", "de", "hi",
    "it", "ja", "ko", "es", "th", "vi",
  ]
  static let defaultFormattingIdentifiers = [
    "en": "en-AU", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW",
    "fr": "fr-FR", "de": "de-DE", "hi": "hi-IN", "it": "it-IT",
    "ja": "ja-JP", "ko": "ko-KR", "es": "es-ES", "th": "th-TH",
    "vi": "vi-VN",
  ]

  static func canonical(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized = value.replacingOccurrences(of: "_", with: "-").lowercased()
    if normalized.hasPrefix("zh-") || normalized == "zh" {
      return normalized.contains("hant") || normalized.contains("-tw") ||
        normalized.contains("-hk") || normalized.contains("-mo") ? "zh-Hant" : "zh-Hans"
    }
    let language = normalized.split(separator: "-").first.map(String.init) ?? normalized
    return supported.first { $0.lowercased() == language }
  }

  static func resolve(locale: String?, language: String?, system: Locale = .current) -> String {
    if let selected = canonical(locale) { return selected }
    if language == "zh" { return "zh-Hans" }
    if language == "en" { return "en" }
    return canonical(system.identifier) ?? "en"
  }

  static func canonicalFormatting(_ value: String?, for catalog: String) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "_", with: "-")
    guard !normalized.isEmpty, normalized.count <= 64,
          canonical(normalized) == catalog else { return nil }
    return normalized
  }

  static func resolveFormatting(locale: String?, language: String?, formattingLocale: String?,
    system: Locale = .current) -> String {
    let catalog = resolve(locale: locale, language: language, system: system)
    if let selected = canonicalFormatting(formattingLocale, for: catalog) { return selected }
    let hasPhoneSelection = canonical(locale) != nil || language == "zh" || language == "en"
    if !hasPhoneSelection,
       canonical(system.identifier) == catalog,
       let selected = canonicalFormatting(system.identifier, for: catalog) { return selected }
    return defaultFormattingIdentifiers[catalog] ?? "en-AU"
  }
}

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
  // Completed sleep intervals, merged and bounded by the phone, in Unix seconds.
  // Older phones omit them; in that case sleep totals wait for confirmation.
  var sleepRanges: [[Double]]?
  // Canonical app-selected locale. Older phones only send language (en|zh),
  // so this remains optional without changing the version 1 wire contract.
  var locale: String? = nil
  // Regional formatting locale. Optional so previously persisted version 1
  // contexts continue to decode and use the catalog's stable default region.
  var formattingLocale: String? = nil
  // Keep an authenticated read/conflict context usable if the phone pauses new
  // Watch recording. Older phone contexts omit this and remain enabled.
  var recordingEnabled: Bool? = nil

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
  // A conflict resolution is a new immutable command that refers to the
  // rejected command the person reviewed; it never mutates that old command.
  var resolution: String?
  var conflictOperationId: String?
  var id: String { commandId }

  func json() throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return String(decoding: try encoder.encode(self), as: UTF8.self)
  }
}

struct WatchConflict: Codable {
  let currentVersion: String
  let currentEditedBy: String
  let currentEntry: WatchEntry
  let proposedEntry: WatchEntry
  let canReplace: Bool
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
  var conflict: WatchConflict?
}

struct WatchOutboxItem: Codable, Identifiable {
  let command: WatchCommand
  var receivedByPhone = false
  var receipt: WatchReceipt?
  var projectionReconciled = false
  var id: String { command.commandId }
  var terminal: Bool { ["saved", "shared", "rejected"].contains(receipt?.status ?? "") }
}

// Watch-local input seed, never part of a record or command sent to the phone.
struct WatchMilkAmountDraft: Codable {
  let recordId: String
  let workspaceKey: String
  let bridgeId: String
  let generation: Int
  let amount: Int

  func matches(_ entry: WatchEntry, context: WatchContext?) -> Bool {
    recordId == entry.id && workspaceKey == context?.workspaceKey &&
      bridgeId == context?.bridgeId && generation == context?.generation
  }
}

struct WatchDisk: Codable {
  var context: WatchContext?
  var outbox: [WatchOutboxItem] = []
  var retiredBridgeIds: [String] = []
  var milkAmountDraft: WatchMilkAmountDraft?
  var summaryBase: WatchContext?
  var summaryCommandIds: [String]?

  mutating func append(_ command: WatchCommand) {
    // Pin the last known phone totals BEFORE adding the first local operation.
    // Keep this baseline until the entire batch is reflected by phone receipts
    // AND a corresponding snapshot, regardless of transport arrival order.
    if summaryBase == nil {
      summaryBase = context
      summaryCommandIds = []
    }
    summaryCommandIds?.append(command.id)
    outbox.append(WatchOutboxItem(command: command))
  }

  func summary(at now: Date, calendar: Calendar = .current) -> WatchSummary? {
    guard let context, context.isValid(at: now) else { return nil }
    let base = summaryBase ?? context
    let start = calendar.startOfDay(for: now)
    guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return nil }
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = calendar.timeZone
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    let isToday = base.totalsDate == formatter.string(from: now)
    var milk = isToday ? base.totals?.feedMl ?? 0 : 0
    var feeds = isToday ? base.totals?.feedCount ?? 0 : 0
    var nappies = isToday ? base.totals?.diaperCount ?? 0 : 0
    let ids = Set(summaryCommandIds ?? [])
    let batch = outbox.filter { ids.contains($0.id) && $0.command.workspaceKey == context.workspaceKey &&
      $0.command.bridgeId == context.bridgeId && $0.command.generation == context.generation }
    let rejected = Set(outbox.filter { $0.receipt?.status == "rejected" }.map(\.id))
    var records: [String: WatchEntry] = [:]
    var sleepRanges = isToday ? base.sleepRanges ?? [] : []
    var hasLocal = false
    for item in batch {
      let command = item.command
      guard !rejected.contains(item.id), !rejected.contains(command.dependsOn ?? "") else { continue }
      if command.kind == "create", let entry = command.entry {
        records[entry.id] = entry
        hasLocal = true
      } else if let expected = command.expectedEntry,
                let stopped = command.stoppedAt.flatMap(WatchClock.date) {
        var entry = records[command.recordId] ?? expected
        if command.kind == "finish-feed" {
          // A phone-started feed is already counted; only its amount changes.
          if isToday && records[entry.id] == nil && base.entries?.contains(where: { $0.id == entry.id }) == true &&
              entry.startedAt >= start && entry.startedAt < end {
            feeds -= 1
            milk -= entry.amount ?? 0
          }
          entry.feedRunning = false
          entry.amount = entry.isBottle ? command.amount ?? 0 : nil
          entry.end = command.stoppedAt
          records[entry.id] = entry
        } else if command.kind == "finish-sleep" {
          records.removeValue(forKey: entry.id)
          if stopped.timeIntervalSince(entry.startedAt) >= 60 {
            entry.end = command.stoppedAt
            records[entry.id] = entry
          }
        }
        hasLocal = true
      }
    }
    for entry in records.values {
      if entry.startedAt >= start && entry.startedAt < end {
        if entry.type == "feed" { feeds += 1; milk += entry.amount ?? 0 }
        if entry.type == "diaper" { nappies += 1 }
      }
      if entry.type == "sleep", let finished = entry.end.flatMap(WatchClock.date) {
        sleepRanges.append([max(start, entry.startedAt).timeIntervalSince1970,
          min(end, finished).timeIntervalSince1970])
      }
    }
    // Merge with the phone's completed intervals, not just add minutes: a
    // backfilled sleep can overlap a Watch timer. Missing/oversized old metadata
    // must not manufacture precision; retain the phone sleep total until synced.
    let sleep = !isToday || base.sleepRanges != nil
      ? WatchSummary.sleepMinutes(sleepRanges)
      : base.totals?.sleepMinutes ?? 0
    return WatchSummary(totals: .init(feedMl: max(0, milk), feedCount: max(0, feeds),
      diaperCount: max(0, nappies), sleepMinutes: sleep), phoneUpdatedAt: base.publishedAt,
      needsPhoneUpdate: !isToday, includesLocalChanges: hasLocal)
  }

  func initialMilkAmount(for entry: WatchEntry) -> Int {
    if let draft = milkAmountDraft, draft.matches(entry, context: context), (0...2_000).contains(draft.amount) {
      return draft.amount
    }
    // Older/phone-started timers have no Watch draft. Zero is their unfinished
    // record placeholder, not a previously selected consumed amount.
    if let amount = entry.amount, amount.isFinite, amount > 0, amount <= 2_000 {
      return Int(amount.rounded())
    }
    return 120
  }

  mutating func rememberMilkAmount(_ amount: Int, for entry: WatchEntry) {
    guard entry.isBottle, entry.feedRunning == true, (0...2_000).contains(amount), let context else { return }
    milkAmountDraft = WatchMilkAmountDraft(recordId: entry.id, workspaceKey: context.workspaceKey,
      bridgeId: context.bridgeId, generation: context.generation, amount: amount)
  }

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
    if let base = summaryBase, value.bridgeId != base.bridgeId ||
        value.workspaceKey != base.workspaceKey || value.generation != base.generation {
      summaryBase = nil
      summaryCommandIds = nil
    }
    context = value
    reconcileProjection()
  }

  mutating func reconcileProjection() {
    if let draft = milkAmountDraft,
       !visibleEntries().contains(where: { $0.isBottle && draft.matches($0, context: context) }) {
      milkAmountDraft = nil
    }
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
      if item.command.kind == "resolve-conflict" {
        outbox[index].projectionReconciled = item.terminal
      } else if item.command.kind == "create" {
        // Only replace an active local start once the phone snapshot contains it.
        outbox[index].projectionReconciled = item.command.entry?.isActive != true || present ||
          (item.terminal && value.sequence > (receipt.contextSequence ?? Int.max))
      } else {
        outbox[index].projectionReconciled = !present
      }
    }
    // A terminal resolution supersedes the rejected command it reviewed. If
    // replacement raced with another edit, the resolution command itself is
    // rejected with a fresh conflict and remains available for another review.
    let resolved = Set(outbox.compactMap { item in
      item.command.kind == "resolve-conflict" && item.terminal
        ? item.command.conflictOperationId : nil
    })
    outbox.removeAll { resolved.contains($0.id) }
    // Retain bounded terminal receipt history, not unsynced work. Quarantined old
    // generations are never replayed or rendered under the new workspace.
    if let ids = summaryCommandIds, ids.allSatisfy({ id in
      outbox.contains { $0.id == id && ($0.projectionReconciled || $0.receipt?.status == "rejected") }
    }) {
      summaryBase = nil
      summaryCommandIds = nil
    }
    let pinned = Set(summaryCommandIds ?? [])
    let finished = outbox.filter { !pinned.contains($0.id) && ["saved", "shared"].contains($0.receipt?.status ?? "") && $0.projectionReconciled }
    let removable = Set(finished.dropLast(100).map(\.id))
    outbox.removeAll { removable.contains($0.id) }
  }
}

struct WatchSummary {
  let totals: WatchContext.Totals
  let phoneUpdatedAt: String?
  let needsPhoneUpdate: Bool
  let includesLocalChanges: Bool

  static func sleepMinutes(_ ranges: [[Double]]) -> Double {
    let sorted = ranges.filter { $0.count == 2 && $0[0].isFinite && $0[1].isFinite && $0[1] > $0[0] }
      .sorted { $0[0] < $1[0] }
    var stop = -Double.infinity
    var seconds = 0.0
    for range in sorted {
      seconds += max(0, range[1] - max(stop, range[0]))
      stop = max(stop, range[1])
    }
    return seconds / 60
  }
}
