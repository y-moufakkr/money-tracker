package expo.modules.receiptocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Reads the text of a receipt photo on the device with ML Kit's bundled Latin model.
 * Returns every line with its bounding box (in image pixels) and confidence; the app's
 * TypeScript parser does the rest. Nothing leaves the phone.
 */
class ReceiptOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReceiptOcr")

    AsyncFunction("recognizeAsync") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(CodedException("ERR_NO_CONTEXT", "The app is not ready to read photos.", null))
      } else {
        try {
          val parsed = if (uri.startsWith("/")) Uri.fromFile(File(uri)) else Uri.parse(uri)
          val image = InputImage.fromFilePath(context, parsed)
          val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
          recognizer.process(image)
            .addOnSuccessListener { text ->
              val lines = text.textBlocks.flatMap { it.lines }.map { line ->
                val box = line.boundingBox
                mapOf(
                  "text" to line.text,
                  "confidence" to line.confidence.toDouble(),
                  "box" to box?.let {
                    mapOf("x" to it.left, "y" to it.top, "width" to it.width(), "height" to it.height())
                  }
                )
              }
              promise.resolve(mapOf("width" to image.width, "height" to image.height, "lines" to lines))
            }
            .addOnFailureListener { e ->
              promise.reject(CodedException("ERR_OCR", e.message ?: "Text recognition failed.", e))
            }
            .addOnCompleteListener { recognizer.close() }
        } catch (e: Exception) {
          promise.reject(CodedException("ERR_IMAGE", "The photo could not be read: ${e.message}", e))
        }
      }
    }
  }
}
