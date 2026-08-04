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

  public func nativeImage(accessibilityDescription: String? = nil, size: CGFloat? = nil) throws -> NSImage {
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
      if let size { image.size = NSSize(width: size, height: size) }
      image.isTemplate = template
      image.accessibilityDescription = accessibilityDescription
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
      TrayIconView(icon: provider.tray.icon ?? .symbol("circle"), size: 24)
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
      HStack(spacing: 10) {
        Text(provider.tray.title).font(.headline)
        Spacer()
        if let logo = provider.tray.logo {
          TrayIconView(icon: logo, size: 30)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .help(provider.tray.tooltip ?? provider.tray.title)

      Divider()

      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          if let error = provider.error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
              .foregroundStyle(.red)
              .font(.callout)
              .fixedSize(horizontal: false, vertical: true)
              .padding(12)
          }
          TrayPanelItems(items: provider.tray.items, provider: provider)
        }
        .padding(.vertical, 6)
      }
      .frame(height: min(max(provider.tray.items.panelHeight + (provider.error == nil ? 0 : 54), 120), 520))
    }
    .frame(width: 340)
  }
}

private struct TrayPanelItems: View {
  let items: [TrayItem]
  @ObservedObject var provider: TrayProvider

  var body: some View {
    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
      switch item.kind {
      case "separator":
        Divider().padding(.horizontal, 12).padding(.vertical, 5)
      case "submenu":
        PanelGroupRow(item: item, provider: provider)
      case "label":
        PanelInformationRow(item: item)
      case "toggle":
        PanelToggleRow(item: item, provider: provider)
      case "action", "directory", "link", "quit":
        PanelActionRow(item: item, provider: provider)
      default:
        Label("Unsupported item: \(item.kind)", systemImage: "questionmark.circle")
          .foregroundStyle(.secondary)
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
      }
    }
  }
}

private struct PanelGroupRow: View {
  let item: TrayItem
  @ObservedObject var provider: TrayProvider

  private var details: [TrayItem] {
    (item.items ?? []).filter { $0.kind == "label" }
  }

  private var controls: [TrayItem] {
    (item.items ?? []).filter { ["separator", "action", "toggle", "directory", "link", "quit"].contains($0.kind) }
  }

  private var nested: [TrayItem] {
    (item.items ?? []).filter { $0.kind == "submenu" }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        PanelLeadingIcon(icon: item.icon)
        VStack(alignment: .leading, spacing: 2) {
          Text(item.title ?? "").fontWeight(.medium)
          ForEach(Array(details.enumerated()), id: \.offset) { _, detail in
            PanelDetail(item: detail)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: 2) {
          ForEach(Array(controls.enumerated()), id: \.offset) { _, control in
            PanelCompactControl(item: control, provider: provider)
          }
        }
      }
      .padding(.horizontal, 17)
      .padding(.vertical, 7)
      .opacity(item.enabled ?? true ? 1 : 0.45)
      .disabled(!(item.enabled ?? true))

      if !nested.isEmpty {
        TrayPanelItems(items: nested, provider: provider)
          .padding(.leading, 22)
      }
    }
  }
}

private struct PanelInformationRow: View {
  let item: TrayItem

  var body: some View {
    HStack(spacing: 10) {
      PanelLeadingIcon(icon: item.icon)
      VStack(alignment: .leading, spacing: 2) {
        Text(item.title ?? "")
        if let subtitle = item.subtitle {
          Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 8)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 7)
  }
}

private struct PanelDetail: View {
  let item: TrayItem

  var body: some View {
    let text = [item.title, item.subtitle].compactMap { $0 }.joined(separator: " · ")
    HStack(spacing: 4) {
      if let icon = item.icon {
        TrayIconView(icon: icon, size: 10)
      }
      Text(text)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .help(text)
  }
}

private struct PanelLeadingIcon: View {
  let icon: TrayIcon?

  var body: some View {
    if let icon {
      ZStack {
        Circle().fill(.primary.opacity(0.08))
        TrayIconView(icon: icon, size: 16)
      }
      .frame(width: 30, height: 30)
    }
  }
}

private struct PanelCompactControl: View {
  let item: TrayItem
  @ObservedObject var provider: TrayProvider
  @State private var hovering = false

  private var fallbackIcon: TrayIcon {
    switch item.kind {
    case "directory": .symbol("folder.badge.plus")
    case "link": .symbol("arrow.up.right")
    case "quit": .symbol("power")
    default: .symbol("ellipsis")
    }
  }

  var body: some View {
    if item.kind == "separator" {
      Divider().frame(height: 18).padding(.horizontal, 2)
    } else if item.kind == "toggle" {
      Toggle("", isOn: Binding(
        get: { item.value ?? false },
        set: { _ in provider.perform(item) }
      ))
      .labelsHidden()
      .toggleStyle(.switch)
      .controlSize(.mini)
      .help(item.title ?? "")
      .disabled(!(item.enabled ?? true))
    } else {
      Button { provider.perform(item) } label: {
        TrayIconView(icon: item.icon ?? fallbackIcon, size: 14)
          .frame(width: 27, height: 27)
          .background(
            hovering ? Color.primary.opacity(0.09) : Color.clear,
            in: RoundedRectangle(cornerRadius: 6)
          )
      }
      .buttonStyle(.plain)
      .help(item.title ?? "")
      .accessibilityLabel(Text(item.title ?? ""))
      .onHover { hovering = $0 }
      .disabled(!(item.enabled ?? true))
      .opacity(item.enabled ?? true ? 1 : 0.3)
    }
  }
}

private struct PanelToggleRow: View {
  let item: TrayItem
  @ObservedObject var provider: TrayProvider

  var body: some View {
    Toggle(isOn: Binding(
      get: { item.value ?? false },
      set: { _ in provider.perform(item) }
    )) {
      PanelInformationRow(item: item)
    }
    .toggleStyle(.switch)
    .padding(.trailing, 12)
    .disabled(!(item.enabled ?? true))
  }
}

private struct PanelActionRow: View {
  let item: TrayItem
  @ObservedObject var provider: TrayProvider
  @State private var hovering = false

  var body: some View {
    Button { provider.perform(item) } label: {
      PanelInformationRow(item: item)
        .contentShape(Rectangle())
        .background(
          hovering ? Color.primary.opacity(0.055) : Color.clear,
          in: RoundedRectangle(cornerRadius: 7)
        )
    }
    .buttonStyle(.plain)
    .padding(.horizontal, 5)
    .onHover { hovering = $0 }
    .disabled(!(item.enabled ?? true))
    .opacity(item.enabled ?? true ? 1 : 0.4)
  }
}

private struct TrayIconView: View {
  let icon: TrayIcon
  let size: CGFloat

  var body: some View {
    if let image = try? icon.nativeImage(size: size) {
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
  var panelHeight: CGFloat {
    reduce(12) { height, item in
      switch item.kind {
      case "separator": return height + 11
      case "submenu":
        let nested = (item.items ?? []).filter { $0.kind == "submenu" }
        return height + 48 + (nested.isEmpty ? 0 : nested.panelHeight)
      default: return height + 44
      }
    }
  }

  func validateIcons() throws {
    for item in self {
      if let icon = item.icon { _ = try icon.nativeImage(accessibilityDescription: item.title) }
      try (item.items ?? []).validateIcons()
    }
  }
}
