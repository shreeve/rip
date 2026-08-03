import AppKit
import SwiftUI
import TrayKit

@main
struct RipTrayHost: App {
  @StateObject private var provider = TrayProvider()

  init() {
    NSApplication.shared.setActivationPolicy(.accessory)
  }

  var body: some Scene {
    MenuBarExtra {
      TrayMenu(provider: provider)
    } label: {
      TrayStatusLabel(provider: provider)
    }
    .menuBarExtraStyle(.menu)
  }
}
