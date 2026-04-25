# CODEX.md — DualViewCameraV1 仓库核对后的完整开发升级计划

> 文件用途：Codex 后续开发时应按本计划逐项执行、验证、更新进度。
>
> 项目仓库：`xiaodingfeng/DualViewCameraV1`
>
> 当前定位：React Native + VisionCamera 的 Android 优先双画面相机。当前稳定主线是“同一摄像头同源预览的多视图裁剪”，不是前后摄或多摄并发；双摄并发只作为最后阶段的高级模式接入。

---

## -1. 仓库核对说明：不要直接照抄 `agents.md`

### -1.1 本次核对依据

本计划不是直接复制 `agents.md` 。生成本计划前，需要 Codex 每轮都重新核对以下事实源：

```text
README.md
agents.md
codex.md
package.json
App.tsx
src/screens/CameraShell.tsx
src/components/SettingsModal.tsx
src/components/CameraPrimitives.tsx
src/utils/camera.ts
src/utils/gallery.ts
src/utils/settings.ts
src/native/dualViewMedia.ts
android/app/build.gradle
android/app/src/main/java/com/dualviewcamerav1init/DualViewMediaModule.kt
android/app/src/main/java/com/dualviewcamerav1init/DualViewVideoView.kt
android/app/src/main/java/com/dualviewcamerav1init/SharedTextureView.kt
```

原则：

- `README.md` 用来确认当前公开承诺、构建命令和关键约束。
- `agents.md` 用来了解历史目标和已完成事项，但不能作为唯一事实源。
- `codex.md` 用来保留历史实施记录，但后续升级计划应追加到后面，避免覆盖历史。
- 当前代码优先级高于文档；文档与代码冲突时，先按代码事实更新计划，再单独修正文档。

### -1.2 已确认仍一致的点

- Android 真机优先，iOS 暂不作为交付目标。
- 技术基线仍是 React Native `0.85.1`、React `19.2.3`、`react-native-vision-camera@5.0.1`。
- 当前主线仍是同源双画面裁切，不是真双摄并发。
- 单画面 / 双画面、拍照 / 录像、PiP 主副切换、后台恢复、相册保存仍是核心主链路。
- Debug APK 内置 JS bundle，Android Studio 直接 Run 不依赖 Metro 的策略仍应保留。
- 双画面录像仍应通过原生 Media3 Transformer 输出主 / 副构图视频；失败时必须保留原始主产物，不能崩溃。

### -1.3 已发现需要按当前代码修正的点

| 项目 | 旧文档常见描述 | 当前代码/计划应采用的描述 | 处理方式 |
|---|---|---|---|
| 双画面待机输出组合 | 预览态只是 `Preview + Preview`，拍照前切 `Preview + ImageCapture` | 当前策略应按稳定实现描述为：双画面待机优先 `Preview + Preview + Photo`；录像态或录像缓冲期切到 `Preview + Video` | 后续不要回退到旧的单纯双 Preview 叙述 |
| 设置页能力展示 | “按设备能力动态展示”已经完成 | 当前仍需要建设统一 `Capability Service`；设置项不能继续硬展示所有规格 | Phase 7 作为明确开发阶段 |
| 关于页/能力文案 | “主副画面同时采集” | 在真双摄并发完成前，应改为“同源双构图 / 主副构图同时输出” | 文案避免误导用户以为已支持双摄并发 |
| 相机管线重构 | 可以大幅拆分 `CameraShell.tsx` | 相机链路敏感，只能先抽构图、媒体、能力、任务队列；不要一次性拆完 | Phase 0 - Phase 7 小步迁移 |
| 双摄并发 | 不是当前能力 | 用户要求最后支持，且应以设备能力探测为前提 | Phase 10 - Phase 12 独立推进 |

### -1.4 Codex 开发时的事实优先级

遇到冲突时，按以下顺序决策：

1. 当前代码实际行为。
2. README 中的构建与发布约束。
3. 最新 `codex.md` 实施记录。
4. `agents.md` 历史目标。
5. 本升级计划中的后续目标。

如果本计划与当前代码冲突，Codex 应先暂停该子任务，在 `codex.md` 追加“发现冲突”记录，并优先提交一个文档修正或小型兼容补丁。

---

## 0. Codex 执行总规则

### 0.1 必须保持的技术基线

- React Native：`0.85.1`
- React：`19.2.3`
- VisionCamera：`react-native-vision-camera@5.0.1`
- Android 优先，iOS 暂不作为交付目标。
- Android SDK：`D:\software\AndroidSDK`
- 构建 Java：Android Studio JBR：`D:\software\Android\jbr`
- NDK：`30.0.14904198-beta1`，Gradle 中使用 `ndkVersion = "30.0.14904198"`
- 默认调试链路优先 Android Studio 直接 Run，Debug APK 内置 JS bundle；不要默认改回 Metro 依赖启动。

### 0.2 不能破坏的核心约束

- 不要把当前方案改成真双摄并发。
- 不要重新引入 `react-native-worklets` 或 `react-native-vision-camera-worklets` 作为副预览方案。
- 不要让双画面拍照 / 录像重新触发 `No supported surface combination`。
- 副画面 PiP 预览只允许在安全的预览态绑定，录像态优先保持主预览 + VideoOutput 稳定。
- 同源双画面不能获得超过传感器有效区域的额外视野，所有横竖副画面都只能基于同一帧裁切。
- 拍照、录像、后台恢复、相册保存是稳定性红线；任何新功能不能降低这些路径成功率。

### 0.3 每个阶段完成后的固定验证

在 Windows PowerShell 中执行：

```powershell
$env:JAVA_HOME="D:\software\Android\jbr"
$env:ANDROID_HOME="D:\software\AndroidSDK"
$env:ANDROID_SDK_ROOT="D:\software\AndroidSDK"

npx tsc --noEmit
cd android
.\gradlew.bat :app:assembleDebug --console plain --stacktrace
```

真机回归重点：

- 首次启动权限申请。
- 单画面拍照。
- 单画面录像。
- 双画面主副预览。
- 点击 PiP 主副切换。
- 双画面拍照生成主图 / 副图。
- 双画面录像生成主视频 / 副视频。
- 后台切回前台预览不冻结。
- 生成文件可在系统相册 `DCIM/DualViewCamera` 检索。
- 设置页保存后重启 App 仍能恢复。


### 0.4 每轮任务开始前的最小检查

每轮 Codex 任务开始前，必须先查看：

- `git status --short`
- `package.json`
- `src/screens/CameraShell.tsx`
- `src/utils/settings.ts`
- `src/utils/gallery.ts`
- 本轮计划涉及的目标文件

如果存在用户未提交的改动：

