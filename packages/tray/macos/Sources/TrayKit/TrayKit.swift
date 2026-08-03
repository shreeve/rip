import AppKit
import Combine
import Foundation
import SwiftUI

public enum TrayIcon: Codable, Equatable, Sendable {
  case symbol(String)
  case svg(source: String, template: Bool)

  private struct SVG: Codable {
    let kind: String
    let source: String
    let template: Bool
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let name = try? container.decode(String.self) {
      guard !name.isEmpty else { throw TrayHostError("SF Symbol name must not be empty") }
      self = .symbol(name)
      return
    }
    let svg = try container.decode(SVG.self)
    guard svg.kind == "svg" else { throw TrayHostError("unknown tray icon kind \(svg.kind)") }
    guard !svg.source.isEmpty else { throw TrayHostError("SVG icon source must not be empty") }
    self = .svg(source: svg.source, template: svg.template)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .symbol(let name):
      try container.encode(name)
    case .svg(let source, let template):
      try container.encode(SVG(kind: "svg", source: source, template: template))
    }
  }

  public var usesTemplateRendering: Bool {
    switch self {
    case .symbol: true
    case .svg(_, let template): template
    }
  }

  public func nativeImage(accessibilityDescription: String? = nil) throws -> NSImage {
    switch self {
    case .symbol(let name):
      guard let image = NSImage(systemSymbolName: name, accessibilityDescription: accessibilityDescription) else {
        throw TrayHostError("unknown SF Symbol \(name)")
      }
      return image
    case .svg(let source, let template):
      guard let image = NSImage(data: Data(source.utf8)) else {
        throw TrayHostError("invalid SVG icon")
      }
      image.isTemplate = template
      return image
    }
  }
}

public struct TrayDefinition: Codable, Equatable, Sendable {
  public let title: String
  public let icon: TrayIcon?
  public let logo: TrayIcon?
  public let tooltip: String?
  public let items: [TrayItem]

  public init(
    title: String,
    icon: TrayIcon? = nil,
    logo: TrayIcon? = nil,
    tooltip: String? = nil,
    items: [TrayItem] = []
  ) {
    self.title = title
    self.icon = icon
    self.logo = logo
    self.tooltip = tooltip
    self.items = items
  }
}

public struct TrayItem: Codable, Equatable, Sendable {
  public let kind: String
  public let title: String?
  public let id: String?
  public let icon: TrayIcon?
  public let subtitle: String?
  public let url: String?
  public let prompt: String?
  public let enabled: Bool?
  public let value: Bool?
  public let items: [TrayItem]?
}

public struct ProviderEnvelope: Decodable, Sendable {
  public let type: String
  public let tray: TrayDefinition?
  public let message: String?
}

public struct TrayProviderConfiguration: Sendable {
  public let rip: URL
  public let provider: URL

  public init(rip: URL, provider: URL) {
    self.rip = rip
    self.provider = provider
  }

  public static func current(
    arguments: [String] = CommandLine.arguments,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    directory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
  ) throws -> Self {
    let providerPath = environment["RIP_TRAY_PROVIDER"] ?? arguments.dropFirst().first
    let provider = providerPath.map { resolve($0, relativeTo: directory) }
      ?? Bundle.main.url(forResource: "Tray", withExtension: "rip")
    guard let provider else {
      throw TrayHostError("no Rip provider — pass a .rip file, set RIP_TRAY_PROVIDER, or bundle Tray.rip")
    }
    guard FileManager.default.fileExists(atPath: provider.path) else {
      throw TrayHostError("Rip provider not found: \(provider.path)")
    }

    let home = FileManager.default.homeDirectoryForCurrentUser
    let candidates = [
      environment["RIP_TRAY_RIP"].map { resolve($0, relativeTo: directory) },
      home.appendingPathComponent(".bun/rip"),
      home.appendingPathComponent(".bun/bin/rip"),
      URL(fileURLWithPath: "/opt/homebrew/bin/rip"),
      URL(fileURLWithPath: "/usr/local/bin/rip"),
      directory.appendingPathComponent("../../bin/rip").standardizedFileURL,
    ].compactMap { $0 }
    guard let rip = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }) else {
      throw TrayHostError("Rip executable not found — set RIP_TRAY_RIP to this checkout's bin/rip")
    }
    return Self(rip: rip, provider: provider)
  }

  private static func resolve(_ path: String, relativeTo directory: URL) -> URL {
    if path.hasPrefix("/") { return URL(fileURLWithPath: path).standardizedFileURL }
    return directory.appendingPathComponent(path).standardizedFileURL
  }
}

