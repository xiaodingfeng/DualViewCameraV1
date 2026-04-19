# DualViewCameraV1

基于 React Native 0.85.1 和 `react-native-vision-camera@5.0.1` 实现的 Android 双画面相机应用。

当前优先支持 Android 真机 USB 调试和打包；iOS 暂不作为交付目标。

## 环境要求

- Node.js: `>=22.11.0`
- Android SDK: `D:\software\AndroidSDK`
- 构建 Java: Android Studio JBR，路径 `D:\software\Android\jbr`
- NDK: `30.0.14904198-beta1`，Gradle 中通过 `ndkVersion = "30.0.14904198"` 使用
- Android Gradle 构建入口: `android\gradlew.bat`

首次拉取或依赖变更后安装依赖：

```powershell
npm install
```

## 本地验证

从项目根目录执行：

```powershell
$env:JAVA_HOME="D:\software\Android\jbr"
$env:ANDROID_HOME="D:\software\AndroidSDK"
$env:ANDROID_SDK_ROOT="D:\software\AndroidSDK"
npx tsc --noEmit
```

构建 Debug 包：

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

Debug APK 输出位置：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

当前 Debug 变体会内置 JS bundle，Android Studio 直接 Run 不依赖 Metro。JS 修改后需要重新 Run 或重新构建 APK 才会进入安装包。

## 构建 Release 包

从项目根目录执行：

```powershell
$env:JAVA_HOME="D:\software\Android\jbr"
$env:ANDROID_HOME="D:\software\AndroidSDK"
$env:ANDROID_SDK_ROOT="D:\software\AndroidSDK"
cd android
.\gradlew.bat clean
.\gradlew.bat :app:assembleRelease
```

Release APK 输出位置：

```text
android\app\build\outputs\apk\release\app-release.apk
```

如果需要给应用市场使用，优先构建 AAB：

```powershell
cd android
.\gradlew.bat :app:bundleRelease
```

AAB 输出位置：

```text
android\app\build\outputs\bundle\release\app-release.aab
```

## 正式签名配置

没有配置正式签名时，`assembleRelease` 会沿用 `debug.keystore` 生成可安装的内测 release APK。这个包不适合作为生产分发或应用市场上架包。

生成正式 keystore 示例：

```powershell
keytool -genkeypair `
  -v `
  -storetype PKCS12 `
  -keystore android\app\dualviewcamera-release.jks `
  -alias dualviewcamera `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

创建 `android\signing.properties`，填写你的真实密码和别名：

```properties
DUALVIEW_RELEASE_STORE_FILE=dualviewcamera-release.jks
DUALVIEW_RELEASE_STORE_PASSWORD=your-store-password
DUALVIEW_RELEASE_KEY_ALIAS=dualviewcamera
DUALVIEW_RELEASE_KEY_PASSWORD=your-key-password
```

说明：

- `DUALVIEW_RELEASE_STORE_FILE` 相对路径以 `android\app` 为基准；也可以填写绝对路径。
- `android\signing.properties`、`*.keystore`、`*.jks` 已加入 `.gitignore`，不要提交签名文件和密码。
- 配置完成后重新执行 `.\gradlew.bat :app:assembleRelease` 或 `.\gradlew.bat :app:bundleRelease`，产物会使用正式 keystore 签名。

也可以不用 `android\signing.properties`，改用环境变量：

```powershell
$env:DUALVIEW_RELEASE_STORE_FILE="D:\secure\dualviewcamera-release.jks"
$env:DUALVIEW_RELEASE_STORE_PASSWORD="your-store-password"
$env:DUALVIEW_RELEASE_KEY_ALIAS="dualviewcamera"
$env:DUALVIEW_RELEASE_KEY_PASSWORD="your-key-password"
```

## 安装到 USB 真机

构建后安装 APK：

```powershell
adb devices
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

启动应用：

```powershell
adb shell monkey -p com.dualviewcamerav1init 1
```

## 生产包发布前检查

发布前建议至少执行：

```powershell
npx tsc --noEmit
cd android
.\gradlew.bat :app:assembleRelease
```

真机回归重点：

- 首次启动相机权限申请。
- 单画面拍照和录像。
- 双画面主副预览、点击 PiP 主副切换。
- 双画面拍照生成主图和副图。
- 双画面录像生成主视频和副视频。
- 后台切回前台预览不冻结。
- 生成文件可在系统相册 `DCIM/DualViewCamera` 检索。

## 关键实现约束

- 双画面是同一摄像头同源预览的多视图裁剪，不是双摄并发。
- 单画面模式只展示一个实时取景画面。
- 双画面预览态展示主画面和 PiP 副画面；拍照或录像时会临时切换 CameraX 输出组合，避免 surface combination 错误。
- 主画面照片输出 3:4，横向副画面从同源 4:3 输出中裁切为 16:9。
- 双画面录像通过原生 Media3 Transformer 生成主/副构图视频；转码失败时回退保存原始文件，避免崩溃。