- 不要直接覆盖。
- 先读取上下文。
- 采用最小 patch。
- 在本轮记录里注明“保留用户已有改动”。

### 0.5 代码格式与大文件原则

- 不要全仓库格式化。
- 不要无意义重排 import、样式对象和大型 JSX。
- 只格式化本次改动触及的局部区域。
- 如果需要引入 Prettier，先单独提交“格式化配置”，不要和业务变更混合。
- 相机主链路文件如 `CameraShell.tsx` 每次改动后必须重新跑 TypeScript 和 Android Debug 构建。

### 0.6 文档同步规则

每完成一个阶段或关键子任务，必须同步更新：

- `codex.md`：写实施记录、验证结果、已知问题。
- `README.md`：只在用户可见能力、构建命令、发布流程变化时更新。
- `agents.md`：只在长期协作约束变化时更新；不要把临时实现细节塞进 `agents.md`。


---

## 1. 当前仓库状态摘要

### 1.1 已有目录结构

当前仓库已拆分为：

```text
App.tsx
src/
  components/
    CameraPrimitives.tsx
    GalleryModal.tsx
    SettingsModal.tsx
  config/
    camera.ts
  native/
    dualViewMedia.ts
  screens/
    CameraShell.tsx
  styles/
    cameraStyles.ts
  types/
    camera.ts
  utils/
    camera.ts
    gallery.ts
    settings.ts
android/app/src/main/java/com/dualviewcamerav1init/
  DualViewCameraPackage.kt
  DualViewMediaModule.kt
  DualViewVideoView.kt
  MainActivity.kt
  MainApplication.kt
  SharedTextureView.kt
```

### 1.2 已实现能力

- 单画面 / 双画面模式。
- 拍照 / 录像模式。
- 主画面 + PiP 副画面实时预览。
- 点击 PiP 主副切换。
- 双画面拍照输出主 / 副两张不同构图照片。
- 双画面录像通过原生 Media3 Transformer 输出主 / 副构图视频。
- JPG / HEIF 照片设置。
- HEVC / H.264 视频转码设置。
- 设置持久化。
- CameraRoll 保存到 `DCIM/DualViewCamera`。
- 后台切回前台刷新预览，降低 Surface 冻结概率。
- Gallery 滑入查看最近素材。

### 1.3 当前主要问题

- 构图逻辑散落在 `CameraShell.tsx`，后续扩展模板会越来越难维护。
- 媒体资产只依赖系统相册查询，缺少“同一次拍摄的一组产物”索引。
- 双画面录像副画面后台处理只有轻量提示，缺少任务队列、进度、失败重试。
- 设置页仍偏功能枚举，缺少按设备能力动态显隐的统一能力服务。
- PiP 位置和布局模板还不够可玩，目前更像固定画中画。
- 裁切安全框 / 多平台输出包 / 局部特写尚未产品化。

---

## 2. 总体升级目标

把应用从“能拍双画面”升级为：

> 一次拍摄，自动生成多比例、多构图、多平台素材的创作相机。

核心升级方向：

1. **Composition Engine**：统一描述主画面、副画面、布局、裁切、输出、覆盖层。
2. **Media Asset Index**：将一次拍摄的主图、副图、原始源文件、封面、视频变体组织成一个 `captureId`。
3. **Media Job Queue**：照片裁切、视频转码、相册入库、封面生成后台任务化。
4. **Safety Overlay**：显示真实成片安全框和裁切遮罩，降低构图误解。
5. **Template System**：支持 PiP、左右分屏、上下分屏、多平台素材包、局部特写。
6. **Capability Service**：按设备能力动态显示设置和降级输出。
7. **Creative Modes**：多平台素材包、局部特写、封面、水印、Vlog 模板。

---

## 3. 开发阶段总览

| 阶段 | 优先级 | 名称 | 目标 |
|---|---:|---|---|
| Phase 0 | P0 | 稳定性基线与测试护栏 | 先建立回归清单和类型边界 |
| Phase 1 | P0 | Composition Engine | 统一构图数据结构，降低后续改动风险 |
| Phase 2 | P0 | 安全框与裁切遮罩 | 用户预览即看到真实输出范围 |
| Phase 3 | P0 | 多平台照片输出包 | 一次拍摄输出横/竖/方素材 |
| Phase 4 | P1 | Media Asset Index | 主副图、视频、封面按 captureId 成组 |
| Phase 5 | P1 | Media Job Queue | 视频/图片处理任务化、可提示、可重试 |
| Phase 6 | P1 | PiP 可拖拽与模板化布局 | 增强创作可玩性 |
| Phase 7 | P1 | 设备能力服务 | 设置页动态能力显隐与安全降级 |
| Phase 8 | P2 | 局部特写副画面 | 同源双画面差异化能力 |
| Phase 9 | P2 | 封面与水印模板 | 提升分享完成度 |
| Phase 10 | P2 | 双摄并发能力探测与实验隔离 | 先验证设备支持、CameraX API、独立 Native View，不进入主路径 |
| Phase 11 | P2/P3 | 双摄并发产品化支持 | 在最后阶段支持前后摄并发拍摄、预览、保存与降级回退 |
| Phase 12 | P3 | 双摄并发合成输出与灰度上线 | 在双路独立拍摄稳定后，做 PiP/分屏合成视频、灰度开关和最终发布验收 |

---

## 4. Phase 0：稳定性基线与测试护栏

### 4.1 目标

在大改构图和媒体处理前，先建立最小测试护栏，避免 Codex 后续重构时破坏主链路。

### 4.2 任务

- [ ] 新增 `src/__tests__/cameraUtils.test.ts`。
- [ ] 为以下函数添加单元测试：
  - `visibleFrameSpec`
  - `calculateContainedFrame`
  - `videoFpsOptionsForQuality`
  - `videoTargetSizeForAspect`
  - `ensureVideoExtension`
  - settings 类型守卫：`isAspectRatioId`、`isPhotoFormat`、`isVideoCodecFormat` 等。
- [ ] 新增 `src/types/composition.ts`，先只放类型，不改业务逻辑。
- [ ] 在 `codex.md` 追加“升级计划已开始执行”的记录。

### 4.3 验收标准

- [ ] `npm test -- --runInBand` 通过。
- [ ] `npx tsc --noEmit` 通过。
- [ ] Android Debug 构建通过。
- [ ] App 真机主流程不变。

---

## 5. Phase 1：Composition Engine

### 5.1 目标

把当前分散在 `CameraShell.tsx` 的主副画面方向、裁切比例、保存规格抽象成稳定的数据模型，为后续多模板、多平台输出打底。

### 5.2 新增文件

