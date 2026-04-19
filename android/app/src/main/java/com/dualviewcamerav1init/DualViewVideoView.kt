package com.dualviewcamerav1init

import android.graphics.Color
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class DualViewVideoViewManager : SimpleViewManager<DualViewVideoView>() {
  override fun getName(): String = "DualViewVideoView"

  override fun createViewInstance(reactContext: ThemedReactContext): DualViewVideoView {
    return DualViewVideoView(reactContext)
  }

  @ReactProp(name = "sourceUri")
  fun setSourceUri(view: DualViewVideoView, sourceUri: String?) {
    view.setSourceUri(sourceUri)
  }

  override fun onDropViewInstance(view: DualViewVideoView) {
    view.release()
    super.onDropViewInstance(view)
  }
}

class DualViewVideoView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {
  private val textureView = TextureView(reactContext)
  private val controls = LinearLayout(reactContext)
  private val playButton = TextView(reactContext)
  private val progress = SeekBar(reactContext)
  private val timeText = TextView(reactContext)
  private val uiHandler = Handler(Looper.getMainLooper())
  private var mediaPlayer: MediaPlayer? = null
  private var surface: Surface? = null
  private var sourceUri: String? = null
  private var isSurfaceReady = false
  private var isSeeking = false
  private var videoWidth = 0
  private var videoHeight = 0
  private var fitScaleX = 1f
  private var fitScaleY = 1f
  private var userScale = 1f
  private var translateX = 0f
  private var translateY = 0f
  private var baseUserScale = 1f
  private var baseTranslateX = 0f
  private var baseTranslateY = 0f
  private var startDistance = 0f
  private var startCenterX = 0f
  private var startCenterY = 0f
  private var panStartX = 0f
  private var panStartY = 0f
  private var isPanning = false
  private var isScaling = false
  private val progressTick = object : Runnable {
    override fun run() {
      updateProgress()
      uiHandler.postDelayed(this, 250)
    }
  }

