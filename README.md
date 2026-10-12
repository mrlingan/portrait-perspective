# Portrait Perspective — v0.4

Photoshop UXP 自拍局部比例与双颊优化插件。manifest v5、JavaScript、Photoshop DOM / Imaging API，没有 CEP、ExtendScript、外部服务或 npm 运行时依赖。插件 ID 保留原值，本次新增菜单命令，旧版本升级需先恢复结果，再在 UDT Unload → Load；后续普通代码更新可 Reload。

v0.4 新增图片点选定位窗口：两点画框后自动放大人脸，引导记录八个位置，支持重记、撤销和取消。已有 v0.3 的肤质/色调真实处理继续保留。**仍需手动记录关键点，不是自动人脸检测或完整三维透视还原，也尚未完成与参考 After 的效果匹配验收。**

## 实际功能

| 功能 | 实现与条件 |
| --- | --- |
| 人脸框与关键点 | 推荐直接在图片预览中点选；也可读取 Photoshop 选区或输入归一化 JSON |
| 定位窗口 | 两角画框、自动放大、八点编号、指定位置重记、撤销、取消；完成前仅保存窗口草稿 |
| 脸宽 | 椭圆范围局部逆映射，完整定位时保护五官；只有脸框时保留最小演示并提示 |
| 脸颊、下颌 | 成对局部轻微位移；需完整五官及各自轮廓点 |
| 鼻部、眼部 | 基于实际锚点和眼距的微量局部缩放；眼部默认 0，不改变嘴型 |
| 肤质 | 双颊颜色通道的边缘感知平滑，保留原亮度细节；不去痘、不消除皱纹、不做全脸磨皮 |
| 色调 | 从双颊采样中位数与亮度分位数，轻提局部暗部、压亮部；不设置固定白肤色或全图曝光 |
| 图层 | 保留源图层，结果组内 Geometry / Skin / Tone 累计像素快照；只创建实际产生变化的肤质/色调层 |
| 预览、应用、恢复 | 从源图重新生成，替换上次结果；modal/history 事务；恢复仅移除本会话拥有的结果 |
| 自动检测、皮肤/头发语义分割 | 未实现；FaceAnalyzer adapter 可以替换 |

Reference Style：整体 **35**、脸宽 **-12**、脸颊 **-8**、下颌 **-6**、眼部 **0**、鼻部 **-4**、肤质 **30**、色调 **20**。这是保守起点，尚未经参考图配准标定。当前只有一组分辨率不同的参考，观察见 [reference-analysis.md](docs/reference-analysis.md)。不能将两张图的像素尺寸差当作头部缩小量。

肤质/色调均乘整体强度。很小的变化可能低于 8 位像素精度；此时会提示未产生变化，不创建无效果的快照。需要验证控件时可暂时提高整体和对应强度，再回到自然幅度。

## 获取源码与许可证

完整源码、测试脚本和验证记录使用 [MIT License](LICENSE) 开源。参考人像照片不随仓库分发；文档只保留需求观察及验证结论，不包含原始照片或个人关键点数据。Photoshop 和 UXP Developer Tool 需自行安装，Adobe 产品及商标归 Adobe 所有。

```sh
git clone https://github.com/mrlingan/portrait-perspective.git
cd portrait-perspective
node scripts/check.js
node --test tests/*.test.js
```

本仓库根目录即插件目录，在 UXP Developer Tool 中选择根目录的 `manifest.json`。`package.json` 的 `private: true` 只防止误发布到 npm，不影响 GitHub 开源或本地 UXP 加载。

## 加载与测试顺序