```text
src/types/composition.ts
src/config/compositionTemplates.ts
src/utils/composition.ts
```

### 5.3 建议类型

```ts
export type CompositionAspectId = 'full' | '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export type CompositionRole = 'main' | 'sub' | 'cover' | 'source';

export type CompositionLayoutId =
  | 'single'
  | 'pip'
  | 'split-horizontal'
  | 'split-vertical'
  | 'stack'
  | 'detail-zoom';

export type CompositionOutputKind = 'photo' | 'video' | 'cover';

export type CompositionFrameOrientation = 'portrait' | 'landscape';

export interface CropSpec {
  aspectId: CompositionAspectId;
  orientation: CompositionFrameOrientation;
  variant: 'portrait' | 'landscape' | 'square' | 'full';
  aspect: number;
}

export interface CompositionOutputSpec {
  id: string;
  role: CompositionRole;
  kind: CompositionOutputKind;
  crop: CropSpec;
  enabled: boolean;
}

export interface CompositionScene {
  id: string;
  layoutId: CompositionLayoutId;
  source: 'same-camera';
  isSwapped: boolean;
  display: {
    main: CropSpec;
    sub?: CropSpec;
  };
  outputs: CompositionOutputSpec[];
}
```

### 5.4 迁移步骤

- [ ] 在 `composition.ts` 中创建 `buildCompositionScene()`。
- [ ] 输入参数包括：
  - `viewMode`
  - `selectedAspect`
  - `isSwapped`
  - `isDeviceLandscape`
  - `fullMainAspect`
  - `saveDualOutputs`
- [ ] 输出统一的：
  - `mainDisplaySpec`
  - `subDisplaySpec`
  - `mainSaveSpec`
  - `subSaveSpec`
  - `outputs`
- [ ] 替换 `CameraShell.tsx` 中以下派生逻辑：
  - `mainDisplayOrientation`
  - `subDisplayOrientation`
  - `saveMainOrientation`
  - `saveSubOrientation`
  - `mainFrameSpec`
  - `subFrameSpec`
  - `saveMainFrameSpec`
  - `saveSubFrameSpec`
- [ ] 保持 UI 和保存行为不变，只做结构迁移。

### 5.5 验收标准

- [ ] 双画面主副切换后，主图 / 副图方向仍正确。
- [ ] 手机横屏时，保存方向仍按当前实现逻辑输出。
- [ ] `CameraShell.tsx` 逻辑减少，不再直接拼接大量构图判断。
- [ ] 所有 Phase 0 测试通过。

---

## 6. Phase 2：安全框与裁切遮罩

### 6.1 目标

让用户在拍摄前看到真实成片范围。尤其是在同源裁切场景中，避免用户误以为副画面有额外视野。

### 6.2 新增 / 修改文件

```text
src/components/CompositionOverlay.tsx
src/components/CameraPrimitives.tsx
src/styles/cameraStyles.ts
src/screens/CameraShell.tsx
src/utils/composition.ts
src/types/composition.ts
```

### 6.3 功能要求

- [ ] 新增“安全框”设置项：`off | subtle | strong`。
- [ ] 默认值：`subtle`。
- [ ] 主画面显示当前输出比例边界。
- [ ] 副画面显示当前输出比例边界。
- [ ] 在 `selectedAspectId === 'full'` 时不显示裁切遮罩，只显示轻量边框。
- [ ] 在双画面模式下显示文字提示：
  - 主画面：`主画面 3:4` 或当前比例。
  - 副画面：`副画面 16:9` 或当前比例。
- [ ] 录像中不显示复杂遮罩，只保留最小边框，避免性能风险。

### 6.4 实现要点

- 不要在 `Camera` 原生预览上做重型绘制。
- 只用 React Native `View` 叠层实现边框、半透明遮罩、角标。
- 遮罩层必须 `pointerEvents="none"`，不能影响对焦、缩放、PiP 点击。
- 样式全部进 `cameraStyles.ts` 或新增独立样式文件。

### 6.5 设置持久化

扩展：

```ts
export type SafetyOverlayMode = 'off' | 'subtle' | 'strong';
```

并更新：

- `src/types/camera.ts`
- `src/utils/settings.ts`
- `SettingsModal.tsx`
- `CameraShell.tsx`

### 6.6 验收标准

- [ ] 单画面拍照模式显示安全框。
- [ ] 双画面待机显示主副安全框。
- [ ] 点击 PiP 主副切换后，安全框跟随主副角色变化。
- [ ] 对焦、缩放、PiP 点击不被遮罩阻挡。
- [ ] 录像中 UI 不明显掉帧。

---

## 7. Phase 3：多平台照片输出包

### 7.1 目标

新增“一次拍摄，多平台素材包”能力。用户拍一次照片，自动生成多个社交平台常用比例。

### 7.2 输出策略

新增输出包类型：

```ts
export type OutputPackId =
  | 'current-only'
  | 'dual-main-sub'
  | 'social-photo-pack';
```

建议默认：

- 单画面：`current-only`
- 双画面：`dual-main-sub`

用户可在设置中选择：

- `仅当前构图`
- `主副双图`
- `社交素材包：9:16 + 16:9 + 1:1 + 主副图`

### 7.3 需要生成的照片

`social-photo-pack` 在同一次源图基础上输出：

```text
{captureId}_main_3x4.jpg/heic
{captureId}_sub_16x9.jpg/heic
{captureId}_vertical_9x16.jpg/heic
{captureId}_horizontal_16x9.jpg/heic
{captureId}_square_1x1.jpg/heic
```

如用户选择 HEIF，则优先 HEIF；Android 9 以下继续回退 JPG。

### 7.4 新增 / 修改文件

```text
src/types/mediaAsset.ts
src/types/composition.ts
src/utils/composition.ts
src/utils/gallery.ts
src/screens/CameraShell.tsx
src/components/SettingsModal.tsx
android/app/src/main/java/com/dualviewcamerav1init/DualViewMediaModule.kt
```

### 7.5 原生能力要求

在 `DualViewMediaModule.kt` 中优先新增批量裁切入口：

```kotlin
createPhotoVariants(
  sourcePath: String,
  variants: Array<PhotoVariantRequest>,
  outputFormat: String,
  quality: Int,
  mirror: Boolean
): Array<PhotoVariantResult>
```

如果 Nitro / NativeModule 类型接入成本过高，可先在 JS 侧循环调用现有 `createPhotoVariantForAspect`，但必须在代码中保留 TODO：后续合并为一次解码、多次裁切，减少大图重复解码。

### 7.6 UI 要求

- [ ] 设置页新增“照片输出包”。
- [ ] 拍摄成功 toast：
  - `照片素材包处理中...`
  - 完成后：`已生成 5 张照片素材`
  - 失败时：`部分照片生成失败，已保留主图`
