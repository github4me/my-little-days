// swift-tools-version: 5.9
import PackageDescription

// Foundation-only protocol checks also run on a Mac without a paired device.
let package = Package(
  name: "LittleDaysWatchProtocol",
  platforms: [.macOS(.v13), .watchOS(.v9)],
  products: [.library(name: "LittleDaysWatchProtocol", targets: ["LittleDaysWatchProtocol"])],
  targets: [
    .target(name: "LittleDaysWatchProtocol", path: "Shared"),
    .testTarget(name: "LittleDaysWatchProtocolTests", dependencies: ["LittleDaysWatchProtocol"], path: "Tests")
  ]
)