1. 从 v0.3 升级：先“恢复”旧处理组，UDT **Unload → Load**，让宿主读取新增菜单入口。只 Reload 旧 manifest 注册可能出现 command portraitLocator 找不到；卸载后加载即可。首次使用则 Add Plugin 选择本目录 manifest.json，再 Load。
2. 打开 Photoshop 25.0+ 的 RGB 8 位照片，选择原始顶层普通像素/背景图层。有本会话处理结果时先恢复，再重新定位。
3. 点击面板“在图片上点选定位”，或直接从 Photoshop **增效工具 → Portrait Perspective → 图片点选定位…** 打开。菜单命令无需先找到浮动面板。
4. 在照片上点脸框左上和右下两角，覆盖额头至下巴、左右脸缘，留少量余量；完成后自动放大人脸。重画框会清空窗口草稿中的旧点，完成/取消前不改变原面板输入。
5. 按蓝色提示依次点 **画面左眼、右眼、鼻尖、嘴中心、左脸颊、右脸颊、左下颌、右下颌**。左右按画面方向。脸颊点应低于鼻尖，下颌点低于嘴中心，各点位于脸缘内侧，避开背景。点选是真实人工输入，不是模型检测。
6. 可用“完整图片 / 放大人脸”切换视野；上方位置按钮用于重记；“撤销点选”恢复上一次点选与步骤。完成八点后点击“完成定位”写回面板。取消或 Esc 保留原输入，定位预览不会上传或落盘。
7. 点击“分析人脸”，再“预览”。完成点选会绑定当时的文档/源图层；选择另一源层时需重新定位。改脸框或关键点需要恢复已有结果后重新分析。
8. 原选区流程继续可用：用矩形选框框住人脸并读取；逐次小选框对准特征，点击对应记录按钮。JSON 以整幅画面的 0–1 坐标保存，不随定位窗口缩放变化。
9. 切换结果组可见性比较原图。Tone 包含 Geometry + Skin + Tone，Skin 包含 Geometry + Skin；先隐藏 Tone，再隐藏 Skin 查看各阶段。它们是累计的不透明像素快照，不是独立调整层。
10. 验证几何时脸宽设 0，分别调鼻/脸颊/下颌；负值收窄、正值放宽，眼部正值微量放大。验证肤质/色调时将几何设 0，整体及对应控件可暂设 100，观察后降至自然幅度。新定位功能不改变 v0.3 的保守处理上限。
11. “应用”从源图重新生成、替换预览，不累计变形。“恢复”只移除本会话拥有的组。用 Photoshop Undo/Redo 检查每次处理、恢复为单个历史步骤。
12. 整体设 0 应生成与源像素一致的 Geometry 副本。无文档打开定位/分析应显示提示；给结果组添加用户图层后恢复应拒绝误删。

插件不会自动保存或覆盖 JPEG。定位窗口显示小尺寸 JPEG 预览，其显示颜色/压缩与 Photoshop 画布可能有细微差别；处理依然读取原图全分辨率和原配置，不把缩略图写入结果。

## 算法与限制

- 几何半径/位移、双颊遮罩及肤质采样半径均由 faceWidth、faceHeight、eyeDistance 和实际 landmarks 归一化计算。邻域取整只是采样到像素网格，无固定图片坐标。
- 所有几何场合并成一次逆映射与双线性采样，嘴部核心保持恒等。脸颊/下颌最大单个平移幅度为脸宽的 1.2% × 整体强度。
- 肤质/色调使用两个从鼻尖至左右脸颊点之间生成的平滑椭圆区域，眼/眉、鼻、嘴有保护核心，遮罩跟随几何逆映射。**这是保守双颊区域，不是皮肤分割**：错误点选、脸缘发丝、胡须、遮挡仍需检查，不处理额头或全脸。
- 肤质使用脸宽 1.2% 的采样半径、双边亮度/色度权重和自适应颜色置信度。滤波增量移除亮度分量后再混合；通常保留输入的 sRGB 编码亮度细节，8 位取整允许误差，极端通道裁切可能改变亮度。不会宣称保留所有物理频率或移除所有瑕疵。
- 色调依据采样 p10/中位数/p90 决定暗部提升和亮部压缩，等量加到 RGB 三通道，尽量维持颜色通道差。统计采用 sRGB 编码亮度估计，不是线性光物理亮度。
- **新肤质/色调仅支持明确标记 sRGB IEC61966-2.1 的像素**。其他/未知 profile 会跳过并提示，保留原 profile；不把 P3 或 Adobe RGB 按 sRGB 解释，也不隐式转换整张图。几何仍在原 profile 中运行。
- 前向姿态约束：双眼连线倾斜 ≤15°、眼距为脸宽 20%–80%、鼻低于双眼、嘴低于鼻，左右轮廓点位于中心两侧；不检测真实偏航/遮挡，也无法证明手动点选正确。
- Photoshop 25.0+；RGB 8 位、全不透明、覆盖画布的顶层普通像素层，正常混合、100% 不透明度与填充。源图保留原名与内容，不强制改名为 Original。
- 不支持智能对象、嵌套源层、透明像素、蒙版、样式、智能滤镜、顶层剪贴关系；不自动栅格化原图。只复制所选源层，不合并其他层；更上方内容可能遮挡结果。
- 文档及源图层上限 2400 万像素。尚未分块；完整缓冲及最多三层快照会占用较多内存，大图需等待。取消检查位于计算行批次之间，异常通过 history 事务回滚。
- 分析后移动/变形/重绘源图需要恢复后重新定位；同尺寸内容变化无法自动发现。会话在内存中；**Reload/卸载前先恢复结果**。重载后不自动接管旧组，旧组可在 Photoshop 手动整理，勿把旧结果当原图重复处理。

## 工程结构与职责