  init {
    setBackgroundColor(Color.BLACK)
    textureView.layoutParams = LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
    )
    textureView.setOnTouchListener { _, event ->
      handleVideoTouch(event)
      true
    }
    textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        isSurfaceReady = true
        surface = Surface(surfaceTexture)
        preparePlayer()
      }

      override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) = Unit

      override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        isSurfaceReady = false
        releasePlayer()
        surface?.release()
        surface = null
        return true
      }

      override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) = Unit
    }
    setOnClickListener {
      val player = mediaPlayer ?: return@setOnClickListener
      togglePlayback(player)
    }
    addView(textureView)

    controls.orientation = LinearLayout.HORIZONTAL
    controls.setPadding(dp(14), dp(8), dp(14), dp(8))
    controls.setBackgroundColor(Color.TRANSPARENT)
    controls.gravity = android.view.Gravity.CENTER_VERTICAL
    controls.layoutParams = LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        android.view.Gravity.BOTTOM
    ).apply {
      bottomMargin = dp(88)
    }

    playButton.setTextColor(Color.WHITE)
    playButton.textSize = 24f
    playButton.gravity = android.view.Gravity.CENTER
    updatePlayIcon(true)
    playButton.setOnClickListener {
      mediaPlayer?.let { player -> togglePlayback(player) }
    }
    controls.addView(playButton, LinearLayout.LayoutParams(dp(52), dp(52)))

    progress.max = 1000
    progress.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
      override fun onProgressChanged(seekBar: SeekBar?, progressValue: Int, fromUser: Boolean) {
        if (fromUser) updateTimeText(progressValue)
      }

      override fun onStartTrackingTouch(seekBar: SeekBar?) {
        isSeeking = true
      }

      override fun onStopTrackingTouch(seekBar: SeekBar?) {
        val player = mediaPlayer
        val value = seekBar?.progress ?: 0
        if (player != null && player.duration > 0) {
          player.seekTo((player.duration * (value / 1000f)).toInt())
        }
        isSeeking = false
        updateProgress()
      }
    })
    controls.addView(progress, LinearLayout.LayoutParams(0, dp(52), 1f))

    timeText.setTextColor(Color.WHITE)
    timeText.textSize = 12f
    timeText.text = "00:00"
    timeText.gravity = android.view.Gravity.CENTER
    controls.addView(timeText, LinearLayout.LayoutParams(dp(102), dp(52)))
    addView(controls)
  }

  fun setSourceUri(nextSourceUri: String?) {
    if (sourceUri == nextSourceUri) return
    sourceUri = nextSourceUri
    releasePlayer()
    preparePlayer()
  }

  private fun preparePlayer() {
    val uri = sourceUri
    val outputSurface = surface
    if (!isSurfaceReady || uri.isNullOrBlank() || outputSurface == null) return
    try {
      val player = MediaPlayer()
      player.setDataSource(reactContext, Uri.parse(uri))
      player.setSurface(outputSurface)
      player.isLooping = false
      player.setOnPreparedListener { prepared ->
        prepared.start()
        updatePlayIcon(true)
        updateProgress()
        uiHandler.removeCallbacks(progressTick)
        uiHandler.post(progressTick)
      }
      player.setOnVideoSizeChangedListener { _, nextVideoWidth, nextVideoHeight ->
        videoWidth = nextVideoWidth
        videoHeight = nextVideoHeight
        updateTextureTransform()
      }
      player.setOnCompletionListener {
        it.seekTo(0)
        it.pause()
        updatePlayIcon(false)
        updateProgress()
      }
      mediaPlayer = player
      player.prepareAsync()
    } catch (_: Throwable) {
      releasePlayer()
    }
  }

  private fun updateTextureTransform() {
    if (videoWidth <= 0 || videoHeight <= 0 || width <= 0 || height <= 0) return
    val viewRatio = width.toFloat() / height.toFloat()
    val videoRatio = videoWidth.toFloat() / videoHeight.toFloat()
    val nextFitScaleX: Float
    val nextFitScaleY: Float
    if (videoRatio > viewRatio) {
      nextFitScaleX = 1f
      nextFitScaleY = viewRatio / videoRatio
    } else {
      nextFitScaleX = videoRatio / viewRatio
      nextFitScaleY = 1f
    }
    fitScaleX = nextFitScaleX
    fitScaleY = nextFitScaleY
    clampVideoTranslate()
    applyTextureTransform()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updateTextureTransform()
  }

  private fun handleVideoTouch(event: MotionEvent) {
    if (event.pointerCount >= 2 || userScale > 1.02f) {
      parent?.requestDisallowInterceptTouchEvent(true)
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        isPanning = userScale > 1.02f
        isScaling = false
        panStartX = event.x
        panStartY = event.y
        baseTranslateX = translateX
        baseTranslateY = translateY
      }
      MotionEvent.ACTION_POINTER_DOWN -> {
        if (event.pointerCount >= 2) {
          parent?.requestDisallowInterceptTouchEvent(true)
          isScaling = true
          startDistance = pointerDistance(event)
          val center = pointerCenter(event)
          startCenterX = center.first
          startCenterY = center.second
          baseUserScale = userScale
          baseTranslateX = translateX
          baseTranslateY = translateY
        }
      }
      MotionEvent.ACTION_MOVE -> {
        if (event.pointerCount >= 2 && startDistance > 0f) {
          parent?.requestDisallowInterceptTouchEvent(true)
          val distance = pointerDistance(event)
          val center = pointerCenter(event)
          val nextScale = (baseUserScale * (distance / startDistance)).coerceIn(1f, 4f)
          val ratio = nextScale / baseUserScale.coerceAtLeast(0.001f)
          val originX = center.first - width / 2f
          val originY = center.second - height / 2f
          userScale = nextScale
          translateX = baseTranslateX + (center.first - startCenterX) + (originX - baseTranslateX) * (1f - ratio)
          translateY = baseTranslateY + (center.second - startCenterY) + (originY - baseTranslateY) * (1f - ratio)
          clampVideoTranslate()
          applyTextureTransform()
        } else if (isPanning && userScale > 1.02f) {
          translateX = baseTranslateX + event.x - panStartX
          translateY = baseTranslateY + event.y - panStartY
          clampVideoTranslate()
          applyTextureTransform()
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        isPanning = false
        isScaling = false
        startDistance = 0f
        if (userScale <= 1.02f) {
          userScale = 1f
          translateX = 0f
          translateY = 0f
          applyTextureTransform()
          parent?.requestDisallowInterceptTouchEvent(false)
        } else {
          parent?.requestDisallowInterceptTouchEvent(true)
        }
      }
      MotionEvent.ACTION_POINTER_UP -> {
        val remainingPointers = event.pointerCount - 1
        if (remainingPointers >= 2) {
          startDistance = pointerDistance(event, event.actionIndex)
          val center = pointerCenter(event, event.actionIndex)
          startCenterX = center.first
          startCenterY = center.second
          isScaling = true
        } else {
          startDistance = 0f
          isScaling = false
          isPanning = userScale > 1.02f
          val keepIndex = if (event.actionIndex == 0) 1 else 0
          if (keepIndex < event.pointerCount) {
            panStartX = event.getX(keepIndex)
            panStartY = event.getY(keepIndex)
          }
        }
        baseUserScale = userScale
        baseTranslateX = translateX
        baseTranslateY = translateY
      }
    }
  }

  private fun applyTextureTransform() {
    if (width <= 0 || height <= 0) return
    val matrix = Matrix()
    matrix.setScale(fitScaleX * userScale, fitScaleY * userScale, width / 2f, height / 2f)
    matrix.postTranslate(translateX, translateY)
    textureView.setTransform(matrix)
  }

  private fun clampVideoTranslate() {
    if (userScale <= 1.02f || width <= 0 || height <= 0) {
      translateX = 0f
      translateY = 0f
      return
    }
    val contentWidth = width * fitScaleX * userScale
    val contentHeight = height * fitScaleY * userScale
    val maxX = ((contentWidth - width) / 2f).coerceAtLeast(0f)
    val maxY = ((contentHeight - height) / 2f).coerceAtLeast(0f)
    translateX = translateX.coerceIn(-maxX, maxX)
    translateY = translateY.coerceIn(-maxY, maxY)
  }

  private fun pointerDistance(event: MotionEvent, excludedIndex: Int = -1): Float {
    val firstTwo = activePointerIndexes(event, excludedIndex)
    if (firstTwo.size < 2) return 0f
    val dx = event.getX(firstTwo[0]) - event.getX(firstTwo[1])
    val dy = event.getY(firstTwo[0]) - event.getY(firstTwo[1])
    return kotlin.math.sqrt(dx * dx + dy * dy)
  }

  private fun pointerCenter(event: MotionEvent, excludedIndex: Int = -1): Pair<Float, Float> {
    val firstTwo = activePointerIndexes(event, excludedIndex)
    if (firstTwo.size < 2) return Pair(event.x, event.y)
    return Pair((event.getX(firstTwo[0]) + event.getX(firstTwo[1])) / 2f, (event.getY(firstTwo[0]) + event.getY(firstTwo[1])) / 2f)
  }

  private fun activePointerIndexes(event: MotionEvent, excludedIndex: Int): List<Int> {
    val indexes = ArrayList<Int>(2)
    for (index in 0 until event.pointerCount) {
      if (index != excludedIndex) {
        indexes.add(index)
      }
      if (indexes.size == 2) break
    }
    return indexes
  }

  private fun dp(value: Int): Int {
    return (value * resources.displayMetrics.density).toInt()
  }

  private fun togglePlayback(player: MediaPlayer) {
    if (player.isPlaying) {
      player.pause()
      updatePlayIcon(false)
    } else {
      player.start()
      updatePlayIcon(true)
      uiHandler.removeCallbacks(progressTick)
      uiHandler.post(progressTick)
    }
    updateProgress()
  }

  private fun updatePlayIcon(isPlaying: Boolean) {
    playButton.text = if (isPlaying) "⏸️" else "▶️"
  }

  private fun updateProgress() {
    val player = mediaPlayer
    if (player == null || player.duration <= 0) {
      progress.progress = 0
      timeText.text = "00:00"
      return
    }
    if (!isSeeking) {
      progress.progress = ((player.currentPosition.toFloat() / player.duration.toFloat()) * 1000).toInt().coerceIn(0, 1000)
      updateTimeText(progress.progress)
    }
  }

  private fun updateTimeText(progressValue: Int) {
    val player = mediaPlayer ?: return
    val duration = player.duration.coerceAtLeast(0)
    val current = if (duration > 0) (duration * (progressValue / 1000f)).toInt() else player.currentPosition
    timeText.text = "${formatMillis(current)} / ${formatMillis(duration)}"
  }

  private fun formatMillis(value: Int): String {
    val totalSeconds = (value / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%02d:%02d".format(minutes, seconds)
  }

  private fun releasePlayer() {
    uiHandler.removeCallbacks(progressTick)
    val player = mediaPlayer ?: return
    mediaPlayer = null
    try {
      player.stop()
    } catch (_: Throwable) {
    }
    try {
      player.release()
    } catch (_: Throwable) {
    }
  }

  fun release() {
    releasePlayer()
    surface?.release()
    surface = null
  }
}
