package com.dualviewcamerav1init

import com.dualviewcamerav1init.concurrent.ConcurrentCameraModule
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DualViewCameraPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(DualViewMediaModule(reactContext), ConcurrentCameraModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
      return listOf(
          SharedTextureViewManager(),
          DualViewVideoViewManager(),
      )
  }

}
