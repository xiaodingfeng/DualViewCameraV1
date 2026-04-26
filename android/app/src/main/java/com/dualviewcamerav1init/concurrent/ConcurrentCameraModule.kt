package com.dualviewcamerav1init.concurrent

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap

class ConcurrentCameraModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ConcurrentCameraModule"

  @ReactMethod
  fun getConcurrentCameraCapability(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        promise.resolve(capability(false, "api-too-low", WritableNativeArray()))
        return
      }

      val packageManager = reactContext.packageManager
      if (!packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_CONCURRENT)) {
        promise.resolve(capability(false, "feature-missing", WritableNativeArray()))
        return
      }

      val cameraManager = reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val pairs = WritableNativeArray()
      cameraManager.concurrentCameraIds.forEachIndexed { index, cameraIds ->
        val ids = cameraIds.toList().sorted()
        if (ids.size >= 2) {
          val primaryId = ids[0]
          val secondaryId = ids[1]
          val pair = WritableNativeMap()
          pair.putString("id", "concurrent_${index}_${primaryId}_${secondaryId}")
          pair.putString("primaryCameraId", primaryId)
          pair.putString("secondaryCameraId", secondaryId)
          pair.putString("primaryFacing", facingForCamera(cameraManager, primaryId))
          pair.putString("secondaryFacing", facingForCamera(cameraManager, secondaryId))
          pair.putArray("supportedUseCases", WritableNativeArray().apply {
            pushString("preview")
          })
          pair.putBoolean("supportsCompositionSettings", false)
          pairs.pushMap(pair)
        }
      }

      if (pairs.size() == 0) {
        promise.resolve(capability(false, "no-camera-pairs", pairs))
        return
      }
      promise.resolve(capability(true, null, pairs))
    } catch (error: Throwable) {
      promise.resolve(capability(false, "unknown-error", WritableNativeArray()))
    }
  }

  private fun facingForCamera(cameraManager: CameraManager, cameraId: String): String {
    return try {
      when (cameraManager.getCameraCharacteristics(cameraId)
          .get(CameraCharacteristics.LENS_FACING)) {
        CameraCharacteristics.LENS_FACING_FRONT -> "front"
        CameraCharacteristics.LENS_FACING_BACK -> "back"
        CameraCharacteristics.LENS_FACING_EXTERNAL -> "external"
        else -> "unknown"
      }
    } catch (_: Throwable) {
      "unknown"
    }
  }

  private fun capability(
      supported: Boolean,
      reason: String?,
      pairs: WritableNativeArray
  ): WritableNativeMap {
    return WritableNativeMap().apply {
      putBoolean("supported", supported)
      if (reason != null) putString("reason", reason)
      putArray("pairs", pairs)
    }
  }
}
