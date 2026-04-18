# CODEX.md

## 实施记录

### 0. 输入材料
- 目标设计稿：`双画面相机整体设计稿.html`。
- 技术基线：React Native + `react-native-vision-camera`。
- Android SDK：`D:\software\AndroidSDK`。

### 1. 技术决策
- React Native 已升级到 `0.85.1`，React 已升级到 `19.2.3`，满足当前 Node `24.13.0` 环境。
- Android 构建使用 Android Studio JBR：`D:\software\Android\jbr`，不使用系统 Java 8。
- 项目按用户已安装的 NDK `30.0.14904198-beta1` 配置 `ndkVersion = "30.0.14904198"`。RN 0.85.1 官方模板默认仍是 NDK `27.1.12297006`，因此 r30 beta 属于实测可构建方案。
- VisionCamera 5 依赖 Nitro，新架构与原生 C++ 构建已在 NDK r30 beta 下通过 Debug 构建。
- 双画面预览使用两个原生 `PreviewOutput`：主画面全屏预览，PiP 副画面实时预览；两个预览只在预览态绑定。
- 输出组合按管线拆分：双画面预览态绑定 `Preview + Preview`，拍照瞬间切到 `Preview + ImageCapture`，录像瞬间切到 `Preview + VideoCapture`，避免 CameraX surface combination 失败。
- 已撤销 Worklets/FrameOutput/RGB 拷贝副预览路径；该路径在真机会触发 HostFunction 生命周期红屏。
- 联网资料验证结论：同一摄像头同源输出不能获得超过传感器有效区域的额外视野；Android CameraX/Camera2 只能在传感器输出范围内按 ViewPort 或 crop region 裁切。因此采用“主画面 3:4 + 横向副画面 16:9 从同源 4:3 输出中裁切”的可落地方案。
- 双画面拍照不再保存相机原片作为主图；主图和副图都使用原生 `DualViewMedia` 模块按当前可见预览方向输出，竖向主画面为 3:4，横向副画面优先使用原始传感器横向位图裁切 16:9。
- 双画面录像使用原生 Media3 Transformer 生成主/副方向视频变体：竖图输出 720x1280，横图输出 1280x720，并使用 crop 模式匹配拍照构图。
- 后台恢复使用 React Native `AppState` 控制 VisionCamera `isActive`，回到前台时递增 session revision 并重新挂载主/副预览视图，避免 Surface 冻结。
- 设备能力探测结果在 Android CameraX 上可能误报；低光增强、实时 torch 控制已禁用或降级，避免真机异常影响主流程。
- Android Studio 直接 Run 使用 `debug` 变体内置 JS bundle：`debuggableVariants = []`，并固定 Gradle 打包 Node 为 `C:/nvm4w/nodejs/node.exe`，避免 Android Studio 环境 PATH 缺失导致打包失败。
- 当前默认调试策略优先“Android Studio 可直接运行”。这会牺牲 Metro 热更新体验：JS 改动需要重新 Run/Build 才进入 APK；需要热更新时再临时切回 Metro 链路。