- [ ] Gallery 内成组展示时先显示主图，后续 Phase 4 完善分组。

### 7.7 验收标准

- [ ] 单画面 `current-only` 行为不变。
- [ ] 双画面 `dual-main-sub` 行为不变。
- [ ] `social-photo-pack` 能在系统相册生成多张照片。
- [ ] 失败时至少保留主图，不崩溃。
- [ ] 连续拍摄不阻塞 UI。

---

## 8. Phase 4：Media Asset Index

### 8.1 目标

建立本地媒体索引，把一次拍摄的主图、副图、社交素材包、视频变体、封面按 `captureId` 成组管理。

### 8.2 新增文件

```text
src/types/mediaAsset.ts
src/utils/mediaIndex.ts
src/utils/captureId.ts
```

### 8.3 数据模型

```ts
export type DualMediaType = 'photo' | 'video' | 'cover';
export type DualMediaRole = 'main' | 'sub' | 'vertical' | 'horizontal' | 'square' | 'source' | 'cover';
export type DualMediaStatus = 'processing' | 'ready' | 'failed';

export interface DualMediaAsset {
  id: string;
  captureId: string;
  createdAt: number;
  type: DualMediaType;
  role: DualMediaRole;
  aspect: 'full' | '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  uri: string;
  localPath?: string;
  sourceUri?: string;
  templateId?: string;
  status: DualMediaStatus;
  errorMessage?: string;
}

export interface DualCaptureGroup {
  captureId: string;
  createdAt: number;
  mode: 'single' | 'dual';
  outputPackId: OutputPackId;
  assets: DualMediaAsset[];
}
```

### 8.4 存储方式

优先使用轻量 JSON 文件：

```text
DocumentDirectoryPath/DualViewCamera/media-index.json
```

使用 `react-native-fs` 读写。

要求：

- [ ] 写入前先读旧索引，合并新 group。
- [ ] 保留最近 500 个 capture group，超过后只清索引，不删除系统相册文件。
- [ ] JSON 损坏时自动备份为 `media-index.broken.{timestamp}.json` 并重建。
- [ ] Gallery 查询优先读本地索引；索引为空时回退 `loadDualViewGallery()` 旧逻辑。

### 8.5 UI 要求

- [ ] Gallery 首屏按 capture group 展示。
- [ ] 一个 group 内显示“主图 / 副图 / 竖图 / 横图 / 方图 / 视频”等标签。
- [ ] 支持左右滑动查看 group 内资产。
- [ ] 如果某个资产仍在 `processing`，显示处理中占位。
- [ ] 如果某个资产 `failed`，显示失败标签，后续 Phase 5 支持重试。

### 8.6 验收标准

- [ ] 拍摄一组双画面照片后，Gallery 中只出现一个 capture group。
- [ ] group 内可查看主图和副图。
- [ ] App 重启后索引仍在。
- [ ] 删除或缺失某张系统相册文件时，Gallery 不崩溃。

---

## 9. Phase 5：Media Job Queue

### 9.1 目标

将照片素材包生成、视频副画面转码、封面生成、相册入库统一任务化。

### 9.2 新增文件

```text
src/types/mediaJob.ts
src/utils/mediaJobQueue.ts
src/components/MediaJobIndicator.tsx
```

### 9.3 数据模型

```ts
export type MediaJobType =
  | 'photo-variant'
  | 'photo-pack'
  | 'video-variant'
  | 'cover-generate'
  | 'gallery-save';

export type MediaJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface MediaJob {
  id: string;
  captureId: string;
  type: MediaJobType;
  status: MediaJobStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorMessage?: string;
  retryCount: number;
}
```

### 9.4 实现要求

- [ ] 队列并发数默认 1，避免转码与拍照争抢硬件资源。
- [ ] 照片裁切任务可较快执行，但仍通过统一队列记录状态。
- [ ] 视频转码任务必须失败可恢复：失败后保留主视频，并在 Gallery 中显示“副视频生成失败”。
- [ ] App 前台时显示小型任务状态条：`正在生成副画面视频 35%`。
- [ ] App 后台时不强求继续执行复杂任务；回前台后可继续或标记可重试。
- [ ] 队列状态可持久化，避免 App 杀死后丢失任务记录。

### 9.5 与现有逻辑的迁移

当前 `CameraShell.tsx` 中：

- `saveCapturedPhotoInBackground`
- `finishRecording`
- `createVideoVariant`
- `saveToGallery`

逐步迁移到 `mediaJobQueue.ts`。

第一步不要追求全部迁移。建议顺序：

1. 先迁移副画面视频生成。
2. 再迁移社交照片输出包。
3. 最后迁移相册入库。

### 9.6 验收标准

- [ ] 双画面录像停止后，主视频立即保存。
- [ ] 副视频后台任务显示进度或处理中状态。
- [ ] 副视频失败不会影响主视频。
- [ ] 失败任务可在 Gallery 中触发重试。
- [ ] 连续录制不会同时跑多个重型转码任务。

---

## 10. Phase 6：PiP 可拖拽与模板化布局

### 10.1 目标

把固定 PiP 升级为可拖拽、可吸附、可保存位置的创作布局。

### 10.2 新增 / 修改文件

```text
src/types/composition.ts
src/config/compositionTemplates.ts
src/components/PipController.tsx
src/components/TemplatePicker.tsx
src/screens/CameraShell.tsx
src/utils/settings.ts
```

### 10.3 PiP 拖拽要求

- [ ] PiP 支持拖动。
- [ ] 支持四角吸附：`top-left | top-right | bottom-left | bottom-right`。
- [ ] 默认位置：右上或右下，不能挡住快门和顶部核心按钮。
- [ ] 拖动时不要触发主副切换。
- [ ] 短按 PiP 仍执行主副切换。
- [ ] 位置写入 settings。

建议类型：

```ts
export type PipAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface PipLayoutConfig {
  anchor: PipAnchor;
  scale: 'small' | 'medium' | 'large';
  marginX: number;
  marginY: number;
}
```

### 10.4 模板化布局

第一批模板：

- `pip`：现有画中画。
- `split-horizontal`：左右分屏。
- `split-vertical`：上下分屏。
- `stack`：主图大 + 副图小条。

实现策略：

- [ ] Phase 6 只影响预览布局和输出命名，不强制做合成图片。
- [ ] 照片仍优先输出独立主图 / 副图。
- [ ] 合成拼贴图放到 Phase 9 或后续。

### 10.5 UI 要求

- [ ] 设置页或拍摄页新增“布局”入口。
- [ ] 布局选择用底部 Sheet 或横向 Chip。
- [ ] 每个模板显示小图标或文字预览。

