package com.dualviewcamerav1init

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import androidx.heifwriter.HeifWriter
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.Presentation
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

class DualViewMediaModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private val activeTransformers = ConcurrentHashMap<String, Transformer>()

  override fun getName(): String = "DualViewMedia"

  @ReactMethod
  fun shareMedia(uriString: String, mimeType: String, title: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType.ifBlank { "*/*" }
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(shareIntent, title.ifBlank { "分享" }).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(chooser)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("ESHARE", error.message, error)
    }
  }

  @ReactMethod
  fun getMediaStoragePath(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      if (uri.scheme == "file") {
        promise.resolve(uri.path ?: uriString.removePrefix("file://"))
        return
      }
      val columns = mutableListOf(
          MediaStore.MediaColumns.DATA,
          MediaStore.MediaColumns.DISPLAY_NAME
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        columns.add(MediaStore.MediaColumns.RELATIVE_PATH)
      }
      reactContext.contentResolver.query(uri, columns.toTypedArray(), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val dataIndex = cursor.getColumnIndex(MediaStore.MediaColumns.DATA)
          if (dataIndex >= 0) {
            val data = cursor.getString(dataIndex)
            if (!data.isNullOrBlank()) {
              promise.resolve(data)
              return
            }
          }
          val nameIndex = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
          val filename = if (nameIndex >= 0) cursor.getString(nameIndex) else null
          if (!filename.isNullOrBlank() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val relativeIndex = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
            val relativePath = if (relativeIndex >= 0) cursor.getString(relativeIndex) else null
            if (!relativePath.isNullOrBlank()) {
              val root = Environment.getExternalStorageDirectory().absolutePath.trimEnd('/')
              promise.resolve("$root/${relativePath.trimStart('/')}$filename")
              return
            }
          }
          if (!filename.isNullOrBlank()) {
            val root = Environment.getExternalStorageDirectory().absolutePath.trimEnd('/')
            promise.resolve("$root/DCIM/DualViewCamera/$filename")
            return
          }
        }
      }
      promise.resolve(uriString)
    } catch (error: Throwable) {
      promise.reject("EPATH", error.message, error)
    }
  }

  @ReactMethod
  fun createPhotoVariant(sourcePath: String, variant: String, suffix: String, promise: Promise) {
    createPhotoVariantInternal(sourcePath, photoAspectForVariant(variant), safeVariant(variant), suffix, "jpeg", promise)
  }

  @ReactMethod
  fun createPhotoVariantWithAspect(sourcePath: String, suffix: String, aspectWidth: Double, aspectHeight: Double, promise: Promise) {
    createPhotoVariantWithAspectAndFormat(sourcePath, suffix, aspectWidth, aspectHeight, "jpeg", promise)
  }

  @ReactMethod
  fun createPhotoVariantWithAspectAndFormat(sourcePath: String, suffix: String, aspectWidth: Double, aspectHeight: Double, format: String, promise: Promise) {
    val width = aspectWidth.coerceAtLeast(1.0)
    val height = aspectHeight.coerceAtLeast(1.0)
    createPhotoVariantInternal(sourcePath, width / height, "wysiwyg", suffix, format, promise)
  }

  @ReactMethod
  fun createDualPhotoVariantsWithAspects(
      sourcePath: String,
      mainSuffix: String,
      mainAspectWidth: Double,
      mainAspectHeight: Double,
      subSuffix: String,
      subAspectWidth: Double,
      subAspectHeight: Double,
      promise: Promise
  ) {
    createDualPhotoVariantsWithAspectsAndFormat(
        sourcePath,
        mainSuffix,
        mainAspectWidth,
        mainAspectHeight,
        subSuffix,
        subAspectWidth,
        subAspectHeight,
        "jpeg",
        promise
    )
  }

  @ReactMethod
  fun createDualPhotoVariantsWithAspectsAndFormat(
      sourcePath: String,
      mainSuffix: String,
      mainAspectWidth: Double,
      mainAspectHeight: Double,
      subSuffix: String,
      subAspectWidth: Double,
      subAspectHeight: Double,
      format: String,
      promise: Promise
  ) {
    try {
      val source = File(sourcePath.removePrefix("file://"))
      if (!source.exists()) {
        promise.reject("ENOENT", "Source photo does not exist: ${source.absolutePath}")
        return
      }

      val decoded = BitmapFactory.decodeFile(source.absolutePath)
      if (decoded == null) {
        promise.reject("EDECODE", "Unable to decode source photo: ${source.absolutePath}")
        return
      }

      val upright = applyExifOrientation(decoded, source.absolutePath)
      val mainTarget = writePhotoVariant(
          upright,
          mainAspectWidth.coerceAtLeast(1.0) / mainAspectHeight.coerceAtLeast(1.0),
          "main",
          mainSuffix,
          format
      )
      val subTarget = writePhotoVariant(
          upright,
          subAspectWidth.coerceAtLeast(1.0) / subAspectHeight.coerceAtLeast(1.0),
          "sub",
          subSuffix,
          format
      )

      if (decoded !== upright) decoded.recycle()
      upright.recycle()

      val result = WritableNativeMap()
      result.putString("mainPath", mainTarget.absolutePath)
      result.putString("subPath", subTarget.absolutePath)
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("ECROP", error.message, error)
    }
  }

  private fun createPhotoVariantInternal(sourcePath: String, targetAspect: Double, variantLabel: String, suffix: String, format: String, promise: Promise) {
    try {
      val source = File(sourcePath.removePrefix("file://"))
      if (!source.exists()) {
        promise.reject("ENOENT", "Source photo does not exist: ${source.absolutePath}")
        return
      }

      val decoded = BitmapFactory.decodeFile(source.absolutePath)
      if (decoded == null) {
        promise.reject("EDECODE", "Unable to decode source photo: ${source.absolutePath}")
        return
      }

      val upright = applyExifOrientation(decoded, source.absolutePath)
      val target = writePhotoVariant(upright, targetAspect, variantLabel, suffix, format)

      if (decoded !== upright) decoded.recycle()
      upright.recycle()

      promise.resolve(target.absolutePath)
    } catch (error: Throwable) {
      promise.reject("ECROP", error.message, error)
    }
  }

  private fun writePhotoVariant(source: Bitmap, targetAspect: Double, variantLabel: String, suffix: String, format: String): File {
    val cropped = centerCrop(source, targetAspect)
    val useHeif = shouldWriteHeif(format)
    val target = File(
        reactContext.cacheDir,
        "DualViewCamera_${safeSuffix(suffix)}_${variantLabel}_${System.currentTimeMillis()}.${if (useHeif) "heic" else "jpg"}"
    )
    if (useHeif) {
      writeHeif(cropped, target)
    } else {
      FileOutputStream(target).use { output ->
        cropped.compress(Bitmap.CompressFormat.JPEG, 94, output)
      }
    }
    if (source !== cropped) cropped.recycle()
    return target
  }

  @ReactMethod
  fun createVideoVariant(sourcePath: String, variant: String, suffix: String, targetWidth: Double, targetHeight: Double, codec: String, promise: Promise) {
    try {
      val source = File(sourcePath.removePrefix("file://"))
      if (!source.exists()) {
        promise.reject("ENOENT", "Source video does not exist: ${source.absolutePath}")
        return
      }

      val target = File(
          reactContext.cacheDir,
          "DualViewCamera_${safeSuffix(suffix)}_${safeVariant(variant)}_${System.currentTimeMillis()}.mp4"
      )
      
      val targetSpec = videoTargetSpec(variant, targetWidth, targetHeight)
      val targetCodec = videoCodecMimeType(codec)
      if (isSourceCompatibleWithTarget(source, targetSpec, targetCodec)) {
        promise.resolve(source.absolutePath)
        return
      }

      val videoEffects = mutableListOf<Effect>()
      videoEffects.add(
          Presentation.createForWidthAndHeight(
              targetSpec.width,
              targetSpec.height,
              Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP
          )
      )

      val editedMediaItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(source)))
          .setEffects(Effects(emptyList(), videoEffects))
          .build()
      
      val transformerId = UUID.randomUUID().toString()
      val listener = object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          activeTransformers.remove(transformerId)
          promise.resolve(target.absolutePath)
        }

        override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException
        ) {
          activeTransformers.remove(transformerId)
          try {
            copyFile(source, target)
            promise.resolve(target.absolutePath)
          } catch (_: Throwable) {
            promise.reject("EVIDEO", exportException.message, exportException)
          }
        }
      }
      val transformer = Transformer.Builder(reactContext)
          .setVideoMimeType(targetCodec)
          .setAudioMimeType(MimeTypes.AUDIO_AAC)
          .addListener(listener)
          .build()
      activeTransformers.put(transformerId, transformer)
      transformer.start(editedMediaItem, target.absolutePath)
    } catch (error: Throwable) {
      promise.reject("EVIDEO", error.message, error)
    }
  }

  private data class VideoTargetSpec(val width: Int, val height: Int)

  private fun photoAspectForVariant(variant: String): Double {
    return when (variant) {
      "landscape", "video16x9" -> 16.0 / 9.0
      "square" -> 1.0
      "photo4x3", "portrait" -> 3.0 / 4.0
      else -> 3.0 / 4.0
    }
  }

  private fun videoTargetSpec(variant: String, targetWidth: Double, targetHeight: Double): VideoTargetSpec {
    val fallback = if (variant == "landscape" || variant == "video16x9") {
      VideoTargetSpec(1280, 720)
    } else {
      VideoTargetSpec(1080, 1440)
    }
    val width = targetWidth.roundToInt().coerceAtLeast(1)
    val height = targetHeight.roundToInt().coerceAtLeast(1)
    return if (width > 1 && height > 1) VideoTargetSpec(width, height) else fallback
  }

  private fun copyFile(source: File, target: File) {
    source.inputStream().use { input ->
      FileOutputStream(target).use { output -> input.copyTo(output) }
    }
  }

  private fun isSourceCompatibleWithTarget(source: File, targetSpec: VideoTargetSpec, targetMimeType: String): Boolean {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(source.absolutePath)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toDoubleOrNull() ?: return false
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toDoubleOrNull() ?: return false
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      if (width <= 0.0 || height <= 0.0) return false

      val displayWidth = if (rotation == 90 || rotation == 270) height else width
      val displayHeight = if (rotation == 90 || rotation == 270) width else height
      val sourceAspect = displayWidth / displayHeight
      val targetAspect = targetSpec.width.toDouble() / targetSpec.height.toDouble()
      val sourceMimeType = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
      kotlin.math.abs(sourceAspect - targetAspect) < 0.015 && sourceMimeType == targetMimeType
    } catch (_: Throwable) {
      false
    } finally {
      try {
        retriever.release()
      } catch (_: Throwable) {
      }
    }
  }

  private fun applyExifOrientation(source: Bitmap, path: String): Bitmap {
    val orientation = try {
      ExifInterface(path).getAttributeInt(
          ExifInterface.TAG_ORIENTATION,
          ExifInterface.ORIENTATION_NORMAL
      )
    } catch (_: IOException) {
      ExifInterface.ORIENTATION_NORMAL
    }

    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.preScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.preScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.preScale(-1f, 1f)
        matrix.postRotate(90f)
      }
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.preScale(-1f, 1f)
        matrix.postRotate(270f)
      }
      else -> return source
    }

    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
  }

  private fun centerCrop(source: Bitmap, targetAspect: Double): Bitmap {
    val sourceWidth = source.width
    val sourceHeight = source.height
    val sourceAspect = sourceWidth.toDouble() / sourceHeight.toDouble()

    val cropWidth: Int
    val cropHeight: Int
    if (sourceAspect > targetAspect) {
      cropHeight = sourceHeight
      cropWidth = (sourceHeight * targetAspect).roundToInt().coerceAtMost(sourceWidth)
    } else {
      cropWidth = sourceWidth
      cropHeight = (sourceWidth / targetAspect).roundToInt().coerceAtMost(sourceHeight)
    }

    val left = ((sourceWidth - cropWidth) / 2).coerceAtLeast(0)
    val top = ((sourceHeight - cropHeight) / 2).coerceAtLeast(0)
    return Bitmap.createBitmap(source, left, top, cropWidth, cropHeight)
  }

  private fun safeSuffix(value: String): String {
    return value.replace(Regex("[^A-Za-z0-9_-]+"), "_").ifBlank { "media" }
  }

  private fun safeVariant(value: String): String {
    return when (value) {
      "portrait", "landscape", "full", "square", "photo4x3", "video16x9" -> value
      else -> "media"
    }
  }

  private fun shouldWriteHeif(format: String): Boolean {
    return format == "heic" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
  }

  private fun writeHeif(bitmap: Bitmap, target: File) {
    val writer = HeifWriter.Builder(
        target.absolutePath,
        bitmap.width,
        bitmap.height,
        HeifWriter.INPUT_MODE_BITMAP
    )
        .setQuality(94)
        .build()
    try {
      writer.start()
      writer.addBitmap(bitmap)
      writer.stop(0)
    } finally {
      try {
        writer.close()
      } catch (_: Throwable) {
      }
    }
  }

  private fun videoCodecMimeType(codec: String): String {
    return if (codec == "h264") MimeTypes.VIDEO_H264 else MimeTypes.VIDEO_H265
  }
}
