// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "RipTray",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "TrayKit", targets: ["TrayKit"]),
    .executable(name: "rip-tray-host", targets: ["RipTrayHost"]),
    .executable(name: "tray-kit-check", targets: ["TrayKitCheck"]),
  ],
  targets: [
    .target(name: "TrayKit"),
    .executableTarget(name: "RipTrayHost", dependencies: ["TrayKit"]),
    .executableTarget(name: "TrayKitCheck", dependencies: ["TrayKit"]),
  ],
  swiftLanguageModes: [.v5]
)
