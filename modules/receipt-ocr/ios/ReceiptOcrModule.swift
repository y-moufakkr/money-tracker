import ExpoModulesCore
import UIKit
import Vision

/// Reads the text of a receipt photo on the device with Apple Vision. Returns every line with its
/// bounding box (image pixels, top-left origin) and confidence. Nothing leaves the phone.
public class ReceiptOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReceiptOcr")

    AsyncFunction("recognizeAsync") { (uri: URL, promise: Promise) in
      guard let data = try? Data(contentsOf: uri), let image = UIImage(data: data), let cgImage = image.cgImage else {
        promise.reject("ERR_IMAGE", "The photo could not be read.")
        return
      }
      let width = Double(cgImage.width)
      let height = Double(cgImage.height)
      let request = VNRecognizeTextRequest { request, error in
        if let error = error {
          promise.reject("ERR_OCR", error.localizedDescription)
          return
        }
        let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
        let lines: [[String: Any]] = observations.compactMap { observation in
          guard let candidate = observation.topCandidates(1).first else { return nil }
          // Vision boxes are normalised with a bottom-left origin.
          let b = observation.boundingBox
          return [
            "text": candidate.string,
            "confidence": Double(candidate.confidence),
            "box": ["x": b.minX * width, "y": (1 - b.maxY) * height, "width": b.width * width, "height": b.height * height],
          ]
        }
        promise.resolve(["width": width, "height": height, "lines": lines])
      }
      request.recognitionLevel = .accurate
      // Amounts and dates must be read as printed, not "corrected" into words.
      request.usesLanguageCorrection = false
      request.recognitionLanguages = ["fr-FR", "en-US"]
      do {
        // The app re-encodes photos upright before reading them.
        try VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:]).perform([request])
      } catch {
        promise.reject("ERR_OCR", error.localizedDescription)
      }
    }
  }
}