| 文件 | 职责 |
| --- | --- |
| manifest.json、index.html、styles.css | UXP 入口、面板与说明 |
| index.js、src/ui/controls.js | 控件、忙碌锁、状态、输入与文档绑定 |
| src/controller.js | 分析、阶段执行、结果所有权、预览替换与恢复 |
| src/photoshop/document.js | 宿主文档约束、executeAsModal、history commit/rollback |
| src/photoshop/layers.js | 复制分组、累计阶段副本、所有权与安全删除 |
| src/photoshop/warp.js | Imaging API 读写、profile 保留、缓冲 dispose、进度/取消 |
| src/face/FaceAnalyzer.js、FaceMetrics.js、ManualInput.js | 可替换 adapter、统一结构、校验、选区/归一化点记录 |
| src/face/LocatorSession.js | 独立于宿主的点选草稿、步骤、撤销、视野映射 |
| src/ui/locator.js | 定位对话框、编号覆盖层、缩放与取消/完成 |
| src/photoshop/thumbnail.js | modal 中读取有尺寸预算的显示预览、JPEG 编码与缓冲释放 |
| src/processing/geometry.js、resample.js | 局部逆映射、保护区、全分辨率采样 |
| src/processing/faceMask.js | 跟随形变的双颊支持区域与五官保护 |
| src/processing/color.js | sRGB 守卫、统计、区域与颜色置信度 |
| src/processing/skin.js、tone.js | 实际肤质/自适应局部明暗计算，无 Photoshop 引用 |
| src/processing/parameters.js、pipeline.js | 参数、预设、各阶段计划与跳过原因 |
| src/log.js | Console 日志 |
| scripts/check.js、scripts/host-check.js | 静态检查与真实宿主合成图检查 |
| tests/*.test.js | 算法、归一化、保护、源数据、取消与模拟事务测试 |
| docs/reference-analysis.md、verification-v02.md、verification-v03.md、verification-v04.md | 参考判断与分版本验证证据 |

FaceAnalyzer(adapter) 接受异步 analyze({image, manual, ...})，adapter 返回文档像素坐标的 bounds、landmarks、provenance，再统一计算 metrics。按钮 JSON 使用整幅图归一化 0–1 坐标。缺失点为空数组、eyeDistance 为 null，不制造检测数据。chin 合约保留但当前处理不使用。后续 MediaPipe/ONNX/本地或服务端 adapter 不需要修改 Photoshop 操作层。

## 检查及宿主验证

无需安装依赖：

```sh
node scripts/check.js
node --test tests/*.test.js
```

v0.4 静态检查通过（manifest、21 个运行时 JS、require 路径、38 个 HTML ID）；36 项测试通过。新增图片点选流程、放大坐标往返、取消草稿隔离、撤销重记、缩略图只读与编码失败时 dispose；既有测试继续覆盖肤质纹理/色度检查、分辨率与形变跟随、双颊外像素保护、色调自适应、profile 跳过、取消、三阶段预览/恢复及最后阶段写入失败回滚。

历史验证：2026-10-08，实际 Photoshop 27.0.0 通过 UDT 重载 v0.3。专用 320×400 sRGB 合成图宿主检查输出 PORTRAIT_HOST_CHECK_PASS（documentID 102）：Geometry / Skin / Tone 各阶段逐 RGB 与 CPU 结果一致、源图不变、应用替换、恢复与历史还原。模拟宿主测试不代替 Adobe 宿主验证。更早版本记录见 verification-v02.md；v0.3 照片验证见 verification-v03.md。v0.4 已在真实宿主从新增菜单启动定位，使用真实鼠标完成两角与八点、撤销、完成，再接入分析/三阶段处理；最新记录见 [verification-v04.md](docs/verification-v04.md)。

可在此插件的 UDT Console 运行（仅创建自己的未保存测试文档，不修改已有照片）：

```js
require('./scripts/host-check.js').run().catch(console.error)
```

宿主写入依赖的 API 已核查官方文档：[Layer](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer)、[Imaging](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging)、[executeAsModal](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal)、[Document](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/document)。batchPlay 仍仅用于 DOM 不足的图层 get 与兼容 PS 25 的 select；没有编造液化 API 或调整层 descriptor。显示预览用官方 encodeImageData，定位窗口用 [UXP dialog](https://developer.adobe.com/uxp/guides/how-to/add-modal-dialogs/)；窗口事件使用 clientX/Y 与元素 getBoundingClientRect，缩放仅作用于显示视野。真实宿主曾发现删除组容器会留下子层，现先验证所有权并删除全部阶段层，再移除空组。

## 后续缺口

真正自动 landmarks、无脸/多人/遮挡与姿态判断；皮肤/头发语义分割；更完整的局部网格与透视估计；全脸肤质及色彩管理；参考图同尺寸配准与第二组共性标定；分块、大图和更多源图层类型；持久化参数、独立调整图层/蒙版及最低宿主版本验证。
