import CryptoKit
import ExpoModulesCore
import Foundation
import UIKit
import WatchConnectivity

private struct WatchInboxItem: Codable {
  let command: String
  let fingerprint: String
}

private struct WatchBridgeDisk: Codable {
  var bridgeId: String = UUID().uuidString.lowercased()
  var generation: Int = 0
  var sequence: Int = 0
  var workspaceKey: String = ""
  var context: String?
  var commands: [String: WatchInboxItem] = [:]
  var order: [String] = []
  var receipts: [String: String] = [:]
  var receiptFingerprints: [String: String] = [:]
  var confirmedReceipts: [String: String] = [:]
  var receiptOrder: [String] = []
}

/// WCSession delivery is independent of the React runtime. Never write into the
/// application's record database here: a transport receipt is not a saved record.
private final class WatchBridgeTransport: NSObject, WCSessionDelegate {
  static let shared = WatchBridgeTransport()
  private let queue = DispatchQueue(label: "com.littledays.watch.inbox")
  private var disk: WatchBridgeDisk?
  private let maximumMessageBytes = 32_768
  private let maximumCommands = 1_000
  private let maximumReceipts = 4_000
  var commandReceived: (() -> Void)?

  private func failure(_ code: String) -> NSError {
    NSError(domain: "LittleDaysWatchBridge", code: 1,
            userInfo: [NSLocalizedDescriptionKey: code])
  }