### 10.6 验收标准

- [ ] PiP 拖动不会导致相机重建。
- [ ] PiP 位置重启后保留。
- [ ] 四种模板可以切换，且不影响拍照主链路。
- [ ] 左右 / 上下分屏下，对焦和快门仍正常。

---

## 11. Phase 7：设备能力服务

### 11.1 目标

建立统一的设备能力探测层，让设置页按真实能力显示，避免用户选择设备不支持的选项。

### 11.2 新增文件

```text
src/types/cameraCapabilities.ts
src/utils/cameraCapabilities.ts
src/hooks/useCameraCapabilities.ts
```

### 11.3 能力模型

```ts
export interface CameraCapabilities {
  cameraId: string;
  position: 'front' | 'back';
  hasFlash: boolean;
  hasTorch: boolean;
  minZoom: number;
  maxZoom: number;
  supportsPhotoQualityPrioritization: boolean;
  supportsSpeedQualityPrioritization: boolean;
  supportedVideoQualities: Array<'720p' | '1080p' | '4K'>;
  supportedFpsByQuality: Record<string, number[]>;
  supportsHeifOutput: boolean;
  supportsHevcOutput: boolean;
  supportsDualPreviewStandby: boolean;
  supportsDualPreviewWithPhoto: boolean;
  supportsDualPreviewWithVideo: boolean;
  knownLimitations: string[];
}
```

### 11.4 实现要求

- [ ] 基于 VisionCamera `device` 暴露的信息生成 JS 能力对象。
- [ ] 对 HEIF / HEVC 这类原生能力，必要时由 Kotlin 模块补充。
- [ ] 设置页只展示可用选项。
- [ ] 如果用户之前保存了不可用设置，自动降级并 Toast：`当前设备不支持 4K60，已切换到 4K30`。
- [ ] 双画面模式下如果设备不稳定，自动降级到 30fps / 1080p。

### 11.5 验收标准

- [ ] 前后摄切换后设置项同步变化。
- [ ] 不支持闪光灯的设备不显示照片闪光灯开关，或显示为不可用。
- [ ] 不支持 HEVC 时无法选择 HEVC。
- [ ] 选择高规格录像不会导致相机黑屏或崩溃。

---

## 12. Phase 8：局部特写副画面

### 12.1 目标

利用同源裁切优势，新增“主画面全景 + 副画面局部放大”模式。

### 12.2 功能定义

新增布局：`detail-zoom`

- 主画面：完整构图。
- 副画面：从同一源画面中裁切局部区域，显示 2x 或 3x 特写。
- 用户可拖动副画面取景区域。
- 保存时输出：
  - 主画面照片。
  - 局部特写照片。

### 12.3 新增类型

```ts
export interface DetailZoomConfig {
  zoomScale: 2 | 3 | 4;
  normalizedCenterX: number;
  normalizedCenterY: number;
}
```

### 12.4 实现阶段

第一阶段：静态中心特写

- [ ] 副画面固定显示中心 2x 裁切。
- [ ] 保存副图时按中心 2x 区域裁切。

第二阶段：可移动特写区域

- [ ] 主画面增加一个可拖动的小框，表示特写区域。
- [ ] 副画面实时显示该区域。
- [ ] 取景区域归一化保存到 settings。

### 12.5 技术注意

- 不要用高频 JS 截帧实现实时副画面。
- 预览可以先复用同源第二 PreviewOutput，仅改变容器裁切和 transform。
- 保存必须走原生裁切，保证输出质量。

### 12.6 验收标准

- [ ] `detail-zoom` 模式下主画面和副画面明显不同。
- [ ] 副画面特写保存结果和预览基本一致。
- [ ] 不影响普通 PiP 模式。
- [ ] 不出现 Worklets 相关依赖或红屏。

---

## 13. Phase 9：封面与水印模板

### 13.1 目标

为拍摄内容自动生成可分享封面，增强“拍完即分享”。

### 13.2 第一批能力

- [ ] 自动生成双画面拼贴封面。
- [ ] 支持日期水印。
- [ ] 支持设备 / 分辨率 / 比例小字信息。
- [ ] 支持简单标题：用户可在 Gallery 中编辑。
- [ ] 封面保存为独立 `cover` asset，加入 capture group。

### 13.3 新增文件

```text
src/types/coverTemplate.ts
src/config/coverTemplates.ts
src/utils/coverGenerator.ts
src/components/CoverEditor.tsx
```

### 13.4 初始模板

```ts
export type CoverTemplateId =
  | 'none'
  | 'clean-date'
  | 'dual-card'
  | 'vlog-title';
```

### 13.5 实现策略

- 第一版优先用 React Native SVG 或原生 Bitmap 合成。
- 如果依赖过重，不新增大体积第三方库。
- 先支持照片封面，视频封面可后续从主视频第一帧或主图生成。

### 13.6 验收标准

- [ ] 拍照后能生成封面图。
- [ ] 封面进入 Gallery group。
- [ ] 关闭水印后不生成水印文字。
- [ ] 生成失败不影响主图保存。

---

## 14. Phase 10：双摄并发能力探测与实验隔离

### 14.1 目标

在同源双画面主线稳定后，增加“真双摄并发”的技术预研能力。该阶段只做隐藏实验，不进入正式用户路径。

真双摄并发的目标不是替换当前同源方案，而是新增第二种拍摄源：

```ts
export type DualViewSourceMode =
  | 'same-camera-crop'       // 当前主线：同一摄像头同源裁切
  | 'concurrent-cameras';    // 最后阶段：两个摄像头并发
```

### 14.2 基本原则

- [ ] 当前同源双画面仍然是默认模式。
- [ ] 真双摄并发必须有独立 Native 实现，不要直接用两个 VisionCamera 组件同时抢占 Camera 资源。
- [ ] 真双摄入口默认隐藏，只在 Debug / internal build / developer settings 中显示。
- [ ] 设备不支持时必须完全隐藏入口，并自动回退到同源双画面。
- [ ] 并发失败、热插拔、后台恢复、权限异常都不能影响普通单画面和同源双画面。
- [ ] 真双摄相关代码不得污染 `CameraShell.tsx` 主链路，必须隔离在 `experimental` 或独立模块中。

### 14.3 能力探测

新增：

```text
android/app/src/main/java/com/dualviewcamerav1init/concurrent/
  ConcurrentCameraCapability.kt
  ConcurrentCameraModule.kt
src/native/concurrentCamera.ts
src/types/concurrentCamera.ts
src/experimental/concurrentCamera/
  ConcurrentCameraDebugScreen.tsx
  ConcurrentCameraCapabilityPanel.tsx
```