### 2. 任务清单
- [x] 文档：创建 `agents.md`、`codex.md` 并维护进度。
- [x] 脚手架：初始化并升级 React Native TypeScript 项目到 `0.85.1`。
- [x] 依赖：安装 `react-native-vision-camera`、Nitro peer dependencies、CameraRoll。
- [x] Android：添加相机、录音、媒体读写权限与 SDK/JDK/NDK r30 配置。
- [x] 应用：实现相机权限、设备选择、拍照/录像、单双画面、横竖构图、设置面板。
- [x] UI：移除底部设备描述区，右侧按钮改为前后摄像头翻转，整体改成系统相机结构。
- [x] 交互：实现点击对焦、缩放、闪光灯状态、设置弹层、最近拍摄预览。
- [x] 保存：拍照/录像接入 CameraRoll，媒体保存到系统相册 `DCIM/DualViewCamera`。
- [x] 双画面切换：点击 PiP 只交换展示状态，主预览保持活跃，避免冻结。
- [x] CameraX 组合：按拍照/录像模式拆分输出，规避 `No supported surface combination`。
- [x] Bug 修复：缩放连击取消提示、闪光补光、顶部状态栏遮挡、录像 MIME 误判、双画面照片重复。
- [x] 真双预览：使用两个原生 `PreviewOutput`，仅在预览态绑定，副画面 PiP 实时显示。
- [x] 拍照语义：主画面和副画面都按屏幕当前可见预览方向裁切保存，优先保证拍照即所得与横竖方向正确。
- [x] 录像语义：主画面和副画面都进入原生 Media3 转码路径，按主/副构图方向输出视频文件。
- [x] 画面清理：移除主画面和副画面的辅助线、网格线和遮罩层。
- [x] 构图方案：主画面改为 3:4 预览槽，横向副画面保持 16:9，从同源 4:3 采集结果中裁切。
- [x] Android Studio：Debug APK 内置 bundle，解决直接 Run 的 `Unable to load script`。
- [x] 模拟器诊断：相机预览未启动时显示覆盖层，提示检查权限或模拟器 Camera 配置。
- [x] 稳定性：移除 `react-native-worklets` 与 `react-native-vision-camera-worklets`，避免 HostFunction/WorkletQueueFactory 生命周期红屏。
- [x] 生命周期：后台切回前台时暂停/恢复相机并重新挂载预览，降低 Surface 冻结概率。
- [x] 验证：类型检查、Android Debug 构建、无 Metro 真机安装启动、双预览、主副切换、双画面拍照、双文件录像保存。

### 3. 进度日志
- 2026-04-17：读取设计稿，确认当前目录仅包含 HTML。
- 2026-04-18：安装 `react-native-vision-camera@5.0.1`、`react-native-nitro-modules@0.35.4`、`react-native-nitro-image@0.13.1`。
- 2026-04-18：用户切换到 Node `24.13.0`，并安装 NDK `30.0.14904198-beta1`。
- 2026-04-18：升级 React Native 到 `0.85.1`，React 到 `19.2.3`，Gradle wrapper 到 `9.3.1`。
- 2026-04-18：Android `ndkVersion` 改为 `30.0.14904198`，并保留国内 Maven 镜像以降低下载失败概率。
- 2026-04-18：修正 Android `MainActivity` 主组件名为 `DualViewCameraV1`，避免与 `app.json` 注册名不一致。
- 2026-04-18：完成 Debug 构建、安装、Metro 热更新与 `adb reverse` 调试链路。
- 2026-04-18：按用户新计划重构 `App.tsx`：CameraRoll 保存、缩略图、翻转摄像头、对焦、缩放、系统相机式 UI、顶部按钮、双画面 PiP、主副切换。
- 2026-04-18：真机定位并修复 `No flash unit` 与 `Low-light boost is not supported` 问题。
- 2026-04-18：真机拍照验证成功，系统相册查询到 `DCIM/DualViewCamera/VisionCamera_4109773192441095920.jpg`。
- 2026-04-18：验证双 `PreviewOutput` 与拍照/录像输出同时绑定会在真机触发 `No supported surface combination`；改为预览态使用双 `PreviewOutput`，拍照/录像前切换到单 Preview + 对应用例输出。
- 2026-04-18：输出组合拆分为拍照 `Preview + ImageCapture`、录像 `Preview + VideoCapture`；新增原生照片裁剪模块，修复双画面照片完全相同的问题。
- 2026-04-18：录像保存前补 `.mp4` 扩展名，避免 MediaStore 将无扩展名视频按 `application/octet-stream` 插入图片库。
- 2026-04-18：验证 Worklets/FrameOutput 副预览在真机会触发 `HybridObject "WorkletQueueFactory" was cached, but the refcount got destroyed` 红屏，决定撤销该路径。
- 2026-04-18：移除 Worklets Babel 插件、`react-native-worklets`、`react-native-vision-camera-worklets`；保留 VisionCamera 必需的 `react-native-nitro-image` 构建依赖。
- 2026-04-18：双画面预览改为两个原生 `PreviewOutput` 仅预览态绑定；拍照/录像按需切换到各自 MVP 管线。
- 2026-04-18：按用户要求调整双画面拍照：主画面不再裁切，副画面按 PiP 预览构图裁切。
- 2026-04-18：将 Android `debug` 变体改为内置 JS bundle，并固定 Node 路径，保证 Android Studio 直接 Run 不依赖 Metro。
- 2026-04-18：新增预览状态覆盖层，模拟器黑屏或 CameraX 预览未启动时显示诊断信息。
- 2026-04-18：`npx tsc --noEmit` 通过；`:app:assembleDebug` 成功并执行 `:app:createBundleDebugJsAndAssets`。
- 2026-04-18：真机无 Metro 安装启动通过；双画面预览、点击 PiP 主副切换、双画面拍照、双文件录像保存均完成回归，日志未出现 Worklets 红屏、`No supported surface combination` 或 `application/octet-stream` 保存错误。
- 2026-04-18：再次修正双画面构图：去除所有辅助线；主副都按当前预览方向输出照片；横图从 EXIF 转正后的位图旋转裁剪，避免副图方向歪斜。
- 2026-04-18：副画面切到主画面时，主区域改为居中 16:9 预览槽，避免主副切换后画面看起来一致。
- 2026-04-18：双画面录像改为调用原生 Media3 Transformer 输出主/副构图视频；转码失败时回退复制原文件，保证应用不崩溃。
- 2026-04-18：重新执行 `npx tsc --noEmit`、`:app:assembleDebug`、真机安装启动和日志检查，均通过。
- 2026-04-18：按用户要求联网核对 CameraX/Camera2/VisionCamera 生命周期资料，结论是不能从同源输出获得超过传感器区域的额外视野；改为主画面 3:4、横向副画面 16:9 裁切。
- 2026-04-18：修复后台恢复冻结：`AppState` inactive 时暂停相机，active 时刷新 session revision 并重建 `NativePreviewView`。
- 2026-04-18：再次执行 `npx tsc --noEmit`、`:app:assembleDebug`、真机安装启动和日志检查，均通过。

