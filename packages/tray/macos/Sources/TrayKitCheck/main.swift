import Foundation
import TrayKit

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else {
    FileHandle.standardError.write(Data("TrayKitCheck: \(message)\n".utf8))
    exit(1)
  }
}

let data = Data(#"{"type":"render","tray":{"title":"Rip","icon":"bolt","tooltip":"Apps","items":[{"kind":"label","title":"Ready","icon":"checkmark"},{"kind":"separator"},{"kind":"action","title":"Start","id":"start","enabled":true}]}}"#.utf8)
let envelope = try JSONDecoder().decode(ProviderEnvelope.self, from: data)
require(envelope.type == "render", "message type did not decode")
require(envelope.tray?.title == "Rip", "tray title did not decode")
require(envelope.tray?.items.map(\.kind) == ["label", "separator", "action"], "menu kinds did not decode")
require(envelope.tray?.items.last?.id == "start", "action id did not decode")
print("TrayKitCheck: 4 checks passed")
