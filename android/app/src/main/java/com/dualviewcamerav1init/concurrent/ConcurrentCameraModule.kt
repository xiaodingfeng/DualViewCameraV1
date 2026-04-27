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
      val cameraManager = reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val cameras = availableCameras(cameraManager)
      val hasConcurrentFeature = reactContext.packageManager
        .hasSystemFeature(PackageManager.FEATURE_CAMERA_CONCURRENT)

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        promise.resolve(
          capability(false, "api-too-low", hasConcurrentFeature, cameras, WritableNativeArray())
        )
        return
      }

      if (!hasConcurrentFeature) {
        promise.resolve(
          capability(false, "feature-missing", hasConcurrentFeature, cameras, WritableNativeArray())
        )
        return
      }

      val pairs = frontBackConcurrentPairs(cameraManager)

      if (pairs.size() == 0) {
        promise.resolve(
          capability(false, "no-front-back-pairs", hasConcurrentFeature, cameras, pairs)
        )
        return
      }

      promise.resolve(capability(true, null, hasConcurrentFeature, cameras, pairs))
    } catch (_: Throwable) {
      promise.resolve(
        capability(false, "unknown-error", false, WritableNativeArray(), WritableNativeArray())
      )
    }
  }

  private fun frontBackConcurrentPairs(cameraManager: CameraManager): WritableNativeArray {
    val pairs = WritableNativeArray()

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      return pairs
    }

    cameraManager.concurrentCameraIds.forEachIndexed { index, cameraIds ->
      val cameras = cameraIds
        .toList()
        .distinct()
        .map { cameraId -> cameraId to facingForCamera(cameraManager, cameraId) }

      val back = cameras.firstOrNull { (_, facing) -> facing == "back" }
      val front = cameras.firstOrNull { (_, facing) -> facing == "front" }

      // VisionCamera 的 multi-cam 页面以 frontDevice + backDevice 为基础。
      // 这里不要把 back+back、external+back 等系统并发组合暴露给 JS，
      // 否则 JS 侧会误以为“前后摄真双摄”可用，但 session.configure 会失败。
      if (back == null || front == null) {
        return@forEachIndexed
      }

      val supportedUseCases = WritableNativeArray().apply {
        pushString("preview")
        pushString("photo")
        pushString("video")
      }

      val pair = WritableNativeMap().apply {
        putString("id", "front_back_${index}_${back.first}_${front.first}")
        putString("primaryCameraId", back.first)
        putString("secondaryCameraId", front.first)
        putString("primaryFacing", back.second)
        putString("secondaryFacing", front.second)
        putArray("supportedUseCases", supportedUseCases)
        // 当前 JS 路径只保存前/后两路原始文件；合成输出尚未在 multi-cam session 中实现。
        putBoolean("supportsCompositionSettings", false)
      }

      pairs.pushMap(pair)
    }

    return pairs
  }

  private fun availableCameras(cameraManager: CameraManager): WritableNativeArray {
    return WritableNativeArray().apply {
      cameraManager.cameraIdList.sorted().forEach { cameraId ->
        val camera = WritableNativeMap().apply {
          putString("id", cameraId)
          putString("facing", facingForCamera(cameraManager, cameraId))
        }
        pushMap(camera)
      }
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
    hasConcurrentFeature: Boolean,
    cameras: WritableNativeArray,
    pairs: WritableNativeArray
  ): WritableNativeMap {
    return WritableNativeMap().apply {
      putBoolean("supported", supported)
      putInt("androidApiLevel", Build.VERSION.SDK_INT)
      putBoolean("hasConcurrentFeature", hasConcurrentFeature)
      if (reason != null) putString("reason", reason)
      putArray("cameras", cameras)
      putArray("pairs", pairs)
    }
  }
}
