package com.dualviewcamerav1init

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class SharedTextureViewManager : SimpleViewManager<SharedTextureView>() {
    override fun getName(): String = "SharedTextureView"

    override fun createViewInstance(reactContext: ThemedReactContext): SharedTextureView {
        return SharedTextureView(reactContext)
    }
}

class SharedTextureView(context: Context) : FrameLayout(context) {
    // This is a placeholder for a more advanced native implementation.
    // For now, it will act as a container that we can use to overlay or mirror.
    // In a full implementation, this would use OpenGL to draw the shared SurfaceTexture.
    init {
        setBackgroundColor(0xFF111111.toInt())
    }
}