探测内容：

- [ ] Android API level。
- [ ] `PackageManager.FEATURE_CAMERA_CONCURRENT`。
- [ ] CameraX `ProcessCameraProvider` 是否返回可用 concurrent camera 组合。
- [ ] 可用组合：前摄 + 后摄、后摄广角 + 后摄长焦、后摄广角 + 后摄超广角。
- [ ] 每个组合支持的 UseCase：Preview、ImageCapture、VideoCapture。
- [ ] 预估最大分辨率和帧率。
- [ ] 是否支持 CameraX `CompositionSettings` 或需自定义合成。
- [ ] 是否需要降级到 720p / 30fps。

建议 JS 返回类型：

```ts
export type ConcurrentCameraPair = {
  id: string;
  primaryCameraId: string;
  secondaryCameraId: string;
  primaryFacing: 'front' | 'back' | 'external' | 'unknown';
  secondaryFacing: 'front' | 'back' | 'external' | 'unknown';
  supportedUseCases: Array<'preview' | 'photo' | 'video'>;
  maxPreviewSize?: { width: number; height: number };
  maxVideoSize?: { width: number; height: number };
  supportsCompositionSettings: boolean;
};

export type ConcurrentCameraCapability = {
  supported: boolean;
  reason?:
    | 'api-too-low'
    | 'feature-missing'
    | 'no-camera-pairs'
    | 'camerax-unavailable'
    | 'unknown-error';
  pairs: ConcurrentCameraPair[];
};
```

### 14.4 最小实验 Demo

目标：独立页面验证前后摄并发预览。

- [ ] 新增 `ConcurrentCameraDebugScreen`。
- [ ] 只在开发者设置打开后进入。
- [ ] 显示能力探测结果。
- [ ] 选择一个 camera pair。
- [ ] 启动双预览：主画面 + PiP 副画面。
- [ ] 仅做预览，不保存照片和视频。
- [ ] 打印生命周期日志：bind、unbind、pause、resume、error。

Native 侧建议：

- CameraX `LifecycleCameraController` 不够灵活时，使用 `ProcessCameraProvider` + `ConcurrentCamera` API。
- 将两个预览 Surface 封装在一个原生 View 中，由 RN 只负责容器尺寸和布局参数。
- 不要在 JS 层同时挂两个 VisionCamera View。
- 失败时执行 `unbindAll()`，再通知 JS 回退。

### 14.5 验收标准

- [ ] 默认用户完全看不到真双摄入口。
- [ ] 不支持设备上入口隐藏，App 主链路不变。
- [ ] 支持设备上能进入 Debug 页面并看到 camera pair 列表。
- [ ] 支持设备上至少能完成前后摄并发预览。
- [ ] 退出实验页后，单画面拍照、同源双画面拍照、同源双画面录像仍正常。
- [ ] `npx tsc --noEmit` 通过。
- [ ] Android Debug 构建通过。

---

## 15. Phase 11：双摄并发产品化支持

### 15.1 目标

在 Phase 10 证明设备、CameraX 和 Native View 路径可行之后，最后支持真双摄并发拍摄。该能力作为高级模式开放：

> 同源双画面 = 稳定默认模式；双摄并发 = 设备支持时开放的高级模式。

### 15.2 产品入口

新增拍摄源选择：

```ts
export type CaptureSourceMode =
  | 'same-camera-crop'
  | 'concurrent-front-back'
  | 'concurrent-back-back';
```

UI 规则：

- [ ] 普通模式默认仍是“同源双画面”。
- [ ] 如果设备支持前后摄并发，显示“前后双摄”。
- [ ] 如果设备支持后置多物理摄并发，显示“后置双摄”。
- [ ] 不支持时不显示，不弹错误给普通用户。
- [ ] 首次进入双摄并发时显示简短说明：可能更耗电、发热更高、分辨率可能降低。
- [ ] 双摄并发模式下保留 PiP、左右分屏、上下分屏三种布局。

### 15.3 架构接入

新增独立 Shell，不直接塞进 `CameraShell.tsx`：

```text
src/screens/ConcurrentCameraShell.tsx
src/components/ConcurrentCameraView.tsx
src/hooks/useConcurrentCameraCapability.ts
src/hooks/useCaptureSourceMode.ts
src/native/concurrentCamera.ts
src/types/concurrentCamera.ts
android/app/src/main/java/com/dualviewcamerav1init/concurrent/
  ConcurrentCameraView.kt
  ConcurrentCameraViewManager.kt
  ConcurrentCameraCaptureModule.kt
  ConcurrentCameraVideoModule.kt
```

顶层路由建议：

```tsx
if (captureSourceMode === 'same-camera-crop') {
  return <CameraShell />;
}

return <ConcurrentCameraShell />;
```

避免在同一个巨型 `CameraShell.tsx` 内混合两套完全不同的相机生命周期。

### 15.4 Composition Engine 适配

扩展 `CompositionScene`：

```ts
export type CompositionSource =
  | {
      mode: 'same-camera-crop';
      sourceCamera: 'front' | 'back';
    }
  | {
      mode: 'concurrent-cameras';
      primaryCameraId: string;
      secondaryCameraId: string;
      pairId: string;
    };
```

要求：

- [ ] 同源模式仍基于一帧裁切。
- [ ] 并发模式下主副画面来自不同 camera stream。
- [ ] Gallery 和 Media Asset Index 不关心源类型，只按 `captureId` 成组。
- [ ] 多平台输出包在同源模式和并发模式下都能生成，但并发模式允许降低输出规格。

### 15.5 拍照支持

最小产品化版本先支持：

- [ ] 前后双摄同时拍照。
- [ ] 主摄照片保存为 `role=main`。
- [ ] 副摄照片保存为 `role=sub`。
- [ ] 两张照片使用同一个 `captureId`。
- [ ] EXIF 时间、方向、镜像信息正确。
- [ ] 保存失败时能显示哪一路失败。
- [ ] 如果副摄失败，主摄成功仍可入库，但 group 标记为 `partial`。

建议资产类型扩展：

```ts
export type CaptureSourceMode = 'same-camera-crop' | 'concurrent-cameras';

export type DualMediaAsset = {
  id: string;
  captureId: string;
  sourceMode: CaptureSourceMode;
  cameraId?: string;
  cameraFacing?: 'front' | 'back' | 'external' | 'unknown';
  role: 'main' | 'sub' | 'source' | 'cover';
  status: 'ready' | 'processing' | 'failed' | 'partial';
  uri: string;
};
```

### 15.6 录像支持

录像比拍照复杂，必须分两步做：

#### Step A：双路独立录像

