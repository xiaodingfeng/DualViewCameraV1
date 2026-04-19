# AGENTS.md

## 项目目标
基于 `双画面相机整体设计稿.html` 实现一个 React Native Android 相机应用，底层使用 `react-native-vision-camera`。

核心体验：
- 拍照 / 录像一级切换。
- 单画面 / 同摄双画面切换。
- 竖屏主画面 + 横屏副画面；手机横屏时 UI 不跟随旋转，仅副画面切换为竖屏构图。
- 设置入口承接系统相机可开放能力，并按设备能力动态展示。

## 工程约束
- 当前工作目录：`D:\dingfeng\work\aiproject\DualViewCameraV1`。
- Android SDK：`D:\software\AndroidSDK`。
- 目标优先级：Android 真机 USB 调试优先，iOS 暂不实现。
- 相机库：`react-native-vision-camera@5.0.1`。
- React Native：`0.85.1`。
- React：`19.2.3`。
- NDK：`30.0.14904198-beta1`，通过 `ndkVersion = "30.0.14904198"` 使用。
- 双画面定义：同一摄像头同源预览的多视图裁剪，不是双摄并发。
- 构建 Java：使用 Android Studio JBR：`D:\software\Android\jbr`。

## 当前计划与进度
- [x] 建立项目协作文档 `agents.md` / `codex.md`。
- [x] 初始化 React Native Android 项目并固定可构建依赖版本。
- [x] 接入 VisionCamera、Android 权限与相机能力探测。
- [x] 实现单/双画面、横/竖构图、拍照/录像切换与设置 UI。
- [x] 按系统相机方向调整 UI：底部描述区移除，右侧按钮改为前后摄像头翻转。
- [x] 修复拍照保存：最近预览图可显示，系统相册 `DCIM/DualViewCamera` 可检索到生成文件。
- [x] 修复闪光灯、低光增强等设备能力误报导致的真机异常。
- [x] 调整对焦/缩放触摸层，避免抢占副画面点击事件。
- [x] 修复双画面主副切换：点击副画面只交换展示状态；第二个原生预览仅在预览态绑定，主画面不冻结。
- [x] 按 CameraX surface combination 降级输出组合：拍照只绑定 Preview + ImageCapture，录像只绑定 Preview + VideoCapture。
- [x] 修复缩放连击取消提示、拍照闪光补光、顶部状态栏遮挡、录像保存 MIME 错误。
- [x] 双画面拍照改为一次捕获后生成主/副两张不同构图文件：主画面竖构图，副画面横构图；主副切换后构图同步反转。
- [x] 撤销不稳定的 Worklets/FrameOutput 副预览路径，双画面预览改为两个原生 `PreviewOutput` 仅在预览态绑定。
- [x] 调整保存策略：主画面和副画面都按当前可见预览方向输出，优先保证拍照即所得和横竖方向正确。
- [x] 调整 Android Studio 直接 Run：Debug APK 内置 JS bundle，不再依赖 Metro 才能启动。
- [x] 增加相机预览启动诊断层：模拟器黑屏或 CameraX 启动失败时显示明确原因。
- [x] 真机回归双画面预览、主副切换、双画面拍照、双文件录像保存，无 Worklets 红屏和 CameraX surface combination 错误。
- [x] 修复双画面拍照构图：照片先按 EXIF 转正，再按主/副预览方向旋转裁剪，避免副图方向歪斜。
- [x] 修复主副切换预览：副画面切到主画面后使用居中横向主预览区域，不再让主副画面看起来完全一样。
- [x] 去除主画面和副画面的构图辅助线、网格线和遮罩层，保留真实预览区域用于拍照即所得。
- [x] 双画面录像接入原生 Media3 Transformer，按主/副构图生成对应方向的视频变体。
- [x] 按联网资料验证后的可行方案调整构图：单个同源相机不能获得超过传感器有效区域的额外视野，双画面改为主画面 3:4、横向副画面 16:9 从同源 4:3 输出中裁切。
- [x] 修复后台切回前台画面冻结：接入 `AppState` 控制相机 `isActive`，回到前台时刷新预览 Session revision 并重新挂载预览视图。
- [x] 优化拍照/录像期间 PiP 副画面占位：明确提示副画面会按保存构图输出，避免误解为黑屏异常。
- [x] 优化拍照保存链路：快门路径只等待相机捕获，主/副图裁剪与相册入库转入后台；双画面照片通过原生一次解码生成主/副两张裁切图，改善连拍阻塞。
- [x] 设置页增加照片格式 JPG/HEIF 与录像编码 HEVC/H.264 选择；照片裁剪输出支持 HEIF，录像构图转码按所选编码输出。
- [x] 完成本地 TypeScript/Android 构建验证，USB 设备安装运行。
- [x] 更新文档进度与交付说明。

