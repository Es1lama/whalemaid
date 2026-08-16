package com.whalemaid.controller

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID

private const val MAX_CHUNK_BYTES = 256 * 1024
private const val MAX_ASSET_BYTES = 64L * 1024 * 1024

private data class NativeAsset(
    val id: String,
    val file: File,
    val name: String,
    val mimeType: String,
    val width: Int? = null,
    val height: Int? = null,
    val durationMs: Long? = null,
) {
    fun toJson(): JSObject = JSObject().apply {
        put("id", id)
        put("name", name)
        put("mimeType", mimeType)
        put("size", file.length())
        width?.let { put("width", it) }
        height?.let { put("height", it) }
        durationMs?.let { put("durationMs", it) }
    }
}

internal object NativeAssetChunks {
    fun read(file: File, offset: Long, requestedLength: Int): ByteArray {
        require(offset >= 0) { "offset must be non-negative" }
        val length = requestedLength.coerceIn(1, MAX_CHUNK_BYTES)
        if (offset >= file.length()) return ByteArray(0)
        val result = ByteArray(minOf(length.toLong(), file.length() - offset).toInt())
        RandomAccessFile(file, "r").use {
            it.seek(offset)
            it.readFully(result)
        }
        return result
    }
}

@CapacitorPlugin(
    name = "WhaleMaidNative",
    permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])],
)
class WhaleMaidNativePlugin : Plugin() {
    private val assets = LinkedHashMap<String, NativeAsset>()
    private var pendingCameraFile: File? = null
    private var recorder: MediaRecorder? = null
    private var recordingId: String? = null
    private var recordingFile: File? = null
    private var recordingStartedAt = 0L

    @PluginMethod
    fun capabilities(call: PluginCall) {
        val cameraIntent = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
        call.resolve(JSObject().apply {
            put("camera", cameraIntent.resolveActivity(context.packageManager) != null)
            put("gallery", true)
            put("microphone", context.packageManager.hasSystemFeature("android.hardware.microphone"))
            put("files", true)
            put("maxChunkBytes", MAX_CHUNK_BYTES)
            put("maxAssetBytes", MAX_ASSET_BYTES)
        })
    }

    @PluginMethod
    fun capturePhoto(call: PluginCall) {
        val dir = assetDirectory()
        val file = File(dir, "camera-${UUID.randomUUID()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (intent.resolveActivity(context.packageManager) == null) {
            call.reject("CAMERA_UNAVAILABLE")
            return
        }
        pendingCameraFile = file
        startActivityForResult(call, intent, "cameraResult")
    }

    @ActivityCallback
    private fun cameraResult(call: PluginCall, result: ActivityResult) {
        val file = pendingCameraFile
        pendingCameraFile = null
        if (result.resultCode != Activity.RESULT_OK || file == null || !file.isFile || file.length() == 0L) {
            file?.delete()
            call.reject("USER_CANCELLED")
            return
        }
        try {
            val asset = registerFile(file, file.name, "image/jpeg")
            call.resolve(JSObject().put("asset", asset.toJson()))
        } catch (e: Exception) {
            file.delete()
            call.reject("ASSET_UNREADABLE", e)
        }
    }

