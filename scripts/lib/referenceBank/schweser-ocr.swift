import Foundation
import PDFKit
import Vision
import CoreGraphics

guard CommandLine.arguments.count >= 4 else {
    fputs("Usage: schweser-ocr <pdf-path> <out-jsonl> <start-page-1> [end-page-1]\n", stderr)
    exit(1)
}

let pdfPath = CommandLine.arguments[1]
let outPath = CommandLine.arguments[2]
let startPage = max(1, Int(CommandLine.arguments[3]) ?? 1)
guard let doc = PDFDocument(url: URL(fileURLWithPath: pdfPath)) else {
    fputs("Failed to open PDF: \(pdfPath)\n", stderr)
    exit(2)
}
let totalPages = doc.pageCount
let endPage = CommandLine.arguments.count >= 5 ? min(totalPages, Int(CommandLine.arguments[4]) ?? totalPages) : totalPages

FileManager.default.createFile(atPath: outPath, contents: nil)
guard let handle = FileHandle(forWritingAtPath: outPath) else {
    fputs("Failed to open output: \(outPath)\n", stderr)
    exit(3)
}
defer { try? handle.close() }

let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

for p in startPage...endPage {
    autoreleasepool {
        guard let page = doc.page(at: p - 1) else { return }
        let bounds = page.bounds(for: .mediaBox)
        let scale: CGFloat = 2.0
        let width = Int(bounds.width * scale)
        let height = Int(bounds.height * scale)
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            return
        }
        ctx.setFillColor(white)
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: ctx)
        guard let cgImage = ctx.makeImage() else { return }

        var lines: [[String: Any]] = []
        let request = VNRecognizeTextRequest { req, err in
            guard err == nil, let obs = req.results as? [VNRecognizedTextObservation] else { return }
            for o in obs {
                if let top = o.topCandidates(1).first {
                    lines.append([
                        "text": top.string,
                        "confidence": Double(top.confidence),
                        "y": Double(o.boundingBox.origin.y),
                        "x": Double(o.boundingBox.origin.x)
                    ])
                }
            }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try? handler.perform([request])

        // Sort top-to-bottom (Vision y=0 is bottom), then left-to-right
        lines.sort {
            let y1 = $0["y"] as? Double ?? 0
            let y2 = $1["y"] as? Double ?? 0
            if abs(y1 - y2) > 0.01 { return y1 > y2 }
            return ($0["x"] as? Double ?? 0) < ($1["x"] as? Double ?? 0)
        }
        let fullText = lines.compactMap { $0["text"] as? String }.joined(separator: "\n")
        let confs = lines.compactMap { $0["confidence"] as? Double }
        let meanConf = confs.isEmpty ? 0.0 : confs.reduce(0, +) / Double(confs.count)
        let minConf = confs.min() ?? 0.0
        let row: [String: Any] = [
            "pdfPage": p,
            "lineCount": lines.count,
            "meanConfidence": (meanConf * 1000).rounded() / 1000,
            "minConfidence": (minConf * 1000).rounded() / 1000,
            "ocrStatus": "provisional_raw_ocr",
            "text": fullText
        ]
        if let data = try? JSONSerialization.data(withJSONObject: row), let str = String(data: data, encoding: .utf8) {
            handle.write((str + "\n").data(using: .utf8)!)
        }
    }
}
print("OCR_DONE \(startPage)-\(endPage) of \(totalPages)")
