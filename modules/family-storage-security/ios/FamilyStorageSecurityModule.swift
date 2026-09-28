import ExpoModulesCore
import Foundation
import UIKit

enum FamilyStorageProtection {
  static func prepare() throws {
    // Expo SQLite uses Documents/SQLite. Excluding its directory covers the
    // existing databases plus subsequently created WAL/SHM/journal sidecars.
    // Do not move a live database or put unsynced work in purgeable Caches.
    let documents = try FileManager.default.url(
      for: .documentDirectory, in: .userDomainMask,
      appropriateFor: nil, create: true
    )
    var directory = documents.appendingPathComponent("SQLite", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
      throw NSError(domain: "FamilyStorageSecurity", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Database backup protection is unavailable."])
    }
  }
}

public final class FamilyStorageSecurityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FamilyStorageSecurity")
    AsyncFunction("protect") {
      try FamilyStorageProtection.prepare()
    }
  }
}

public final class FamilyStorageSecuritySubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Protect old databases even when signed out. Family database opens also
    // recheck strictly, so an attribute failure never permits unprotected writes.
    try? FamilyStorageProtection.prepare()
    return true
  }
}
