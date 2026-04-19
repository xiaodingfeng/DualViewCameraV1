package com.dualviewcamerav1init

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
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
  fun createPhotoVariant(sourcePath: String, variant: String, suffix: String, promise: Promise) {
    createPhotoVariantInternal(sourcePath, photoAspectForVariant(variant), safeVariant(variant), suffix, promise)
  }

  @ReactMethod
  fun createPhotoVariantWithAspect(sourcePath: String, suffix: String, aspectWidth: Double, aspectHeight: Double, promise: Promise) {
    val width = aspectWidth.coerceAtLeast(1.0)
    val height = aspectHeight.coerceAtLeast(1.0)
    createPhotoVariantInternal(sourcePath, width / height, "wysiwyg", suffix, promise)
  }

  private fun createPhotoVariantInternal(sourcePath: String, targetAspect: Double, variantLabel: String, suffix: String, promise: Promise) {
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
      val cropped = centerCrop(upright, targetAspect)

      val target = File(
          reactContext.cacheDir,
          "DualViewCamera_${safeSuffix(suffix)}_${variantLabel}_${System.currentTimeMillis()}.jpg"
      )
      FileOutputStream(target).use { output ->
        cropped.compress(Bitmap.CompressFormat.JPEG, 94, output)
      }

      if (decoded !== upright) decoded.recycle()
      if (upright !== cropped) upright.recycle()
      cropped.recycle()

      promise.resolve(target.absolutePath)
    } catch (error: Throwable) {
      promise.reject("ECROP", error.message, error)
    }
  }

  @ReactMethod
  fun createVideoVariant(sourcePath: String, variant: String, suffix: String, targetWidth: Double, targetHeight: Double, promise: Promise) {
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
          .setVideoMimeType(MimeTypes.VIDEO_H264)
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
}
