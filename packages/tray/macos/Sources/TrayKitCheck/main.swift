import Foundation
import TrayKit

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else {
    FileHandle.standardError.write(Data("TrayKitCheck: \(message)\n".utf8))
    exit(1)
  }
}

let data = Data(##"{"type":"render","tray":{"title":"Rip","icon":{"kind":"svg","source":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M0 0h8v8H0z\"/></svg>","template":true},"logo":{"kind":"svg","source":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path fill=\"#f00\" d=\"M0 0h8v8H0z\"/></svg>","template":false},"tooltip":"Apps","items":[{"kind":"label","title":"Ready","icon":"checkmark"},{"kind":"separator"},{"kind":"action","title":"Start","id":"start","enabled":true}]}}"##.utf8)
let envelope = try JSONDecoder().decode(ProviderEnvelope.self, from: data)
require(envelope.type == "render", "message type did not decode")
require(envelope.tray?.title == "Rip", "tray title did not decode")
require(envelope.tray?.items.map(\.kind) == ["label", "separator", "action"], "menu kinds did not decode")
require(envelope.tray?.items.last?.id == "start", "action id did not decode")
if case .svg(_, let template) = envelope.tray?.icon {
  require(template, "template SVG did not decode")
} else {
  require(false, "SVG icon did not decode")
}
if case .svg(_, let template) = envelope.tray?.logo {
  require(!template, "full-color SVG did not decode")
} else {
  require(false, "SVG logo did not decode")
}
let icon = try envelope.tray?.icon?.nativeImage(accessibilityDescription: "Rip", size: 18)
require(icon?.isTemplate == true, "template SVG did not become an NSImage")
require(icon?.size == NSSize(width: 18, height: 18), "SVG icon did not adopt its requested point size")
let logo = try envelope.tray?.logo?.nativeImage(accessibilityDescription: "Rip")
require(logo?.isTemplate == false, "full-color SVG did not retain original rendering")
do {
  _ = try TrayIcon.svg(source: "not SVG", template: true).nativeImage()
  require(false, "invalid SVG rendered")
} catch {
  require(error.localizedDescription == "invalid SVG icon", "invalid SVG error was not precise")
}
print("TrayKitCheck: 10 checks passed")
