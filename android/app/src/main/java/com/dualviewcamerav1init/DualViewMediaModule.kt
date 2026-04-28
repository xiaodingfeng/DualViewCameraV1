package com.dualviewcamerav1init

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import androidx.heifwriter.HeifWriter
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.Presentation
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
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
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

class DualViewMediaModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private val activeTransformers = ConcurrentHashMap<String, Transformer>()
  private val videoTransformQueue = ArrayDeque<VideoTransformTask>()
  private val videoTransformQueueLock = Any()
  private var activeVideoTransformTask: VideoTransformTask? = null

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
  fun deleteMedia(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      if (uri.scheme == "file" || uri.scheme.isNullOrBlank()) {
        val path = uri.path ?: uriString.removePrefix("file://")
        val file = File(path)
        promise.resolve(!file.exists() || file.delete())
        return
      }

      val deletedRows = reactContext.contentResolver.delete(uri, null, null)
      promise.resolve(deletedRows > 0)
    } catch (error: Throwable) {
      promise.reject("EDELETE", error.message, error)
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
    createPhotoVariantInternal(sourcePath, photoAspectForVariant(variant), safeVariant(variant), suffix, "jpeg", 94, promise)
  }

  @ReactMethod
  fun createPhotoVariantWithAspect(sourcePath: String, suffix: String, aspectWidth: Double, aspectHeight: Double, promise: Promise) {
    createPhotoVariantWithAspectAndFormat(sourcePath, suffix, aspectWidth, aspectHeight, "jpeg", promise)
  }

  @ReactMethod
  fun createPhotoVariantWithAspectAndFormat(sourcePath: String, suffix: String, aspectWidth: Double, aspectHeight: Double, format: String, promise: Promise) {
    createPhotoVariantWithAspectFormatQuality(sourcePath, suffix, aspectWidth, aspectHeight, format, 94.0, promise)
  }

  @ReactMethod
  fun createPhotoVariantWithAspectFormatQuality(sourcePath: String, suffix: String, aspectWidth: Double, aspectHeight: Double, format: String, quality: Double, promise: Promise) {
    createPhotoVariantWithAspectFormatQualityAndMirror(sourcePath, suffix, aspectWidth, aspectHeight, format, quality, false, promise)
  }

  @ReactMethod
  fun createPhotoVariantWithAspectFormatQualityAndMirror(sourcePath: String, suffix: String, aspectWidth: Double, aspectHeight: Double, format: String, quality: Double, mirror: Boolean, promise: Promise) {
    createPhotoVariantWithAspectFormatQualityMirrorAndRotate(sourcePath, suffix, aspectWidth, aspectHeight, format, quality, mirror, false, promise)
  }

  @ReactMethod
  fun createPhotoVariantWithAspectFormatQualityMirrorAndRotate(sourcePath: String, suffix: String, aspectWidth: Double, aspectHeight: Double, format: String, quality: Double, mirror: Boolean, rotateLandscapeFallback: Boolean, promise: Promise) {
    val width = aspectWidth.coerceAtLeast(1.0)
    val height = aspectHeight.coerceAtLeast(1.0)
    createPhotoVariantInternal(sourcePath, width / height, "wysiwyg", suffix, format, safeQuality(quality), promise, mirror, rotateLandscapeFallback)
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
    createDualPhotoVariantsWithAspectsFormatQuality(
        sourcePath,
        mainSuffix,
        mainAspectWidth,
        mainAspectHeight,
        subSuffix,
        subAspectWidth,
        subAspectHeight,
        format,
        94.0,
        promise
    )
  }

  @ReactMethod
  fun createDualPhotoVariantsWithAspectsFormatQuality(
      sourcePath: String,
      mainSuffix: String,
      mainAspectWidth: Double,
      mainAspectHeight: Double,
      subSuffix: String,
      subAspectWidth: Double,
      subAspectHeight: Double,
      format: String,
      quality: Double,
      promise: Promise
  ) {
    createDualPhotoVariantsWithAspectsFormatQualityAndMirror(
        sourcePath,
        mainSuffix,
        mainAspectWidth,
        mainAspectHeight,
        subSuffix,
        subAspectWidth,
        subAspectHeight,
        format,
        quality,
        false,
        promise
    )
  }

  @ReactMethod
  fun createDualPhotoVariantsWithAspectsFormatQualityAndMirror(
      sourcePath: String,
      mainSuffix: String,
      mainAspectWidth: Double,
      mainAspectHeight: Double,
      subSuffix: String,
      subAspectWidth: Double,
      subAspectHeight: Double,
      format: String,
      quality: Double,
      mirror: Boolean,
      promise: Promise
  ) {
    createDualPhotoVariantsWithAspectsFormatQualityMirrorAndRotate(
        sourcePath,
        mainSuffix,
        mainAspectWidth,
        mainAspectHeight,
        subSuffix,
        subAspectWidth,
        subAspectHeight,
        format,
        quality,
        mirror,
        false,
        false,
        promise
    )
  }

  @ReactMethod
  fun createDualPhotoVariantsWithAspectsFormatQualityMirrorAndRotate(
      sourcePath: String,
      mainSuffix: String,
      mainAspectWidth: Double,
      mainAspectHeight: Double,
      subSuffix: String,
      subAspectWidth: Double,
      subAspectHeight: Double,
      format: String,
      quality: Double,
      mirror: Boolean,
      mainRotateLandscapeFallback: Boolean,
      subRotateLandscapeFallback: Boolean,
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
          format,
          safeQuality(quality),
          mirror,
          mainRotateLandscapeFallback,
          source.absolutePath
      )
      val subTarget = writePhotoVariant(
          upright,
          subAspectWidth.coerceAtLeast(1.0) / subAspectHeight.coerceAtLeast(1.0),
          "sub",
          subSuffix,
          format,
          safeQuality(quality),
          mirror,
          subRotateLandscapeFallback,
          source.absolutePath
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

  @ReactMethod
  fun createWatermarkedCover(
      sourcePath: String,
      suffix: String,
      title: String,
      dateText: String,
      infoText: String,
      templateId: String,
      promise: Promise
  ) {
    try {
      val source = File(sourcePath.removePrefix("file://"))
      if (!source.exists()) {
        promise.reject("ENOENT", "Source cover photo does not exist: ${source.absolutePath}")
        return
      }

      val decoded = BitmapFactory.decodeFile(source.absolutePath)
      if (decoded == null) {
        promise.reject("EDECODE", "Unable to decode source cover photo: ${source.absolutePath}")
        return
      }

      val upright = applyExifOrientation(decoded, source.absolutePath)
      val cover = drawCoverBitmap(upright, title, dateText, infoText, templateId)
      val target = File(
          reactContext.cacheDir,
          "DualViewCamera_cover_${safeSuffix(suffix)}_${safeSuffix(templateId)}_${System.currentTimeMillis()}.jpg"
      )
      FileOutputStream(target).use { output ->
        cover.compress(Bitmap.CompressFormat.JPEG, 94, output)
      }
      copyExifLocation(source.absolutePath, target.absolutePath)

      if (decoded !== upright) decoded.recycle()
      upright.recycle()
      cover.recycle()

      promise.resolve(target.absolutePath)
    } catch (error: Throwable) {
      promise.reject("ECOVER", error.message, error)
    }
  }

  private fun createPhotoVariantInternal(sourcePath: String, targetAspect: Double, variantLabel: String, suffix: String, format: String, quality: Int = 94, promise: Promise, mirror: Boolean = false, rotateLandscapeFallback: Boolean = false) {
    try {
      val source = File(sourcePath.removePrefix("file://"))
      if (!source.exists()) {
        promise.reject("ENOENT", "Source photo does not exist: ${source.absolutePath}")
        return
      }

      val options = BitmapFactory.Options().apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          inPreferredColorSpace = android.graphics.ColorSpace.get(android.graphics.ColorSpace.Named.SRGB)
        }
      }
      val decoded = BitmapFactory.decodeFile(source.absolutePath, options)
      if (decoded == null) {
        promise.reject("EDECODE", "Unable to decode source photo: ${source.absolutePath}")
        return
      }

      val upright = applyExifOrientation(decoded, source.absolutePath)
      val target = writePhotoVariant(upright, targetAspect, variantLabel, suffix, format, quality, mirror, rotateLandscapeFallback, source.absolutePath)

      if (decoded !== upright) decoded.recycle()
      upright.recycle()

      promise.resolve(target.absolutePath)
    } catch (error: Throwable) {
      promise.reject("ECROP", error.message, error)
    }
  }

  private fun writePhotoVariant(source: Bitmap, targetAspect: Double, variantLabel: String, suffix: String, format: String, quality: Int = 94, mirror: Boolean = false, rotateLandscapeFallback: Boolean = false, sourceLocationPath: String? = null): File {
    val oriented = orientBitmapForTargetAspect(source, targetAspect, rotateLandscapeFallback)
    val cropped = centerCrop(oriented, targetAspect)
    val outputBitmap = if (mirror) mirrorBitmap(cropped) else cropped
    val useHeif = shouldWriteHeif(format)
    val target = File(
        reactContext.cacheDir,
        "DualViewCamera_${safeSuffix(suffix)}_${variantLabel}_${System.currentTimeMillis()}.${if (useHeif) "heic" else "jpg"}"
    )
    if (useHeif) {
      writeHeif(outputBitmap, target, quality)
    } else {
      FileOutputStream(target).use { output ->
        outputBitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)
      }
    }
    if (outputBitmap !== cropped) outputBitmap.recycle()
    if (oriented !== cropped) cropped.recycle()
    if (oriented !== source && oriented !== cropped) oriented.recycle()
    copyExifLocation(sourceLocationPath, target.absolutePath)
    return target
  }

  @ReactMethod
  fun createVideoVariant(sourcePath: String, variant: String, suffix: String, targetWidth: Double, targetHeight: Double, codec: String, promise: Promise) {
    createVideoVariantWithMirror(sourcePath, variant, suffix, targetWidth, targetHeight, codec, false, promise)
  }

  @ReactMethod
  fun createVideoVariantWithMirror(sourcePath: String, variant: String, suffix: String, targetWidth: Double, targetHeight: Double, codec: String, mirror: Boolean, promise: Promise) {
    createVideoVariantWithMirrorAndRotate(sourcePath, variant, suffix, targetWidth, targetHeight, codec, mirror, false, promise)
  }

  @ReactMethod
  fun createVideoVariantWithMirrorAndRotate(sourcePath: String, variant: String, suffix: String, targetWidth: Double, targetHeight: Double, codec: String, mirror: Boolean, rotateLandscapeFallback: Boolean, promise: Promise) {
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
      if (!mirror && !rotateLandscapeFallback && isSourceCompatibleWithTarget(source, targetSpec, targetCodec)) {
        promise.resolve(source.absolutePath)
        return
      }

      enqueueVideoTransform(
          VideoTransformTask(
              source = source,
              target = target,
              targetSpec = targetSpec,
              targetCodec = targetCodec,
              mirror = mirror,
              rotateLandscapeFallback = rotateLandscapeFallback,
              promise = promise
          )
      )
    } catch (error: Throwable) {
      promise.reject("EVIDEO", error.message, error)
    }
  }

  @ReactMethod
  fun createConcurrentCompositePhotoWithPip(
      mainPath: String,
      subPath: String,
      suffix: String,
      layout: String,
      pipLeftRatio: Double,
      pipTopRatio: Double,
      pipScale: String,
      isPortrait: Boolean,
      format: String,
      quality: Double,
      promise: Promise
  ) {
    try {
      val mainSource = File(mainPath.removePrefix("file://"))
      val subSource = File(subPath.removePrefix("file://"))
      if (!mainSource.exists()) {
        promise.reject("ENOENT", "Main photo does not exist: ${mainSource.absolutePath}")
        return
      }
      if (!subSource.exists()) {
        promise.reject("ENOENT", "Sub photo does not exist: ${subSource.absolutePath}")
        return
      }

      val options = BitmapFactory.Options().apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          inPreferredColorSpace = android.graphics.ColorSpace.get(android.graphics.ColorSpace.Named.SRGB)
        }
      }
      val mainDecoded = BitmapFactory.decodeFile(mainSource.absolutePath, options)
      val subDecoded = BitmapFactory.decodeFile(subSource.absolutePath, options)
      if (mainDecoded == null || subDecoded == null) {
        mainDecoded?.recycle()
        subDecoded?.recycle()
        promise.reject("EDECODE", "Unable to decode concurrent photos")
        return
      }

      val mainUpright = applyExifOrientation(mainDecoded, mainSource.absolutePath)
      val subUpright = applyExifOrientation(subDecoded, subSource.absolutePath)
      val rects = concurrentCompositeRectsWithPip(layout, pipLeftRatio, pipTopRatio, pipScale, isPortrait)
      val target = Bitmap.createBitmap(rects.width, rects.height, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(target)
      canvas.drawColor(Color.BLACK)
      drawCenterCrop(canvas, mainUpright, rects.main)
      drawCenterCrop(canvas, subUpright, rects.sub)

      val useHeif = shouldWriteHeif(format)
      val output = File(
          reactContext.cacheDir,
          "DualViewCamera_${safeSuffix(suffix)}_${safeSuffix(layout)}_${System.currentTimeMillis()}.${if (useHeif) "heic" else "jpg"}"
      )
      val safeQuality = safeQuality(quality)
      if (useHeif) {
        writeHeif(target, output, safeQuality)
      } else {
        FileOutputStream(output).use { stream ->
          target.compress(Bitmap.CompressFormat.JPEG, safeQuality, stream)
        }
      }
      copyExifLocation(mainSource.absolutePath, output.absolutePath)

      if (mainDecoded !== mainUpright) mainDecoded.recycle()
      if (subDecoded !== subUpright) subDecoded.recycle()
      mainUpright.recycle()
      subUpright.recycle()
      target.recycle()

      promise.resolve(output.absolutePath)
    } catch (error: Throwable) {
      promise.reject("ECOMPOSITE_PHOTO", error.message, error)
    }
  }

  @ReactMethod
  fun createConcurrentCompositeVideoWithPip(
      mainPath: String,
      subPath: String,
      suffix: String,
      layout: String,
      pipLeftRatio: Double,
      pipTopRatio: Double,
      pipScale: String,
      isPortrait: Boolean,
      codec: String,
      promise: Promise
  ) {
    try {
      val mainSource = File(mainPath.removePrefix("file://"))
      val subSource = File(subPath.removePrefix("file://"))
      if (!mainSource.exists()) {
        promise.reject("ENOENT", "Main video does not exist: ${mainSource.absolutePath}")
        return
      }
      if (!subSource.exists()) {
        promise.reject("ENOENT", "Sub video does not exist: ${subSource.absolutePath}")
        return
      }

      val target = File(
          reactContext.cacheDir,
          "DualViewCamera_${safeSuffix(suffix)}_${safeSuffix(layout)}_${System.currentTimeMillis()}.mp4"
      )
      startConcurrentCompositeVideoTransform(
          mainSource,
          subSource,
          target,
          concurrentCompositeRectsWithPip(layout, pipLeftRatio, pipTopRatio, pipScale, isPortrait),
          videoCodecMimeType(codec),
          promise
      )
    } catch (error: Throwable) {
      promise.reject("ECOMPOSITE_VIDEO", error.message, error)
    }
  }

  private fun enqueueVideoTransform(task: VideoTransformTask) {
    synchronized(videoTransformQueueLock) {
      videoTransformQueue.add(task)
      if (activeVideoTransformTask != null) return
    }
    processNextVideoTransform()
  }

  private fun processNextVideoTransform() {
    val nextTask = synchronized(videoTransformQueueLock) {
      if (activeVideoTransformTask != null || videoTransformQueue.isEmpty()) {
        null
      } else {
        videoTransformQueue.removeFirst().also { activeVideoTransformTask = it }
      }
    } ?: return

    startVideoTransform(nextTask)
  }

  private fun completeVideoTransform(task: VideoTransformTask) {
    synchronized(videoTransformQueueLock) {
      if (activeVideoTransformTask === task) {
        activeVideoTransformTask = null
      }
    }
    processNextVideoTransform()
  }

  private fun startVideoTransform(task: VideoTransformTask) {
    try {
      val videoEffects = mutableListOf<Effect>()
      if (task.mirror) {
        videoEffects.add(
            ScaleAndRotateTransformation.Builder()
                .setScale(-1f, 1f)
                .build()
        )
      }
      val sourceDisplaySpec = readVideoDisplaySpec(task.source)
      if (
          task.targetSpec.width > task.targetSpec.height &&
          task.rotateLandscapeFallback &&
          sourceDisplaySpec != null &&
          sourceDisplaySpec.height > sourceDisplaySpec.width
      ) {
        videoEffects.add(
            ScaleAndRotateTransformation.Builder()
                .setRotationDegrees(90f)
                .build()
        )
      }
      videoEffects.add(
          Presentation.createForWidthAndHeight(
              task.targetSpec.width,
              task.targetSpec.height,
              Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP
          )
      )

      val editedMediaItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(task.source)))
          .setEffects(Effects(emptyList(), videoEffects))
          .build()

      val transformerId = UUID.randomUUID().toString()
      val listener = object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          activeTransformers.remove(transformerId)
          task.promise.resolve(task.target.absolutePath)
          completeVideoTransform(task)
        }

        override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException
        ) {
          activeTransformers.remove(transformerId)
          try {
            copyFile(task.source, task.target)
            task.promise.resolve(task.target.absolutePath)
          } catch (_: Throwable) {
            task.promise.reject("EVIDEO", exportException.message, exportException)
          } finally {
            completeVideoTransform(task)
          }
        }
      }
      val transformer = Transformer.Builder(reactContext)
          .setVideoMimeType(task.targetCodec)
          .setAudioMimeType(MimeTypes.AUDIO_AAC)
          .addListener(listener)
          .build()
      activeTransformers.put(transformerId, transformer)
      transformer.start(editedMediaItem, task.target.absolutePath)
    } catch (error: Throwable) {
      task.promise.reject("EVIDEO", error.message, error)
      completeVideoTransform(task)
    }
  }

  private fun startConcurrentCompositeVideoTransform(
      mainSource: File,
      subSource: File,
      target: File,
      rects: CompositeRects,
      targetCodec: String,
      promise: Promise
  ) {
    try {
      val mainEffects = compositeVideoEffects(rects.main, rects.width, rects.height)
      val subEffects = compositeVideoEffects(rects.sub, rects.width, rects.height)
      val mainItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(mainSource)))
          .setEffects(Effects(emptyList(), mainEffects))
          .build()
      val subItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(subSource)))
          .setRemoveAudio(true)
          .setEffects(Effects(emptyList(), subEffects))
          .build()
      val mainSequence = EditedMediaItemSequence.Builder(
          setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO)
      )
          .addItem(mainItem)
          .build()
      val subSequence = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO))
          .addItem(subItem)
          .build()
      val composition = Composition.Builder(mainSequence, subSequence).build()

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
          promise.reject("ECOMPOSITE_VIDEO", exportException.message, exportException)
        }
      }
      val transformer = Transformer.Builder(reactContext)
          .setVideoMimeType(targetCodec)
          .setAudioMimeType(MimeTypes.AUDIO_AAC)
          .addListener(listener)
          .build()
      activeTransformers.put(transformerId, transformer)
      transformer.start(composition, target.absolutePath)
    } catch (error: Throwable) {
      promise.reject("ECOMPOSITE_VIDEO", error.message, error)
    }
  }

  private fun compositeVideoEffects(rect: RectF, width: Int, height: Int): List<Effect> {
    val scaleX = rect.width() / width.toFloat()
    val scaleY = rect.height() / height.toFloat()
    val translateX = ((rect.left + rect.right) / width.toFloat()) - 1f
    val translateY = 1f - ((rect.top + rect.bottom) / height.toFloat())
    return listOf(
        Presentation.createForWidthAndHeight(
            width,
            height,
            Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP
        ),
        MatrixTransformation { _ ->
          Matrix().apply {
            postScale(scaleX, scaleY)
            postTranslate(translateX, translateY)
          }
        }
    )
  }

  private fun concurrentCompositeRects(layout: String): CompositeRects {
      return concurrentCompositeRectsWithPip(layout, 0.5, 0.5, "medium", false)
  }

  private fun concurrentCompositeRectsWithPip(layout: String, pipLeftRatio: Double, pipTopRatio: Double, pipScale: String, isPortrait: Boolean): CompositeRects {
    val baseW = 1280
    val baseH = 720
    val width = if (isPortrait) baseH else baseW
    val height = if (isPortrait) baseW else baseH

    return when (layout) {
      "split-vertical" -> CompositeRects(
          width,
          height,
          RectF(0f, 0f, width.toFloat(), height * 0.5f),
          RectF(0f, height * 0.5f, width.toFloat(), height.toFloat())
      )
      "split-horizontal" -> CompositeRects(
          width,
          height,
          RectF(0f, 0f, width * 0.5f, height.toFloat()),
          RectF(width * 0.5f, 0f, width.toFloat(), height.toFloat())
      )
      "stack" -> {
        CompositeRects(
            width,
            height,
            RectF(0f, 0f, width.toFloat(), height * 0.75f),
            RectF(0f, height * 0.75f, width.toFloat(), height.toFloat())
        )
      }
      "pip" -> {
        val pipW = when(pipScale) {
            "small" -> 142f * 0.8f
            "large" -> 142f * 1.2f
            else -> 142f
        } * (width / (if (isPortrait) 360f else 640f))
        val pipH = when(pipScale) {
            "small" -> 190f * 0.8f
            "large" -> 190f * 1.2f
            else -> 190f
        } * (height / (if (isPortrait) 640f else 360f))

        val left = (pipLeftRatio * (width - pipW)).toFloat()
        val top = (pipTopRatio * (height - pipH)).toFloat()

        CompositeRects(
            width,
            height,
            RectF(0f, 0f, width.toFloat(), height.toFloat()),
            RectF(left, top, left + pipW, top + pipH)
        )
      }
      else -> CompositeRects(
          width,
          height,
          RectF(0f, 0f, width * 0.5f, height.toFloat()),
          RectF(width * 0.5f, 0f, width.toFloat(), height.toFloat())
      )
    }
  }

  private fun drawCoverBitmap(
      source: Bitmap,
      title: String,
      dateText: String,
      infoText: String,
      templateId: String
  ): Bitmap {
    val width = 1280
    val height = 720
    val target = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(target)
    val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    val cropped = centerCrop(source, width.toDouble() / height.toDouble())

    canvas.drawColor(Color.rgb(8, 10, 12))
    canvas.drawBitmap(cropped, null, RectF(0f, 0f, width.toFloat(), height.toFloat()), bitmapPaint)

    val accentPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = when (templateId) {
        "vlog-title" -> Color.rgb(255, 209, 102)
        "dual-card" -> Color.rgb(122, 162, 255)
        else -> Color.WHITE
      }
      strokeWidth = 6f
    }
    canvas.drawLine(54f, height - 154f, 150f, height - 154f, accentPaint)

    val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = 56f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      setShadowLayer(8f, 0f, 3f, Color.argb(180, 0, 0, 0))
    }
    val metaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(220, 255, 255, 255)
      textSize = 28f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
      setShadowLayer(6f, 0f, 2f, Color.argb(180, 0, 0, 0))
    }

    val displayTitle = title.ifBlank {
      if (templateId == "vlog-title") "VLOG" else "Dual View"
    }
    canvas.drawText(displayTitle.take(28), 54f, height - 96f, titlePaint)
    if (dateText.isNotBlank()) {
      canvas.drawText(dateText.take(24), 54f, height - 48f, metaPaint)
    }
    if (infoText.isNotBlank()) {
      val displayInfo = infoText.take(32)
      val textWidth = metaPaint.measureText(displayInfo)
      canvas.drawText(displayInfo, width - textWidth - 54f, height - 48f, metaPaint)
    }

    if (cropped !== source) cropped.recycle()
    return target
  }

  private fun orientBitmapForTargetAspect(source: Bitmap, targetAspect: Double, rotateLandscapeFallback: Boolean): Bitmap {
    val wantsLandscape = targetAspect > 1.0
    val sourceIsPortrait = source.height > source.width
    if (!rotateLandscapeFallback || !wantsLandscape || !sourceIsPortrait) return source

    val matrix = Matrix().apply {
      postRotate(90f)
    }
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
  }

  private fun mirrorBitmap(source: Bitmap): Bitmap {
    val matrix = Matrix().apply {
      preScale(-1f, 1f)
    }
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
  }

  private fun copyExifLocation(sourcePath: String?, targetPath: String) {
    if (sourcePath.isNullOrBlank()) return
    try {
      val latLong = ExifInterface(sourcePath).latLong ?: return
      ExifInterface(targetPath).apply {
        setLatLong(latLong[0], latLong[1])
        saveAttributes()
      }
    } catch (_: Throwable) {
    }
  }

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
    val displaySpec = readVideoDisplaySpec(source) ?: return false
    val sourceAspect = displaySpec.width / displaySpec.height
    val targetAspect = targetSpec.width.toDouble() / targetSpec.height.toDouble()
    return kotlin.math.abs(sourceAspect - targetAspect) < 0.015 && displaySpec.mimeType == targetMimeType
  }

  private fun readVideoDisplaySpec(source: File): VideoDisplaySpec? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(source.absolutePath)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toDoubleOrNull() ?: return null
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toDoubleOrNull() ?: return null
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      if (width <= 0.0 || height <= 0.0) return null

      val displayWidth = if (rotation == 90 || rotation == 270) height else width
      val displayHeight = if (rotation == 90 || rotation == 270) width else height
      val sourceMimeType = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
      VideoDisplaySpec(displayWidth, displayHeight, sourceMimeType)
    } catch (_: Throwable) {
      null
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

  private fun drawCenterCrop(canvas: Canvas, source: Bitmap, targetRect: RectF) {
    val sourceAspect = source.width.toDouble() / source.height.toDouble()
    val targetAspect = targetRect.width().toDouble() / targetRect.height().toDouble()
    val srcRect = if (sourceAspect > targetAspect) {
      val cropWidth = (source.height * targetAspect).roundToInt().coerceAtMost(source.width)
      val left = ((source.width - cropWidth) / 2).coerceAtLeast(0)
      Rect(left, 0, left + cropWidth, source.height)
    } else {
      val cropHeight = (source.width / targetAspect).roundToInt().coerceAtMost(source.height)
      val top = ((source.height - cropHeight) / 2).coerceAtLeast(0)
      Rect(0, top, source.width, top + cropHeight)
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    canvas.drawBitmap(source, srcRect, targetRect, paint)
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

  private fun safeQuality(quality: Double): Int {
    return quality.roundToInt().coerceIn(70, 100)
  }

  private fun writeHeif(bitmap: Bitmap, target: File, quality: Int = 94) {
    val writer = HeifWriter.Builder(
        target.absolutePath,
        bitmap.width,
        bitmap.height,
        HeifWriter.INPUT_MODE_BITMAP
    )
        .setQuality(quality)
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

  private data class VideoTransformTask(
      val source: File,
      val target: File,
      val targetSpec: VideoTargetSpec,
      val targetCodec: String,
      val mirror: Boolean,
      val rotateLandscapeFallback: Boolean,
      val promise: Promise
  )

  private data class VideoTargetSpec(val width: Int, val height: Int)
  private data class VideoDisplaySpec(val width: Double, val height: Double, val mimeType: String?)
  private data class CompositeRects(val width: Int, val height: Int, val main: RectF, val sub: RectF)
}