  private func storageURL() throws -> URL {
    var directory = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask,
      appropriateFor: nil, create: true
    ).appendingPathComponent("LittleDaysWatchBridge", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
      throw failure("storage-protection-unavailable")
    }
    return directory.appendingPathComponent("inbox-v1.json")
  }

  private func load() throws -> WatchBridgeDisk {
    if let disk { return disk }
    let url = try storageURL()
    let value = FileManager.default.fileExists(atPath: url.path)
      ? try JSONDecoder().decode(WatchBridgeDisk.self, from: Data(contentsOf: url))
      : WatchBridgeDisk()
    disk = value
    return value
  }

  private func save(_ value: WatchBridgeDisk) throws {
    let url = try storageURL()
    // The in-memory copy changes only after the atomic, protected write succeeds.
    try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    disk = value
  }

  private func parse(_ json: String) throws -> [String: Any] {
    guard let data = json.data(using: .utf8), data.count <= maximumMessageBytes,
          let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          value["schemaVersion"] as? Int == 1 else { throw failure("unsupported-envelope") }
    return value
  }

  private func stringify(_ value: [String: Any]) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func pending() throws -> [String] {
    try queue.sync {
      let value = try load()
      return value.order.compactMap { value.commands[$0]?.command }
    }
  }

  func publish(_ json: String) throws -> String {
    let result = try queue.sync { () throws -> String in
      var context = try parse(json)
      guard let workspace = context["workspaceKey"] as? String, !workspace.isEmpty,
            workspace.utf8.count <= 1_024,
            let status = context["status"] as? String,
            ["ready", "unavailable"].contains(status) else { throw failure("invalid-context") }
      var value = try load()
      if value.workspaceKey != workspace || context["invalidate"] as? Bool == true {
        value.generation += 1
      }
      value.sequence += 1
      value.workspaceKey = workspace
      context["generation"] = value.generation
      context["bridgeId"] = value.bridgeId
      context["sequence"] = value.sequence
      context["publishedAt"] = ISO8601DateFormatter().string(from: Date())
      let widgetContext = context
      context.removeValue(forKey: "widgetTotals")
      value.context = try stringify(context)
      try save(value)
      do { try TodayWidgetPublisher.publish(widgetContext) }
      catch { NSLog("LittleDays: widget snapshot update failed") }
      return value.context!
    }
    sendContext(result)
    return result
  }

  func acknowledge(_ json: String) throws {
    let receipt = try queue.sync { () throws -> String? in
      var ack = try parse(json)
      guard let id = ack["commandId"] as? String, UUID(uuidString: id) != nil,
            let workspace = ack["workspaceKey"] as? String,
            let generation = ack["generation"] as? Int,
            let status = ack["status"] as? String,
            ["saved", "pending", "shared", "rejected"].contains(status) else {
        throw failure("invalid-receipt")
      }
      var value = try load()
      let expectedBridge = ack["bridgeId"] as? String ?? value.bridgeId
      if let oldJSON = value.receipts[id] {
        let old = try parse(oldJSON)
        guard old["workspaceKey"] as? String == workspace,
              old["generation"] as? Int == generation,
              old["bridgeId"] as? String == expectedBridge else { throw failure("receipt-context-mismatch") }
        let oldStatus = old["status"] as? String
        if ["saved", "shared", "rejected"].contains(oldStatus ?? "") ||
           (oldStatus == status && old["error"] as? String == ack["error"] as? String) {
          return value.confirmedReceipts[id] == oldJSON ? nil : oldJSON
        }
      }
      // A late JS response can acknowledge only its original immutable envelope.
      if let item = value.commands[id] {
        let command = try parse(item.command)
        guard command["workspaceKey"] as? String == workspace,
              command["generation"] as? Int == generation,
              command["bridgeId"] as? String == expectedBridge else { throw failure("receipt-context-mismatch") }
        value.receiptFingerprints[id] = item.fingerprint
      }
      ack["contextSequence"] = value.sequence
      ack["bridgeId"] = expectedBridge
      let output = try stringify(ack)
      if value.receipts[id] == nil { value.receiptOrder.append(id) }
      value.receipts[id] = output
      value.commands.removeValue(forKey: id)
      value.order.removeAll { $0 == id }
      while value.receiptOrder.count > maximumReceipts {
        // Never evict the only pending or unconfirmed acknowledgement. A full
        // journal pauses further admission rather than silently losing evidence.
        guard let oldest = value.receiptOrder.first(where: { key in
          guard let json = value.receipts[key], value.confirmedReceipts[key] == json,
                let receipt = try? parse(json) else { return false }
          return ["saved", "shared", "rejected"].contains(receipt["status"] as? String ?? "")
        }) else { throw failure("receipt-journal-full") }
        value.receiptOrder.removeAll { $0 == oldest }
        value.receipts.removeValue(forKey: oldest)
        value.receiptFingerprints.removeValue(forKey: oldest)
        value.confirmedReceipts.removeValue(forKey: oldest)
      }
      try save(value)
      return output
    }
    if let receipt { sendReceipt(receipt) }
  }

  func suspend(invalidate: Bool) throws {
    var widgetCleanupError: Error?
    let context = try queue.sync { () throws -> String in
      var value = try load()
      var context = try value.context.map { try parse($0) } ?? ["schemaVersion": 1, "workspaceKey": "watch-unavailable"]
      if value.workspaceKey.isEmpty { value.workspaceKey = "watch-unavailable" }
      if invalidate { value.generation += 1 }
      value.sequence += 1
      context["workspaceKey"] = value.workspaceKey
      context["generation"] = value.generation
      context["bridgeId"] = value.bridgeId
      context["sequence"] = value.sequence
      context["status"] = "unavailable"
      context.removeValue(forKey: "profile")
      context.removeValue(forKey: "entries")
      context.removeValue(forKey: "totals")
      context.removeValue(forKey: "sleepRanges")
      context.removeValue(forKey: "widgetTotals")
      value.context = try stringify(context)
      try save(value)
      do { try TodayWidgetPublisher.clear() }
      catch { widgetCleanupError = error }
      return value.context!
    }
    sendContext(context)
    if let widgetCleanupError { throw widgetCleanupError }
  }

  private func confirmReceipt(_ json: String) throws {
    try queue.sync {
      let receipt = try parse(json)
      guard let id = receipt["commandId"] as? String else { throw failure("invalid-receipt") }
      var value = try load()
      guard value.receipts[id] == json else { return }
      if value.confirmedReceipts[id] != json {
        value.confirmedReceipts[id] = json
        try save(value)
      }
    }
  }

  private func receive(_ json: String) throws -> [String: Any] {
    let result = try queue.sync { () throws -> [String: Any] in
      let command = try parse(json)
      guard let id = command["commandId"] as? String, UUID(uuidString: id) != nil,
            let record = command["recordId"] as? String, !record.isEmpty, record.count <= 128,
            let workspace = command["workspaceKey"] as? String,
            let bridgeId = command["bridgeId"] as? String, UUID(uuidString: bridgeId) != nil,
            let generation = command["generation"] as? Int,
            let kind = command["kind"] as? String,
            ["create", "finish-sleep", "finish-feed"].contains(kind) else {
        throw failure("invalid-command")
      }
      var value = try load()
      let fingerprint = SHA256.hash(data: Data(json.utf8)).map { String(format: "%02x", $0) }.joined()
      if let item = value.commands[id] {
        guard item.fingerprint == fingerprint else { throw failure("command-id-reused") }
      } else if let receipt = value.receipts[id] {
        let ack = try parse(receipt)
        guard value.receiptFingerprints[id] == fingerprint else { throw failure("command-id-reused") }
        guard ack["workspaceKey"] as? String == workspace,
              ack["generation"] as? Int == generation,
              ack["bridgeId"] as? String == bridgeId else { throw failure("command-context-changed") }
        return ["receipt": receipt]
      } else {
        guard workspace == value.workspaceKey, generation == value.generation, bridgeId == value.bridgeId else {
          throw failure("context-changed")
        }
        guard let contextJSON = value.context,
              try parse(contextJSON)["status"] as? String == "ready" else { throw failure("context-unavailable") }
        guard value.commands.count < maximumCommands else { throw failure("phone-inbox-full") }
        value.commands[id] = WatchInboxItem(command: json, fingerprint: fingerprint)
        value.order.append(id)
        try save(value)
      }
      return ["received": id, "workspaceKey": workspace, "generation": generation, "bridgeId": bridgeId]
    }
    DispatchQueue.main.async { [weak self] in self?.commandReceived?() }
    return result
  }

  private func sendContext(_ json: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
    try? session.updateApplicationContext(["context": json])
  }

  private func sendReceipt(_ json: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
    // This durable transfer is not replaced by a later snapshot or receipt.
    if !session.outstandingUserInfoTransfers.contains(where: { $0.userInfo["receipt"] as? String == json }) {
      session.transferUserInfo(["receipt": json])
    }
    if session.isReachable { session.sendMessage(["receipt": json], replyHandler: nil, errorHandler: nil) }
  }

  private func restoreContext() {
    let context = try? queue.sync { try load().context }
    if let context { sendContext(context) }
    let receipts = (try? queue.sync { () throws -> [String] in
      let value = try load()
      return value.receiptOrder.compactMap { key in
        guard let json = value.receipts[key], value.confirmedReceipts[key] != json else { return nil }
        return json
      }
    }) ?? []
    for receipt in receipts { sendReceipt(receipt) }
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if activationState == .activated { restoreContext() }
  }
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }
  func sessionWatchStateDidChange(_ session: WCSession) { restoreContext() }
  func sessionReachabilityDidChange(_ session: WCSession) { if session.isReachable { restoreContext() } }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    if message["requestContext"] as? Bool == true {
      let context = try? queue.sync { try load().context }
      replyHandler(context.map { ["context": $0] } ?? [:])
      return
    }
    if let json = message["receiptReceived"] as? String {
      do { try confirmReceipt(json); replyHandler(["confirmed": true]) }
      catch { replyHandler(["error": "receipt-confirmation-failed"]) }
      return
    }
    guard let json = message["command"] as? String else { replyHandler(["error": "invalid-command"]); return }
    do { replyHandler(try receive(json)) }
    catch { replyHandler(["error": (error as NSError).localizedDescription]) }
  }
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    if let json = userInfo["receiptReceived"] as? String { try? confirmReceipt(json); return }
    guard let json = userInfo["command"] as? String else { return }
    do {
      let result = try receive(json)
      if let receipt = result["receipt"] as? String { sendReceipt(receipt) }
    } catch {
      // The Watch retains the command and can retry/request a current context.
      // Do not log payloads or turn a transport/storage failure into a record ack.
    }
  }
}

public final class LittleDaysWatchBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LittleDaysWatchBridge")
    Events("commandReceived")
    OnCreate { [weak self] in
      WatchBridgeTransport.shared.commandReceived = { [weak self] in self?.sendEvent("commandReceived", [:]) }
      WatchBridgeTransport.shared.activate()
    }
    OnDestroy { WatchBridgeTransport.shared.commandReceived = nil }
    AsyncFunction("getPendingCommands") { try WatchBridgeTransport.shared.pending() }
    AsyncFunction("acknowledgeCommand") { (json: String) in try WatchBridgeTransport.shared.acknowledge(json) }
    AsyncFunction("publishContext") { (json: String) -> String in try WatchBridgeTransport.shared.publish(json) }
    AsyncFunction("suspendContext") { try WatchBridgeTransport.shared.suspend(invalidate: false) }
    AsyncFunction("invalidateContext") { try WatchBridgeTransport.shared.suspend(invalidate: true) }
  }
}

public final class LittleDaysWatchBridgeSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    WatchBridgeTransport.shared.activate()
    return true
  }
}
