# Primuse 专辑页预览 / Primuse album preview

`0.8.5.2-preview.9` / Android `versionCode 141`，2026-11-02。

## 选择 / Selection

**设置 → 外观 → 专辑页风格 → Primuse**。这是独立专辑页样式，可与现有 Apple Music／Spotify 全局样式搭配；既有艺人页布局、Volta 和 Minidisc 继续可选，已保存的选择不自动覆盖。

**Settings → Appearance → Album page style → Primuse** selects the preview. Existing explicit choices are retained.

## 参考与范围 / Reference and scope

参考 `chenqi92/primuse` 的 `294e3f5`，重点为 `AlbumDetailView`、`CoverTintProvider`、`ThemeService`、`ArtworkAccentPixelPolicy` 和 `LibraryDetailTintPolicy`。MIT 声明保存在 `licenses/PRIMUSE-MIT.txt`。本轮适配顶图、背景、取色、专辑名和艺人的字号／字重／间距，沿用本 App 的曲目、艺人导航、封面查看、播放／暂停、随机播放、收藏和下载。

The implementation adapts Primuse's album composition and color policy in React Native/Kotlin. Native SwiftUI code is not directly executed on Android.

- 竖屏190dp居中封面、14dp圆角、顶部安全区加52dp；标题22dp／700、艺人15dp／600，身份行间隔6dp。横屏使用88dp封面并避开Android固定顶栏；辅助字号改为竖向排列。背景中心使用实际封面测量位置。
- 完整原图本地解码后，以40×40像素和24个色相桶提取Primuse主色；整页色调按其专辑HSB规则与深浅模式重新映射，渐变停点0／0.42／1。
- 同封面一次生成低分辨率静态模糊背景，采用原布局20dp相对模糊、1.25饱和度、RGB×0.5，带透明Gaussian halo并按实测页头高度渐隐；滚动只做UI线程位移。
- 封面、背景和色调完整就绪后统一显示。错误、离线缺图、晚到回调与资源释放有明确终态；沿用页面图片lease与列表回收宿主。
- Mini Player、底栏玻璃参数及播放器未修改。原工作副本中的缓存修复随本包保留；无关工作文件与本轮起始快照字节一致（排除明确属于本轮的文件）。

Android／CoreGraphics图像采样、8位主色量化和Gaussian近似存在平台差异，不宣称逐像素等同SwiftUI。

## 验证 / Validation

1151项自动化测试全部通过；类型、翻译检查通过。原生SDK36编译与8项独立像素测试通过，Scene生命周期和列表状态／回调检查通过。14组调色结果与独立运行的Primuse Swift算法一致，另检查686个色样的深浅模式可读性。这些不能代替三星的实际解码、显示、滚动帧率或长时内存验证。

Gradle release构建成功。最终ARM64 APK为 `artifacts/Resonus-Glass-v0.8.5.2-preview.9-code141-arm64-v8a.apk`，45,831,908 bytes，SHA256 `105fbdd8efec157760f403e6fd859f2ed5edc4e641646f5e79952354d96e6173`。包名 `com.zskruc.resonus.glasspreview`，签名与140一致。824项冻结输入无漂移；30个变更生产JS／TS与实际Hermes打包内容逐字一致；新原生方法与三个类经R8映射核实存在于DEX。详见本轮本地artifact141.json。旧140及稳定别名未覆盖。

本轮尚未安装或实机测试，等三星连接后进行；未提交GitHub或发布release。
