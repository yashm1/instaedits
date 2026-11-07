// Usage: swift ocr.swift <image>  → JSON lines {text, x, y, w, h} in PIXELS (origin top-left). Local only (Apple Vision).
import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!); exit(2)
}
let W = Double(cg.width), H = Double(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
for o in req.results ?? [] {
  guard let t = o.topCandidates(1).first else { continue }
  let b = o.boundingBox
  let row: [String: Any] = ["text": t.string, "x": b.minX * W, "y": (1 - b.maxY) * H, "w": b.width * W, "h": b.height * H]
  let d = try JSONSerialization.data(withJSONObject: row)
  print(String(data: d, encoding: .utf8)!)
}
