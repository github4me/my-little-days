// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "LittleDaysWidgetModel",
  products: [.library(name: "LittleDaysWidgetModel", targets: ["LittleDaysWidgetModel"])],
  targets: [
    .target(name: "LittleDaysWidgetModel", path: "ios",
      exclude: ["LittleDaysWatchBridge.swift", "TodayWidgetPublisher.swift", "LittleDaysWatchBridge.podspec"],
      sources: ["TodayWidgetSnapshot.swift"]),
    .testTarget(name: "LittleDaysWidgetModelTests", dependencies: ["LittleDaysWidgetModel"], path: "Tests")
  ]
)