### 4. 验证命令
```powershell
npx tsc --noEmit
cd android
$env:JAVA_HOME='D:\software\Android\jbr'
$env:ANDROID_HOME='D:\software\AndroidSDK'
$env:ANDROID_SDK_ROOT='D:\software\AndroidSDK'
.\gradlew.bat :app:assembleDebug --console plain --stacktrace
D:\software\AndroidSDK\platform-tools\adb.exe devices
D:\software\AndroidSDK\platform-tools\adb.exe -s "adb-1b31f81b-asplME (2)._adb-tls-connect._tcp" install -r .\android\app\build\outputs\apk\debug\app-debug.apk
D:\software\AndroidSDK\platform-tools\adb.exe -s "adb-1b31f81b-asplME (2)._adb-tls-connect._tcp" shell monkey -p com.dualviewcamerav1init -c android.intent.category.LAUNCHER 1
```

### 5. 当前限制
- 双画面是同源预览多视图，不是双摄并发。
- 当前真机不支持 RN 层同时绑定两个实时预览 Surface 与拍照/录像用例；PiP 实时预览只能保留在待机预览态，拍照/录像时必须临时切换输出组合。
- 双画面拍照现在可生成两张不同构图照片：主图和副图都按可见预览方向裁切，但仍来自同一次同源传感器输出，不是双摄并发，也不会超过传感器有效区域。
- 副画面实时 PiP 当前使用第二个原生 `PreviewOutput`。这是比 Worklets/RGB 拷贝更稳定的方案，但必须严格限制在预览态；拍照和录像时需要切换到单 Preview + 对应用例输出。
- 原生 GPU/Skia 方案仍是后续性能优化方向，但当前真机已通过双原生预览满足功能正确性；下一步不应盲目引入 Skia，除非需要在录像中同时保持 PiP 实时合成。
- 双画面录像已接入原生转码输出；如果具体设备编码器或 Media3 Transformer 在某个视频上失败，代码会回退复制原文件，优先保证应用不崩溃。