    @PluginMethod
    fun pickGallery(call: PluginCall) {
        val multiple = call.getBoolean("multiple", true) ?: true
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        }
        startActivityForResult(call, intent, "selectionResult")
    }

    @PluginMethod
    fun pickFiles(call: PluginCall) {
        val multiple = call.getBoolean("multiple", true) ?: true
        val mimeTypes = call.getArray("mimeTypes")?.toList<String>()?.filter { it.isNotBlank() }.orEmpty()
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (mimeTypes.size == 1) mimeTypes.first() else "*/*"
            if (mimeTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        }
        startActivityForResult(call, intent, "selectionResult")
    }

    @ActivityCallback
    private fun selectionResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("USER_CANCELLED")
            return
        }
        val uris = result.data?.let(::urisFrom) ?: emptyList()
        if (uris.isEmpty()) {
            call.reject("ASSET_UNREADABLE")
            return
        }
        try {
            val selected = uris.map(::copyUri)
            call.resolve(JSObject().put("assets", JSArray(selected.map { it.toJson() })))
        } catch (e: Exception) {
            call.reject("ASSET_UNREADABLE", e)
        }
    }

    @PluginMethod
    fun startRecording(call: PluginCall) {
        if (recorder != null) {
            call.reject("RECORDING_IN_PROGRESS")
            return
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionResult")
            return
        }
        startRecorder(call)
    }

    @PermissionCallback
    private fun microphonePermissionResult(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("PERMISSION_DENIED")
            return
        }
        startRecorder(call)
    }

    private fun startRecorder(call: PluginCall) {
        val id = UUID.randomUUID().toString()
        val file = File(assetDirectory(), "recording-$id.m4a")
        val next = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        try {
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            next.setAudioEncodingBitRate(128_000)
            next.setAudioSamplingRate(44_100)
            next.setOutputFile(file.absolutePath)
            next.prepare()
            next.start()
            recorder = next
            recordingId = id
            recordingFile = file
            recordingStartedAt = System.currentTimeMillis()
            call.resolve(JSObject().put("handle", id))
        } catch (e: Exception) {
            next.release()
            file.delete()
            call.reject("RECORDING_START_FAILED", e)
        }
    }

    @PluginMethod
    fun pauseRecording(call: PluginCall) {
        if (!recordingMatches(call)) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            call.reject("PAUSE_UNSUPPORTED")
            return
        }
        try {
            recorder?.pause()
            call.resolve()
        } catch (e: Exception) {
            call.reject("RECORDING_PAUSE_FAILED", e)
        }
    }

    @PluginMethod
    fun resumeRecording(call: PluginCall) {
        if (!recordingMatches(call)) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            call.reject("RESUME_UNSUPPORTED")
            return
        }
        try {
            recorder?.resume()
            call.resolve()
        } catch (e: Exception) {
            call.reject("RECORDING_RESUME_FAILED", e)
        }
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        if (!recordingMatches(call)) return
        val file = recordingFile ?: run {
            call.reject("NO_RECORDING")
            return
        }
        val elapsed = System.currentTimeMillis() - recordingStartedAt
        try {
            recorder?.stop()
            recorder?.release()
            clearRecorderState()
            val asset = registerFile(file, file.name, "audio/mp4", elapsed)
            call.resolve(JSObject().put("asset", asset.toJson()))
        } catch (e: Exception) {
            recorder?.release()
            clearRecorderState()
            file.delete()
            call.reject("RECORDING_STOP_FAILED", e)
        }
    }

    @PluginMethod
    fun cancelRecording(call: PluginCall) {
        if (!recordingMatches(call)) return
        cancelActiveRecording()
        call.resolve()
    }

    @PluginMethod
    fun readAsset(call: PluginCall) {
        val id = call.getString("id") ?: run {
            call.reject("ASSET_ID_REQUIRED")
            return
        }
        val offset = call.getLong("offset", 0L) ?: 0L
        val length = call.getInt("length", MAX_CHUNK_BYTES) ?: MAX_CHUNK_BYTES
        val asset = assets[id] ?: run {
            call.reject("ASSET_NOT_FOUND")
            return
        }
        try {
            val bytes = NativeAssetChunks.read(asset.file, offset, length)
            call.resolve(JSObject().apply {
                put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
                put("offset", offset)
                put("done", offset + bytes.size >= asset.file.length())
            })
        } catch (e: Exception) {
            call.reject("ASSET_UNREADABLE", e)
        }
    }

    @PluginMethod
    fun releaseAsset(call: PluginCall) {
        val id = call.getString("id") ?: run {
            call.reject("ASSET_ID_REQUIRED")
            return
        }
        assets.remove(id)?.file?.delete()
        call.resolve()
    }

    override fun handleOnStop() {
        cancelActiveRecording()
    }

    override fun handleOnDestroy() {
        cancelActiveRecording()
        assets.values.forEach { it.file.delete() }
        assets.clear()
    }

    private fun recordingMatches(call: PluginCall): Boolean {
        val handle = call.getString("handle")
        if (handle == null || recorder == null || handle != recordingId) {
            call.reject("NO_RECORDING")
            return false
        }
        return true
    }

    private fun cancelActiveRecording() {
        val active = recorder ?: return
        runCatching { active.stop() }
        active.release()
        recordingFile?.delete()
        clearRecorderState()
    }

    private fun clearRecorderState() {
        recorder = null
        recordingId = null
        recordingFile = null
        recordingStartedAt = 0L
    }

    private fun assetDirectory(): File = File(context.cacheDir, "whalemaid-assets").apply { mkdirs() }

    private fun urisFrom(intent: Intent): List<Uri> {
        val result = ArrayList<Uri>()
        intent.data?.let(result::add)
        val clip: ClipData? = intent.clipData
        if (clip != null) for (index in 0 until clip.itemCount) result.add(clip.getItemAt(index).uri)
        return result.distinct()
    }

    private fun copyUri(uri: Uri): NativeAsset {
        val resolver = context.contentResolver
        var name = "asset-${UUID.randomUUID()}"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) name = cursor.getString(0) ?: name
        }
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        val suffix = name.substringAfterLast('.', "bin").take(12)
        val file = File(assetDirectory(), "asset-${UUID.randomUUID()}.$suffix")
        try {
            resolver.openInputStream(uri)?.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    var copied = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        copied += count
                        require(copied <= MAX_ASSET_BYTES) { "asset exceeds $MAX_ASSET_BYTES bytes" }
                        output.write(buffer, 0, count)
                    }
                }
            } ?: error("content resolver returned no stream")
            return registerFile(file, name, mime)
        } catch (e: Exception) {
            file.delete()
            throw e
        }
    }

    private fun registerFile(file: File, name: String, mimeType: String, durationHint: Long? = null): NativeAsset {
        require(file.length() in 1..MAX_ASSET_BYTES) { "asset size is outside the supported range" }
        val dimensions = if (mimeType.startsWith("image/")) imageDimensions(file) else null
        val duration = if (mimeType.startsWith("audio/")) audioDuration(file) ?: durationHint else null
        val asset = NativeAsset(
            id = UUID.randomUUID().toString(),
            file = file,
            name = name,
            mimeType = mimeType,
            width = dimensions?.first,
            height = dimensions?.second,
            durationMs = duration,
        )
        assets[asset.id] = asset
        return asset
    }

    private fun imageDimensions(file: File): Pair<Int, Int>? {
        val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeFile(file.absolutePath, options)
        return if (options.outWidth > 0 && options.outHeight > 0) options.outWidth to options.outHeight else null
    }

    private fun audioDuration(file: File): Long? = runCatching {
        MediaMetadataRetriever().use { retriever ->
            retriever.setDataSource(file.absolutePath)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        }
    }.getOrNull()
}