struct TrayHostError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

@MainActor
public final class TrayProvider: ObservableObject {
  @Published public private(set) var tray = TrayDefinition(title: "Rip", icon: .symbol("bolt.horizontal.circle"))
  @Published public private(set) var error: String?

  private var process: Process?
  private var input: FileHandle?
  private var outputBuffer = Data()
  private var errorBuffer = Data()

  public init(configuration: TrayProviderConfiguration? = nil) {
    do {
      try start(configuration ?? TrayProviderConfiguration.current())
    } catch {
      self.error = error.localizedDescription
    }
  }

  deinit {
    process?.terminate()
  }

  public func perform(_ item: TrayItem) {
    switch item.kind {
    case "action":
      send(id: item.id, value: nil)
    case "toggle":
      send(id: item.id, value: !(item.value ?? false))
    case "directory":
      let panel = NSOpenPanel()
      panel.canChooseDirectories = true
      panel.canChooseFiles = false
      panel.allowsMultipleSelection = false
      panel.prompt = item.prompt ?? "Choose"
      if panel.runModal() == .OK, let path = panel.url?.path {
        send(id: item.id, value: path)
      }
    case "link":
      guard let raw = item.url, let url = URL(string: raw), NSWorkspace.shared.open(url) else {
        error = "Cannot open \(item.url ?? "missing URL")"
        return
      }
    case "quit":
      NSApplication.shared.terminate(nil)
    default:
      error = "Unsupported tray item kind: \(item.kind)"
    }
  }

  private func start(_ configuration: TrayProviderConfiguration) throws {
    let process = Process()
    let stdin = Pipe()
    let stdout = Pipe()
    let stderr = Pipe()
    process.executableURL = configuration.rip
    process.arguments = [configuration.provider.path]
    process.currentDirectoryURL = configuration.provider.deletingLastPathComponent()
    process.standardInput = stdin
    process.standardOutput = stdout
    process.standardError = stderr
    var environment = ProcessInfo.processInfo.environment
    environment["RIP_TRAY_RIP"] = configuration.rip.path
    let bin = configuration.rip.deletingLastPathComponent().path
    environment["PATH"] = bin + ":" + environment["PATH", default: ""]
    process.environment = environment

    stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      Task { @MainActor in self?.receive(data) }
    }
    stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      Task { @MainActor in self?.receiveError(data) }
    }
    process.terminationHandler = { [weak self] process in
      Task { @MainActor in
        guard let self else { return }
        let detail = String(data: self.errorBuffer, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.error = detail?.isEmpty == false
          ? detail
          : "Rip tray provider exited with status \(process.terminationStatus)"
      }
    }
    try process.run()
    self.process = process
    self.input = stdin.fileHandleForWriting
  }

  private func receive(_ data: Data) {
    outputBuffer.append(data)
    while let newline = outputBuffer.firstIndex(of: 0x0A) {
      let line = outputBuffer[..<newline]
      outputBuffer.removeSubrange(...newline)
      guard !line.isEmpty else { continue }
      do {
        let envelope = try JSONDecoder().decode(ProviderEnvelope.self, from: line)
        switch envelope.type {
        case "render":
          guard let tray = envelope.tray else { throw TrayHostError("render message has no tray") }
          try tray.validateIcons()
          self.tray = tray
          error = nil
        case "error":
          error = envelope.message ?? "Rip tray provider reported an unnamed error"
        default:
          throw TrayHostError("unknown Rip tray message \(envelope.type)")
        }
      } catch {
        self.error = "Invalid Rip tray output: \(error.localizedDescription)"
      }
    }
  }

  private func receiveError(_ data: Data) {
    errorBuffer.append(data)
  }

  private func send(id: String?, value: Any?) {
    guard let id else {
      error = "Tray action is missing its id"
      return
    }
    guard let input else {
      error = "Rip tray provider is not running"
      return
    }
    do {
      let message: [String: Any] = ["type": "action", "id": id, "value": value ?? NSNull()]
      var data = try JSONSerialization.data(withJSONObject: message)
      data.append(0x0A)
      try input.write(contentsOf: data)
    } catch {
      self.error = "Cannot send tray action \(id): \(error.localizedDescription)"
    }
  }
}

public struct TrayStatusLabel: View {
  @ObservedObject private var provider: TrayProvider

  public init(provider: TrayProvider) {
    self.provider = provider
  }