- [ ] 主摄和副摄分别录制独立视频。
- [ ] 两路视频使用同一个 `captureId`。
- [ ] 不要求第一版合成到一个视频文件。
- [ ] Gallery 以组形式展示主视频 / 副视频。
- [ ] 两路任意一路失败时，保留成功一路。

#### Step B：合成视频输出

在 Step A 稳定后再做：

- [ ] PiP 合成视频。
- [ ] 左右分屏合成视频。
- [ ] 上下分屏合成视频。
- [ ] 保留独立原始双路视频，合成视频作为额外产物。
- [ ] 合成走 `MediaJobQueue`，允许后台处理、失败重试。

### 15.7 性能与降级策略

双摄并发必须内置降级：

| 场景 | 策略 |
|---|---|
| 不支持 concurrent camera | 隐藏入口，回退同源双画面 |
| 支持预览但不支持双路录像 | 只开放双摄拍照 |
| 支持双路录像但高分辨率失败 | 自动降到 720p / 30fps |
| 设备发热或帧率不稳 | 提示降低画质，停止副路录制 |
| 后台切回失败 | `unbindAll()` 后重建，并保留同源模式可用 |
| 一路保存失败 | 成组资产标记 `partial`，保留成功产物 |

### 15.8 设置项

新增设置：

```ts
export type ConcurrentCameraSettings = {
  enabled: boolean;
  preferredPairId?: string;
  defaultLayout: 'pip' | 'split-horizontal' | 'split-vertical';
  videoMode: 'dual-files' | 'composited-output';
  maxQuality: 'auto' | '720p' | '1080p';
  allowThermalDowngrade: boolean;
};
```

设置页规则：

- [ ] `enabled` 只有在设备支持时可见。
- [ ] `preferredPairId` 根据能力探测列表生成。
- [ ] `composited-output` 只有 MediaJobQueue 已稳定后可选。
- [ ] 默认 `maxQuality='auto'`。

### 15.9 测试矩阵

必须至少覆盖三类设备：

| 设备类型 | 预期 |
|---|---|
| 不支持 concurrent camera 的 Android 设备 | 入口隐藏，主链路正常 |
| 支持前后摄并发的设备 | 前后双摄预览、拍照可用 |
| 支持前后摄并发且性能较好的设备 | 双路录像可用，必要时降级 |

真机测试用例：

- [ ] 权限首次申请。
- [ ] 单画面拍照。
- [ ] 同源双画面拍照。
- [ ] 同源双画面录像。
- [ ] 双摄并发能力探测。
- [ ] 前后双摄预览。
- [ ] 前后双摄拍照。
- [ ] 前后双摄双路录像。
- [ ] 双摄录像中切后台再切回。
- [ ] 双摄模式退出后回到同源双画面。
- [ ] 低电量 / 高温 / 长时间录制稳定性。

### 15.10 验收标准

- [ ] 不支持设备上无任何用户可见错误。
- [ ] 支持设备上能选择“前后双摄”。
- [ ] 前后双摄预览稳定 5 分钟不黑屏。
- [ ] 前后双摄拍照能生成主 / 副两张照片并按组显示。
- [ ] 双路录像至少支持 720p / 30fps 成功录制和保存。
- [ ] 并发模式失败后可以一键回退到同源双画面。
- [ ] Gallery 能区分 `same-camera-crop` 和 `concurrent-cameras`。
- [ ] `MediaJobQueue` 能处理合成视频任务。
- [ ] 所有 Phase 0 - Phase 9 功能仍通过回归。

---

## 16. Phase 12：双摄并发合成输出与灰度上线

### 16.1 目标

在双摄并发预览、拍照、双路独立录像稳定后，再做最终合成输出和灰度上线。该阶段不是替换 Phase 11，而是将 Phase 11 的 Step B 进一步拆成可发布的任务包。

目标：

- PiP / 左右 / 上下分屏合成视频。
- 灰度开关和开发者开关。
- 崩溃保护、自动降级和自动回退。
- 支持设备上的高级模式入口。
- 不支持设备零打扰。

### 16.2 新增 / 修改文件

```text
src/types/concurrentExport.ts
src/config/concurrentCompositionTemplates.ts
src/utils/concurrentExportJobs.ts
src/components/ConcurrentExportProgress.tsx
src/screens/ConcurrentCameraShell.tsx
src/utils/mediaJobQueue.ts
android/app/src/main/java/com/dualviewcamerav1init/concurrent/
  ConcurrentCameraExportModule.kt
  ConcurrentVideoComposer.kt
```

### 16.3 合成输出模式

第一批只做三种：

```ts
export type ConcurrentCompositeLayout =
  | 'pip-front-back'
  | 'split-horizontal'
  | 'split-vertical';
```

输出策略：

- [ ] 原始双路视频必须保留。
- [ ] 合成视频作为额外 asset 加入同一个 `captureId`。
- [ ] 合成任务走 `MediaJobQueue`，允许失败、重试、取消。
- [ ] 第一版合成目标优先 720p / 30fps，稳定后再开放 1080p。
- [ ] 合成失败不能删除主路/副路原始视频。

### 16.4 灰度与回退策略

- [ ] 新增开发者开关：`enableConcurrentCameraExperimental`。
- [ ] 新增远期预留开关：`forceSameCameraCropMode`。
- [ ] 如果并发模式连续失败 2 次，自动回退同源双画面并提示：`当前设备双摄并发不稳定，已切换为同源双画面`。
- [ ] 如果发热、内存、编码失败频繁出现，自动降低到 720p / 30fps。
- [ ] 不支持设备不显示入口，不弹错误。
- [ ] 支持设备首次进入显示说明：双摄并发更耗电、可能发热、部分机型仅支持较低分辨率。

### 16.5 验收标准

- [ ] 双摄并发合成视频作为额外 asset 出现在 Gallery group 中。
- [ ] 合成失败时主/副双路原始视频仍可播放。
- [ ] 不支持设备入口隐藏。
- [ ] 支持设备可以手动关闭双摄并发，回到同源双画面。
- [ ] 连续 5 次双摄预览进入/退出不影响普通相机。
- [ ] 连续 3 次双路录像 + 合成任务不出现崩溃。
- [ ] `npx tsc --noEmit` 通过。
- [ ] `:app:assembleDebug` 通过。
- [ ] 所有 Phase 0 - Phase 9 同源功能仍通过回归。

---

## 17. 推荐文件改动顺序

Codex 执行时建议严格按以下顺序小步提交：

