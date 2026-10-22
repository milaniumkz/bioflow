package kz.milanium.bioflow_mobile

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.RectF
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.print.pdf.PrintedPdfDocument
import android.util.Base64
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.FileOutputStream

class MainActivity : FlutterActivity() {
    private var driverBridge: DriverLocationBridge? = null
    private var pending: MethodChannel.Result? = null
    private var document: ByteArray? = null
    private val saveRequest = 7301
    private val pickRequest = 7302

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        driverBridge = DriverLocationBridge(this, flutterEngine.dartExecutor.binaryMessenger)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bioflow/mobile-files")
            .setMethodCallHandler { call, result ->
                try {
                    when (call.method) {
                        "pickFiles" -> {
                            if (pending != null) { result.error("busy", "Закончите выбор файла", null); return@setMethodCallHandler }
                            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                                addCategory(Intent.CATEGORY_OPENABLE)
                                type = "*/*"
                                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/jpeg", "image/png", "image/webp", "application/pdf"))
                                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.argument<Boolean>("multiple") == true)
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            pending = result
                            startActivityForResult(intent, pickRequest)
                        }
                        "saveFile" -> {
                            if (pending != null) { result.error("busy", "Закончите сохранение файла", null); return@setMethodCallHandler }
                            val data = call.argument<String>("data") ?: throw IllegalArgumentException()
                            require(data.length <= 28 * 1024 * 1024)
                            val bytes = Base64.decode(data, Base64.DEFAULT)
                            require(bytes.size <= 20 * 1024 * 1024)
                            val name = (call.argument<String>("filename") ?: "BIOFLOW.pdf")
                                .substringAfterLast('/').substringAfterLast('\\').replace(Regex("[\\p{Cntrl}]"), "_").take(180)
                            val mime = (call.argument<String>("mime") ?: "").substringBefore(';')
                            val allowed = setOf("text/csv", "text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/png", "image/jpeg", "image/webp")
                            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                                addCategory(Intent.CATEGORY_OPENABLE)
                                type = if (mime in allowed) mime else "application/octet-stream"
                                putExtra(Intent.EXTRA_TITLE, name)
                            }
                            document = bytes
                            pending = result
                            startActivityForResult(intent, saveRequest)
                        }
                        "printQr" -> {
                            val data = call.argument<String>("image") ?: throw IllegalArgumentException()
                            require(data.startsWith("data:image/png;base64,") && data.length < 4 * 1024 * 1024)
                            val bytes = Base64.decode(data.substringAfter(','), Base64.DEFAULT)
                            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                            require(bounds.outWidth in 1..2048 && bounds.outWidth == bounds.outHeight)
                            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalArgumentException()
                            (getSystemService(Context.PRINT_SERVICE) as PrintManager).print(
                                "BIOFLOW QR", QrPrintAdapter(this, bitmap), PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS).build())
                            result.success(null)
                        }
                        else -> result.notImplemented()
                    }
                } catch (_: Exception) {
                    if (pending === result) { pending = null; document = null }
                    result.error("file_operation", "Не удалось выполнить операцию с файлом", null)
                }
            }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        driverBridge?.onRequestPermissionsResult(requestCode)
    }

    @Deprecated("Activity result bridge for Flutter file operations")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != saveRequest && requestCode != pickRequest) return
        val result = pending ?: return
        val bytes = document
        pending = null
        document = null
        try {
            if (requestCode == pickRequest) {
                val uris = mutableListOf<String>()
                if (resultCode == Activity.RESULT_OK) {
                    val clip = data?.clipData
                    if (clip != null) for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri.toString())
                    else data?.data?.let { uris.add(it.toString()) }
                }
                result.success(uris)
            } else if (resultCode == Activity.RESULT_OK && data?.data != null && bytes != null) {
                contentResolver.openOutputStream(data.data!!)?.use { it.write(bytes) }
                    ?: throw IllegalStateException()
                result.success(true)
            } else result.success(false)
        } catch (_: Exception) { result.error("file_operation", "Не удалось сохранить файл", null) }
    }
}

private class QrPrintAdapter(private val context: Context, private val bitmap: Bitmap) : PrintDocumentAdapter() {
    private var attributes: PrintAttributes? = null
    override fun onLayout(oldAttributes: PrintAttributes?, newAttributes: PrintAttributes, cancellation: CancellationSignal, callback: LayoutResultCallback, extras: Bundle?) {
        if (cancellation.isCanceled) { callback.onLayoutCancelled(); return }
        attributes = newAttributes
        callback.onLayoutFinished(PrintDocumentInfo.Builder("BIOFLOW-QR.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(1).build(), oldAttributes != newAttributes)
    }
    override fun onWrite(pages: Array<out PageRange>, destination: ParcelFileDescriptor, cancellation: CancellationSignal, callback: WriteResultCallback) {
        if (cancellation.isCanceled) { callback.onWriteCancelled(); return }
        if (pages.none { it.start <= 0 && it.end >= 0 }) { callback.onWriteFinished(emptyArray()); return }
        val pdf = PrintedPdfDocument(context, attributes!!)
        try {
            val page = pdf.startPage(0)
            page.canvas.drawColor(Color.WHITE)
            val rect = page.info.contentRect
            val size = minOf(50f * 72f / 25.4f, rect.width().toFloat(), rect.height().toFloat())
            val x = rect.left + minOf(10f * 72f / 25.4f, (rect.width() - size).coerceAtLeast(0f))
            val y = rect.top + minOf(10f * 72f / 25.4f, (rect.height() - size).coerceAtLeast(0f))
            page.canvas.drawBitmap(bitmap, null, RectF(x, y, x + size, y + size), null)
            pdf.finishPage(page)
            FileOutputStream(destination.fileDescriptor).use { pdf.writeTo(it) }
            if (cancellation.isCanceled) callback.onWriteCancelled() else callback.onWriteFinished(arrayOf(PageRange(0, 0)))
        } catch (_: Exception) { callback.onWriteFailed("Не удалось подготовить QR") }
        finally { pdf.close() }
    }
    override fun onFinish() { bitmap.recycle() }
}