## 验收状态
- [x] `npx tsc --noEmit` 通过。
- [x] `:app:assembleDebug` 构建成功，且已执行 `:app:createBundleDebugJsAndAssets`。
- [x] `app-debug.apk` 已安装到 USB 设备。
- [x] 已移除 `adb reverse tcp:8081`，无 Metro 依赖启动通过。
- [x] 应用已通过 ADB 启动，进程在线。
- [x] 真机双画面拍照已验证，主图与副图生成在 `DCIM/DualViewCamera/`。
- [x] 真机录像已验证，双画面保存模式生成主/副两个 `.mp4` 文件。

## 当前实现说明
- 单画面模式只展示一个实时取景画面。
- 双画面模式展示主画面 + PiP 副画面入口；点击 PiP 时交换主/副展示方向和标签，两个预览 Surface 保持实时，不停止、不冻结。
- 已验证当前真机 CameraX 不支持同时绑定两个 `PreviewOutput` 再叠加拍照或录像输出；因此第二个预览 Surface 只在预览态启用，拍照/录像前会临时切换管线。
- 双画面拍照通过原生 `DualViewMedia` 模块生成主/副两张不同构图照片：竖向主画面输出 3:4，横向副画面从原始传感器方向裁切 16:9。
- 双画面预览态使用两个原生 `PreviewOutput`：主画面全屏预览，PiP 副画面实时预览。按下拍照时临时切换到 `Preview + ImageCapture` 管线完成拍摄，避免同时绑定两个预览和拍照。
- 录像待机时保留双预览；按下录像时临时切换到 `Preview + VideoCapture` 管线，录像停止后恢复双预览，避免 CameraX surface combination 错误。
- 拍照/录像管线切换期间，PiP 副画面显示“拍照中/录制中，副画面按保存构图输出”的占位提示，不再只显示黑屏占位。
- 拍照保存不再阻塞快门完成后的 UI 恢复；照片裁剪、双文件生成与 CameraRoll 入库在后台执行，失败时只保留错误提示。
- 拍照设置支持 JPG/HEIF；HEIF 使用 AndroidX HeifWriter 输出，Android 9 以下设备会回退为 JPG。录像设置支持 HEVC/H.264，作用于最终保存的主/副构图视频转码输出。
- Android Studio 直接运行 `debug` 变体时会先打包 JS 到 APK，因此不会再出现未启动 Metro 导致的 `Unable to load script`；代价是 JS 改动需要重新 Run/Build 才会进入 APK。
- 若需要 Metro 热更新，可手动启动 Metro 并使用 React Native CLI 调试链路，但当前默认优先保证 Android Studio 直接运行。
- 主画面照片和副画面照片都按照当前可见预览方向输出：竖屏画面输出 3:4，横屏画面输出 16:9。
- 录像文件进入相册前会规范化为 `.mp4` 路径，避免 Android MediaStore 误判 `application/octet-stream`。
- 双画面录像使用原生 Media3 Transformer 按主/副方向输出 720x1280 或 1280x720 视频；如果设备转码失败，会回退保存原始文件以保证不崩溃。
- 点击预览区域执行对焦；右侧 `+/-` 执行缩放。
- 顶部关闭、闪光灯、设置按钮已有实际行为。
- 录像保存已接入 CameraRoll；双画面录像主/副文件通过原生转码链路按构图输出。
- 应用进入后台时暂停相机，回到前台时主动刷新预览挂载，避免 Surface 停留在后台前最后一帧。