1. `src/types/composition.ts`
2. `src/utils/composition.ts`
3. `src/__tests__/cameraUtils.test.ts`
4. `CameraShell.tsx` 只替换构图派生逻辑
5. `CompositionOverlay.tsx`
6. `SettingsModal.tsx` 增加安全框设置
7. `utils/settings.ts` 持久化新增设置
8. `types/mediaAsset.ts`
9. `utils/mediaIndex.ts`
10. `GalleryModal.tsx` 分组展示
11. `types/mediaJob.ts`
12. `utils/mediaJobQueue.ts`
13. `MediaJobIndicator.tsx`
14. `CameraShell.tsx` 逐步迁移保存 / 转码逻辑
15. `compositionTemplates.ts` 和模板 UI
16. `cameraCapabilities.ts` 能力服务
17. 局部特写
18. 封面水印
19. 实验真双摄

---

## 18. 不建议现在做的事项

- 暂不重构到 Redux / Zustand，当前状态集中在 `CameraShell.tsx` 虽大，但相机链路敏感，先用局部 hook 和 utils 拆分。
- 暂不引入 Worklets 作为实时帧处理路径。
- 暂不做云端 AI、登录、社区、会员。
- 暂不做 iOS 适配。
- 暂不一次性把所有相机逻辑拆完；要以“不破坏拍摄主链路”为第一原则。
- 暂不把副画面合成进同一个视频画面；当前仍优先主/副独立输出，合成视频作为后续高级功能。

---

## 19. Codex 每次任务的输出格式

每完成一个阶段或子任务，请在 `codex.md` 追加：

```markdown
## YYYY-MM-DD 升级记录

### 本次目标
- ...

### 修改文件
- `src/...`
- `android/...`

### 关键实现
- ...

### 验证结果
- [ ] `npx tsc --noEmit`
- [ ] `npm test -- --runInBand`
- [ ] `:app:assembleDebug`
- [ ] 真机单画面拍照
- [ ] 真机双画面拍照
- [ ] 真机双画面录像

### 已知问题
- ...

### 下一步
- ...
```

---

## 20. 第一轮 Codex 可直接执行的任务包

以下是建议给 Codex 的第一轮任务，不要一次性让它实现全部计划。

### Task 1：建立 Composition Engine 类型和测试护栏

目标：不改 UI、不改保存行为，只新增类型、工具函数和测试。

执行：

- [ ] 新增 `src/types/composition.ts`。
- [ ] 新增 `src/utils/composition.ts`。
- [ ] 把现有 `visibleFrameSpec` 组合逻辑封装成 `buildCompositionScene()`。
- [ ] 新增 `src/__tests__/cameraUtils.test.ts`。
- [ ] 为构图比例和方向写测试。
- [ ] 不删除现有逻辑，先让新函数测试通过。

验收：

```powershell
npx tsc --noEmit
npm test -- --runInBand
cd android
.\gradlew.bat :app:assembleDebug --console plain --stacktrace
```

### Task 2：用 Composition Engine 替换 CameraShell 派生构图逻辑

目标：行为不变，降低 `CameraShell.tsx` 构图复杂度。

执行：

- [ ] 在 `CameraShell.tsx` 调用 `buildCompositionScene()`。
- [ ] 用 scene 输出替换 `mainFrameSpec`、`subFrameSpec`、`saveMainFrameSpec`、`saveSubFrameSpec`。
- [ ] 保留现有拍照 / 录像保存入口。
- [ ] 手工检查主副切换、横竖方向、双画面保存。

验收：

- 单画面拍照行为不变。
- 双画面拍照主副构图不变。
- 双画面录像主副输出不变。
- 后台恢复不冻结。

### Task 3：安全框 Overlay

目标：增加可关闭的安全框，不改变拍摄输出。

执行：

- [ ] 新增 `CompositionOverlay.tsx`。
- [ ] 新增设置 `safetyOverlayMode`。
- [ ] 在主预览和 PiP 预览上叠加安全框。
- [ ] 设置页增加入口。
- [ ] 确认 `pointerEvents="none"`。

验收：

- 安全框可显示、可关闭、可持久化。
- 不影响对焦、缩放、PiP 点击。
- 录像中不会明显卡顿。

---

### Task 4：补全文档与设置页文案修正

目标：先修正文档/文案与当前能力不一致的问题，避免用户和 Codex 误判产品能力。

执行：

- [ ] 更新设置页关于文案，把“同时采集”改为“同源双构图输出”。
- [ ] 在 `codex.md` 当前实现说明中补充：双画面待机是 `Preview + Preview + Photo`，录像态是 `Preview + Video`。
- [ ] 保留 `agents.md` 的历史记录，但追加“不要直接作为唯一事实源”的说明。
- [ ] 不改任何相机业务逻辑。

验收：

- `npx tsc --noEmit` 通过。
- Android Debug 构建通过。
- App 内文案不再暗示当前已经支持前后双摄并发。

### Task 5：设备能力服务最小闭环

目标：先不要做复杂 UI，只把设置页硬编码能力选项收口到统一模型。

执行：

- [ ] 新增 `src/types/cameraCapabilities.ts`。
- [ ] 新增 `src/utils/cameraCapabilities.ts`。
- [ ] 从 VisionCamera `device` 生成基础能力对象。
- [ ] 设置页接收 `capabilities` 参数。
- [ ] 先禁用不可用选项，后续再隐藏。

验收：

- 前后摄切换后能力对象更新。
- 不支持项不会被保存为当前设置。
- 旧设置如果不可用，会自动降级。

---

## 21. 最终产品验收清单

升级计划完成后，产品应具备：

- [ ] 用户能选择单画面 / 双画面。
- [ ] 用户能看到真实裁切安全框。
- [ ] 用户能一次拍摄生成主副图。
- [ ] 用户能一次拍摄生成社交素材包。
- [ ] Gallery 能按一次拍摄分组显示。
- [ ] 视频副画面转码有任务状态。
- [ ] 失败任务可重试或明确失败。
- [ ] PiP 可拖动、可吸附、可保存位置。
- [ ] 可切换至少 3 种布局模板。
- [ ] 设置页按设备能力动态显示选项。
- [ ] 局部特写模式可用。
- [ ] 封面 / 水印至少有一个可用模板。
- [ ] 支持设备上可启用前后双摄并发拍照。
- [ ] 支持设备上可启用前后双摄双路录像，至少 720p / 30fps。
- [ ] 支持设备上可生成双摄 PiP / 分屏合成视频。
- [ ] 不支持设备自动隐藏双摄并发入口。
- [ ] 所有新增功能都不破坏既有主链路。

---

## 22. 一句话原则

先把“同源双画面”的裁切、输出、媒体管理做成稳定的创作系统，最后再把“双摄并发”作为设备支持时可用的高级模式接入。当前阶段最重要的不是炫技，而是让用户每次按下快门都能稳定得到一组可直接分享的素材。
