# 内存与详情页整体显示测试版 / Memory and detail-scene preview

`0.8.5.2-preview.2` · Android `versionCode 134` · 本地测试包，未作为正式 Release 发布。

## 本次修正

- 普通艺人／专辑入口精确检查页面类型与 ID。相同页面已在当前普通导航历史中时，定量返回该页面，保留其 key、参数和滚动状态；真正的新内容继续新开。不跨过播放器、歌词或队列等模态页面，也不采用会重新排列 Screen 的 singular/name-only 方案。
- 批量艺人缓存仍把资料与高清封面保存到本地，仅更新已有的精确 UI 查询。未打开的艺人不再额外创建详情／简介两份内存查询。
- 原始封面调色板上限 256，归一化颜色上限 1024，单个播放器的动画封面标记上限 256。进行中的读取单独管理；深浅模式共用原始取色。Minidisc 保留 64 项种子，低精度取色不覆盖播放器结果。
- 艺人式 Artist／Album／Playlist 页的高清图与模糊层并行准备，取消各层独立淡入。主图、模糊与页面内容由同一个就绪状态一起显示。等待较久时提供可返回的加载提示；原有页面状态保持挂载。
- 保留转场前后图片资源的联合租约，转场结束后再退休旧图；不根据焦点变化提前拆除模糊层。播放器布局、玻璃参数和已下载文件保持原设置。

## 内存证据与限制

132 实机匹配导航测试中，深层历史中的 Views 随重复页面数量增加，返回首页后能释放。原生分配在两次短时空闲检查中为 504,670／606,569KB，更长空闲后降为 467,997KB；这部分峰值不能直接判定永久泄漏。

Unknown 必须结合 SwapPss 判断。该项初始合计约 173,104KB，末次约 165,861KB；只看驻留 PSS 会把换页读回误当成对象新增。总 PSS 已包含换出部分，不重复相加。

首次原生调用栈采集因共享缓冲区溢出，在约 1.3 秒结束，早于匹配检查点，因此不用于分配归因。更大缓冲区、较粗采样的配置已单独准备；不根据无效跟踪猜测某个渲染库泄漏。

本版针对源码已确认的重复页面与缓存容量点修正；不同内容的正常历史状态、Glide 解码缓存和运行时高水位仍有各自的生命周期。不能以测试或代码修改代替长期原生内存稳态验收，也不宣称任意长时间持续 120fps。

## 133 实机复测与 134 的原生退出修正

133 在两轮各 12 对艺人／专辑循环中，4／8／12 对的 Views 分别为 2578／2406／2404 与 2578／2406／2406，不再逐层堆积；回首页空闲后的 Views 均为 1269，Bitmap 分配为 217,756／217,760KB。原生分配仍有约 23.3MiB 的短时基线差异，不能据此声称所有底层增长已解决。第二份原生堆记录也出现采样中断，只采用可证明完整的时间段，不把丢失尾部当作未释放对象。

133 的退出录像确实仍有错误：原生导航为了完成淡出，会继续绘制已经从逻辑子列表移走的内容；旧遮罩补丁此时清空最后一份渐变位图，短暂露出没有遮罩的矩形。134 修正 MaskedView 的 startViewTransition／endViewTransition 生命周期，仅在原生退出期间保留最后有效遮罩；结束或实际 detach 后清理。普通被覆盖页面的图片退休仍即时回收，不采用固定延时或永久保存页面截图。

## 自动检查

1036 项应用测试、规范 ID 检查、TypeScript、翻译检查及所改生产文件 ESLint 已通过。真实 StackRouter 测试覆盖 24 轮艺人／专辑循环不再增加重复历史；真实 QueryClient 验证 1915 位未打开艺人不会新增 UI 查询；真实 React 覆盖统一就绪、状态保留、旧回调、租约重获和加载退出。新增原生 Java 回归直接编译实际安装的 MaskedView 源码，模拟移除子元素后继续绘制的退出顺序。134 ARM64 原生构建与签名核验通过，已覆盖安装到三星。生产源码与最终 bundle 一致，实际 APK DEX 也已确认包含新的 mask 转场方法与释放路径。原生生命周期回归通过 400 项断言；同一测试对旧实现准确复现了失败。

134 实机检查包含艺人、专辑、歌单的系统返回和实际左上角返回按钮。首段录像审阅 46 个退出画面，未再看到 133 的无遮罩矩形；补充按钮录像也未复现。专辑过渡的编码采样较稀，不能据此承诺所有中间帧或持续 120Hz。12 轮艺人／专辑循环的 Views 为 2569／2397／2397（4／8／12轮），回首页后图片仍可释放；未见新的 fatal、OOM、ANR 或失效图片句柄标记。手机已恢复 30 秒息屏与关闭充电常亮。

APK：`Resonus-Glass-v0.8.5.2-preview.2-code134-arm64-v8a.apk`，45,718,440 bytes，SHA-256：`f3f165287dad1084e5d8e16e5ff07ff026cdc5ee003f4b61ca0ca6340fe38dd9`。构建源码提交 `d09776b50dbc7be9c1864fe33f1830e2bfff49eb`；后续仅补充验证文档。

原始设备帧、账户日志、参考图片和跟踪文件只保留在本地，不随源码发布。

## English

The follow-up code 134 preview also pins the last valid mask only through an actual native removal transition, preventing the unmasked rectangular flash seen in code 133 while retaining detach cleanup. This local ARM64 preview reuses exact artist/album ancestors with targeted POP actions, without reordering screen keys or crossing player-related modals. Bulk artwork work persists metadata to disk without creating unseen UI queries. Small completed artwork caches now have explicit capacities and shared in-flight ownership.

Artist-style detail pages prepare their sharp image and blur field concurrently and reveal the full scene together. Existing layout and glass profiles are retained, as are page state and transition resource leases. All 1036 tests, canonical-ID, type, translation and scoped lint checks pass. The rejected early heap trace is not used for allocation attribution; native high-water behavior and indefinitely long sessions still require scoped device validation.
