import Combine
import Foundation
import WatchConnectivity
import WatchKit

@MainActor
final class WatchStore: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var disk = WatchDisk()
  @Published var notice: String?
  @Published private(set) var storageAvailable = false
  @Published private(set) var reachable = false
  private let maximumCommands = 1_000
  private var inFlight = Set<String>()

  var chinese: Bool { disk.context?.language == "zh" || (disk.context?.language == nil && Locale.current.language.languageCode?.identifier == "zh") }
  func text(_ en: String, _ zh: String) -> String { chinese ? zh : en }
  var ready: Bool { storageAvailable && disk.context?.isValid(at: Date()) == true }
  var entries: [WatchEntry] { disk.visibleEntries() }
  var activeFeed: WatchEntry? { entries.first { $0.type == "feed" } }
  var activeSleep: WatchEntry? { entries.first { $0.type == "sleep" } }
  var pendingCount: Int {
    disk.outbox.filter { !$0.terminal && $0.command.bridgeId == disk.context?.bridgeId && $0.command.workspaceKey == disk.context?.workspaceKey && $0.command.generation == disk.context?.generation }.count
  }
  var rejectedCount: Int {
    disk.outbox.filter { $0.receipt?.status == "rejected" && $0.command.bridgeId == disk.context?.bridgeId && $0.command.workspaceKey == disk.context?.workspaceKey && $0.command.generation == disk.context?.generation }.count
  }
  var rejectedItems: [WatchOutboxItem] {
    disk.outbox.filter { $0.receipt?.status == "rejected" && $0.command.bridgeId == disk.context?.bridgeId && $0.command.workspaceKey == disk.context?.workspaceKey && $0.command.generation == disk.context?.generation }
  }
  func rejectionMessage(_ code: String?) -> String {
    switch code {
    case "invalid_record_time", "before_birth_date", "invalid_watch_command":
      return text("Not added. Check your clock and record values, then record again.", "未添加。请检查时间及记录内容后重新记录。")
    case "membership_changed", "context-changed":
      return text("Not applied to the previous workspace. Open the iPhone app to reconnect.", "未应用到之前的资料。请打开 iPhone 应用重新连接。")
    case "running_sleep", "running_feed":
      return text("Another timer already exists. Refresh the iPhone app before trying again.", "已有其他计时。请刷新 iPhone 应用后重试。")
    default:
      return text("This record was not shared. Review the pending change on iPhone.", "此记录未共享。请在 iPhone 上查看待处理修改。")
    }
  }

  override init() {
    super.init()
    do {
      let url = try storageURL()
      if FileManager.default.fileExists(atPath: url.path) {
        disk = try JSONDecoder().decode(WatchDisk.self, from: Data(contentsOf: url))
      }
      storageAvailable = true
    } catch {
      notice = text("Storage unavailable. Open Little Days on iPhone.", "储存暂不可用。请打开 iPhone 上的小日子。")
    }
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  private func storageURL() throws -> URL {
    var directory = try FileManager.default.url(for: .applicationSupportDirectory,
      in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("LittleDaysWatch", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
      throw CocoaError(.fileWriteNoPermission)
    }
    return directory.appendingPathComponent("outbox-v1.json")
  }

  private func persist(_ value: WatchDisk) throws {
    try JSONEncoder().encode(value).write(to: storageURL(),
      options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    disk = value
    storageAvailable = true
  }

  private func enqueue(_ kind: String, entry: WatchEntry, stoppedAt: Date? = nil, amount: Double? = nil, initialMilkAmount: Int? = nil) -> Bool {
    guard ready, let context = disk.context else {
      notice = text("Open Little Days on iPhone to verify access.", "请打开 iPhone 上的小日子以验证访问权限。")
      return false
    }
    guard disk.outbox.count < maximumCommands else {
      notice = text("Watch storage is full. Open the iPhone app to sync first.", "手表待同步记录已满。请先打开 iPhone 应用同步。")
      return false
    }
    if kind != "create" && entry.canControl == false {
      notice = text("This timer needs the iPhone app before you can change it here.", "此计时需要先在 iPhone 上确认，才能在手表更改。")
      return false
    }
    let dependency = disk.outbox.last { $0.command.recordId == entry.id && $0.command.kind == "create" && !$0.terminal && $0.receipt?.status != "rejected" }?.id ?? entry.pendingOperationId
    let command = WatchCommand(schemaVersion: 1, commandId: UUID().uuidString.lowercased(),
      recordId: entry.id, workspaceKey: context.workspaceKey, bridgeId: context.bridgeId, generation: context.generation,
      snapshotSequence: context.sequence, createdAt: WatchClock.string(), kind: kind,
      entry: kind == "create" ? entry.commandEntry : nil,
      stoppedAt: stoppedAt.map { WatchClock.string($0) }, amount: amount,
      baseVersion: dependency == nil ? entry.version : nil, expectedEntry: kind == "create" ? nil : entry.commandEntry,
      dependsOn: kind == "create" ? nil : dependency)
    var value = disk
    value.append(command)
    if kind == "create", let initialMilkAmount {
      value.rememberMilkAmount(initialMilkAmount, for: entry)
    }
    if kind == "finish-feed", value.milkAmountDraft?.matches(entry, context: context) == true {
      value.milkAmountDraft = nil
    }
    do {
      try persist(value)
      WKInterfaceDevice.current().play(.success)
      notice = text("Saved on Watch", "已保存在手表")
      flush()
      return true
    } catch {
      // Do not project a timer or confirm save if durable persistence failed.
      notice = text("Couldn't save. Your record was not added. Try again.", "保存失败，记录尚未添加。请重试。")
      WKInterfaceDevice.current().play(.failure)
      return false
    }
  }

  @discardableResult func recordNappy(_ kind: String) -> Bool {
    guard ["wet", "dirty", "mixed"].contains(kind) else { return false }
    return enqueue("create", entry: WatchEntry(id: UUID().uuidString.lowercased(), type: "diaper", start: WatchClock.string(), diaperKind: kind))
  }
  @discardableResult func recordFeed(kind: String, amount: Double?, running: Bool) -> Bool {
    guard ["formula", "expressed", "breast-left", "breast-right", "breast-both"].contains(kind),
          !running || activeFeed == nil else { return false }
    let bottle = ["formula", "expressed"].contains(kind)
    guard !bottle || (amount != nil && amount! >= 0 && amount! <= 2_000 && amount!.isFinite) else { return false }
    return enqueue("create", entry: WatchEntry(id: UUID().uuidString.lowercased(), type: "feed", start: WatchClock.string(),
      feedRunning: running ? true : nil, amount: bottle ? (running ? 0 : amount) : nil, feedKind: kind),
      initialMilkAmount: bottle && running ? amount.map { Int($0.rounded()) } : nil)
  }
  @discardableResult func finishFeed(_ entry: WatchEntry, stoppedAt: Date, amount: Double?) -> Bool {
    guard stoppedAt >= entry.startedAt,
          !entry.isBottle || (amount != nil && amount! >= 0 && amount! <= 2_000 && amount!.isFinite) else { return false }
    return enqueue("finish-feed", entry: entry, stoppedAt: stoppedAt, amount: entry.isBottle ? amount : nil)
  }
  @discardableResult func toggleSleep() -> Bool {
    if let entry = activeSleep {
      let now = Date()
      guard now >= entry.startedAt else {
        notice = text("Check your Watch clock, then try again.", "请检查手表时间后重试。")
        return false
      }
      let result = enqueue("finish-sleep", entry: entry, stoppedAt: now)
      if result && now.timeIntervalSince(entry.startedAt) < 60 {
        notice = text("Under one minute: sleep cancelled; no completed sleep will be kept.", "不足一分钟：已取消睡眠，不保留已完成的睡眠记录。")
      }
      return result
    }
    return enqueue("create", entry: WatchEntry(id: UUID().uuidString.lowercased(), type: "sleep", start: WatchClock.string()))
  }

  func reconnect() {
    let session = WCSession.default
    reachable = session.isReachable
    if session.activationState == .activated {
      if let json = session.receivedApplicationContext["context"] as? String { accept(["context": json]) }
      if session.isReachable {
        session.sendMessage(["requestContext": true], replyHandler: { [weak self] message in
          Task { @MainActor in self?.accept(message) }
        }, errorHandler: { _ in })
      }
      flush()
    }
  }

  private func flush() {
    let session = WCSession.default
    guard storageAvailable, session.activationState == .activated, let context = disk.context else { return }
    let outstanding = Set(session.outstandingUserInfoTransfers.compactMap { transfer -> String? in
      guard let json = transfer.userInfo["command"] as? String,
            let data = json.data(using: .utf8),
            let command = try? JSONDecoder().decode(WatchCommand.self, from: data) else { return nil }
      return command.commandId
    })
    for item in disk.outbox where !item.terminal && item.command.bridgeId == context.bridgeId && item.command.workspaceKey == context.workspaceKey && item.command.generation == context.generation {
      // Application-persisted family work belongs to the phone queue after this ack.
      guard item.receipt?.status != "pending", let json = try? item.command.json() else { continue }
      if !outstanding.contains(item.id) { session.transferUserInfo(["command": json]) }
      guard session.isReachable, !inFlight.contains(item.id) else { continue }
      let id = item.id
      inFlight.insert(id)
      session.sendMessage(["command": json], replyHandler: { [weak self] message in
        Task { @MainActor in
          self?.inFlight.remove(id)
          self?.accept(message)
        }
      }, errorHandler: { [weak self] _ in
        Task { @MainActor in self?.inFlight.remove(id) }
      })
    }
  }

  private func accept(_ message: [String: Any]) {
    guard storageAvailable else { return }
    var value = disk
    if let json = message["context"] as? String, json.utf8.count <= 32_768,
       let data = json.data(using: .utf8), let context = try? JSONDecoder().decode(WatchContext.self, from: data) {
      value.acceptContext(context)
    }
    if let json = message["receipt"] as? String, json.utf8.count <= 32_768,
       let data = json.data(using: .utf8), let receipt = try? JSONDecoder().decode(WatchReceipt.self, from: data),
       receipt.schemaVersion == 1, let index = value.outbox.firstIndex(where: { $0.id == receipt.commandId }),
       value.outbox[index].command.workspaceKey == receipt.workspaceKey,
       value.outbox[index].command.bridgeId == receipt.bridgeId,
       value.outbox[index].command.generation == receipt.generation {
      let old = value.outbox[index].receipt?.status
      if old != "shared" && old != "saved" && old != "rejected" {
        value.outbox[index].receipt = receipt
        if receipt.status == "rejected" {
          notice = rejectionMessage(receipt.error)
        }
      }
    }
    if let id = message["received"] as? String,
       let index = value.outbox.firstIndex(where: { $0.id == id }),
       value.outbox[index].command.workspaceKey == message["workspaceKey"] as? String,
       value.outbox[index].command.bridgeId == message["bridgeId"] as? String,
       value.outbox[index].command.generation == message["generation"] as? Int {
      value.outbox[index].receivedByPhone = true
    }
    // Receipt and applicationContext may arrive in either order.
    value.reconcileProjection()
    do {
      try persist(value)
      if let json = message["receipt"] as? String,
         let data = json.data(using: .utf8), let receipt = try? JSONDecoder().decode(WatchReceipt.self, from: data),
         value.outbox.contains(where: { $0.id == receipt.commandId && $0.command.bridgeId == receipt.bridgeId && $0.command.workspaceKey == receipt.workspaceKey && $0.command.generation == receipt.generation }) {
        // Only confirm an acknowledgement after the Watch has saved it. A phone
        // crash after storing/sending its receipt then safely resends on reconnect.
        let session = WCSession.default
        if !session.outstandingUserInfoTransfers.contains(where: { $0.userInfo["receiptReceived"] as? String == json }) {
          session.transferUserInfo(["receiptReceived": json])
        }
        if session.isReachable { session.sendMessage(["receiptReceived": json], replyHandler: { _ in }, errorHandler: nil) }
      }
    }
    catch { notice = text("Couldn't save sync status. Your pending records are retained.", "同步状态保存失败。待同步记录仍保留。") }
  }

  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    Task { @MainActor [weak self] in self?.reconnect() }
  }
  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    Task { @MainActor [weak self] in self?.reconnect() }
  }
  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    Task { @MainActor [weak self] in self?.accept(applicationContext); self?.flush() }
  }
  nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    Task { @MainActor [weak self] in self?.accept(message) }
  }
  nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    Task { @MainActor [weak self] in self?.accept(userInfo) }
  }
}