  public var body: some View {
    Label {
      Text(provider.tray.title)
    } icon: {
      TrayIconView(icon: provider.tray.icon ?? .symbol("circle"), size: 18)
    }
    .help(provider.tray.tooltip ?? provider.tray.title)
  }
}

public struct TrayPanel: View {
  @ObservedObject private var provider: TrayProvider

  public init(provider: TrayProvider) {
    self.provider = provider
  }

  public var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        if let logo = provider.tray.logo ?? provider.tray.icon {
          TrayIconView(icon: logo, size: 38)
        }
        VStack(alignment: .leading, spacing: 2) {
          Text(provider.tray.title).font(.title2.weight(.semibold))
          if let tooltip = provider.tray.tooltip {
            Text(tooltip).font(.subheadline).foregroundStyle(.secondary)
          }
        }
        Spacer()
      }
      .padding(16)

      Divider()

      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          if let error = provider.error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
              .foregroundStyle(.red)
              .font(.callout)
              .fixedSize(horizontal: false, vertical: true)
          }
          TrayPanelItems(items: provider.tray.items, provider: provider)
        }
        .padding(12)
      }
      .frame(maxHeight: 520)
    }
    .frame(width: 360)
  }
}

private struct TrayPanelItems: View {
  let items: [TrayItem]
  @ObservedObject var provider: TrayProvider

  var body: some View {
    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
      switch item.kind {
      case "separator":
        Divider()
      case "submenu":
        VStack(alignment: .leading, spacing: 7) {
          ItemLabel(item: item)
            .font(.headline)
            .foregroundStyle(item.enabled ?? true ? .primary : .secondary)
          VStack(spacing: 2) {
            TrayPanelItems(items: item.items ?? [], provider: provider)
          }
          .padding(6)
          .background(.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 10))
        }
        .disabled(!(item.enabled ?? true))
      case "label":
        PanelLabelRow(item: item)
      case "toggle":
        Toggle(isOn: Binding(
          get: { item.value ?? false },
          set: { _ in provider.perform(item) }
        )) {
          PanelLabelRow(item: item)
        }
        .toggleStyle(.switch)
        .disabled(!(item.enabled ?? true))
      case "action", "directory", "link", "quit":
        Button { provider.perform(item) } label: {
          PanelLabelRow(item: item)
        }
        .buttonStyle(TrayPanelButtonStyle())
        .disabled(!(item.enabled ?? true))
      default:
        Label("Unsupported item: \(item.kind)", systemImage: "questionmark.circle")
          .foregroundStyle(.secondary)
      }
    }
  }
}

private struct PanelLabelRow: View {
  let item: TrayItem

  var body: some View {
    HStack(spacing: 10) {
      if let icon = item.icon {
        ZStack {
          Circle().fill(.primary.opacity(0.08))
          TrayIconView(icon: icon, size: 17)
        }
        .frame(width: 30, height: 30)
      }
      VStack(alignment: .leading, spacing: 1) {
        Text(item.title ?? "")
        if let subtitle = item.subtitle {
          Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 8)
    }
    .contentShape(Rectangle())
    .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
  }
}

private struct TrayPanelButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .padding(.horizontal, 5)
      .background(
        configuration.isPressed ? Color.accentColor.opacity(0.16) : Color.clear,
        in: RoundedRectangle(cornerRadius: 7)
      )
  }
}

private struct ItemLabel: View {
  let item: TrayItem

  var body: some View {
    if let icon = item.icon {
      Label {
        Text(item.title ?? "")
      } icon: {
        TrayIconView(icon: icon, size: 16)
      }
        .help(item.subtitle ?? "")
    } else {
      Text(item.title ?? "")
        .help(item.subtitle ?? "")
    }
  }
}

private struct TrayIconView: View {
  let icon: TrayIcon
  let size: CGFloat

  var body: some View {
    if let image = try? icon.nativeImage() {
      Image(nsImage: image)
        .resizable()
        .renderingMode(icon.usesTemplateRendering ? .template : .original)
        .scaledToFit()
        .frame(width: size, height: size)
    }
  }
}

private extension TrayDefinition {
  func validateIcons() throws {
    if let icon { _ = try icon.nativeImage(accessibilityDescription: title) }
    if let logo { _ = try logo.nativeImage(accessibilityDescription: title) }
    try items.validateIcons()
  }
}

private extension Array where Element == TrayItem {
  func validateIcons() throws {
    for item in self {
      if let icon = item.icon { _ = try icon.nativeImage(accessibilityDescription: item.title) }
      try (item.items ?? []).validateIcons()
    }
  }
}
