// Usage: swift windows.swift <ownerName>  → JSON lines {id, name, w, h, onscreen} for that app's normal (layer 0) windows.
import CoreGraphics
import Foundation
let owner = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Edits"
if let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] {
  for w in list where (w[kCGWindowOwnerName as String] as? String) == owner && (w[kCGWindowLayer as String] as? Int) == 0 {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let row: [String: Any] = [
      "id": w[kCGWindowNumber as String] as? Int ?? 0, "name": w[kCGWindowName as String] as? String ?? "",
      "w": b["Width"] as? Double ?? 0, "h": b["Height"] as? Double ?? 0, "onscreen": w[kCGWindowIsOnscreen as String] as? Bool ?? false,
    ]
    print(String(data: try! JSONSerialization.data(withJSONObject: row), encoding: .utf8)!)
  }
}
