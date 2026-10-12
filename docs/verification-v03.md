# v0.3 验证记录

日期：2026-10-08。宿主：Adobe Photoshop 27.0.0，官方 UXP Developer Tool。插件：0.3.0。

## 本次修改

- 新增 src/processing/faceMask.js：关键点双颊支持区，五官核心保护，跟随几何逆映射。
- 新增 src/processing/color.js：明确 sRGB profile 守卫、自适应采样、颜色置信度与缓冲工具。
- 将 skin.js、tone.js 从 placeholder 改为实际处理；保留编码亮度纹理的颜色平滑、局部明暗平衡。
- controller.js、photoshop/warp.js、layers.js 支持累计 Geometry / Skin / Tone 快照、多个阶段所有权、整组替换/恢复、进度与取消。
- UI 启用肤质/色调滑块，说明累计快照；无实际 8 位变化时提示并不创建该层。
- 更新 manifest/package 至 0.3.0，沿用原插件 ID；更新 README 与真实宿主检查；新增 tests/color.test.js 并扩展模拟事务测试。

## 静态及自动测试

manifest v5、18 个运行时 JS 语法与 require 路径、24 个 HTML ID 检查通过。28 项 Node 测试全部通过。

新增验证包括：遮罩分辨率归一化、几何跟随、五官保护核心、肤质的色度误差下降与编码亮度纹理保留、双颊外字节不变、alpha/源缓冲不变、色调提升暗部/压亮部而不设固定白肤色、零强度、未知/P3/Adobe RGB 跳过、有效采样不足、取消传播，以及三层预览替换/恢复/Undo 所有权、最后一层写入失败时回滚至上次结果。

模拟测试验证代码行为，不证明 Adobe API 或人像审美效果。

## 实际 UDT / 合成图

UDT 两次显示 Plugin Reload Successful，Console 确认 v0.3 初始化与面板 show 执行；最终重载版本包含无像素变化的明确提示。

scripts/host-check.js 新建专用 320×400、RGB 8 位、sRGB 文档，documentID 102。真实输出：

```json
{"documentID":102,"width":320,"height":400,"localControls":"PASS","skinToneStages":"PASS","imagingRoundTrip":"PASS","sourceUnchanged":"PASS","replacePreview":"PASS","reset":"PASS","historyRestore":"PASS"}
```

检查分别读取 Geometry、Skin、Tone，逐 RGB 通道与各 CPU 计算结果一致。三个阶段确实改变像素，顶部顺序为 Tone / Skin / Geometry。应用替换预览、重复生成一致、恢复仅剩原图、activeHistoryState 往返均通过。Layer.duplicate 的同组父层行为已在此实际宿主验证；删除时先删除受本会话所有权验证的全部子层，再移除空组。

该合成文档测试后关闭，没有保存或修改已有照片。取消和写入失败的完整回滚仍仅由模拟宿主验证，尚未在真实 Photoshop 人为注入所有失败情况。

## 用户参考原图

使用用户给出的第一张 768×1024 自拍，documentID 95，原始背景层 ID 1。输入使用目视近似的手动八点，明确不是自动检测，也没有将这些测试坐标写入插件核心算法。

先试默认 Reference Style：肤质和色调都低于本张照片的 8 位量化变化阈值，没有生成对应层。已加入对此情况的明确提示，不谎称其产生效果。单独以整体/肤质/色调 100 的 CPU 诊断确认两项处理可以产生变化，不向源图层写入。

最终通过面板事件生成三阶段预览，参数：

```json
{"strength":65,"faceWidth":-12,"cheek":-8,"jaw":-6,"eyes":0,"nose":-4,"skin":80,"tone":80}
```

实际日志 REFERENCE_V03_PASS：

```json
{"documentID":95,"parameters":{"strength":65,"faceWidth":-12,"cheek":-8,"jaw":-6,"eyes":0,"nose":-4,"skin":80,"tone":80},"sourceUnchanged":true,"stages":{"Skin":{"changedPixels":80,"changedOutsideMask":0},"Tone":{"changedPixels":2054,"changedOutsideMask":0}}}
```

Skin 与 Geometry 比较、Tone 与 Skin 比较，RGB 差异像素分别为 80 和 2054，双颊遮罩外均为 0。原始背景层与运行前缓冲逐字节一致。这些计数证明实际处理发生和支持范围正确，**不代表改善程度或参考匹配率**。

Photoshop 截图确认原自拍与三层快照可见。实际 Command+Z 一次移除整个三阶段预览，仅余背景；Command+Shift+Z 恢复同一结果。最终保留 Portrait Correction [Preview]（组 ID 9，Geometry ID 8、Skin、Tone），未保存或覆盖 JPEG，供用户逐层隐藏比较。

## 仍需验收

完整面板视觉布局、更多人物肤色/胡须/遮挡/姿态、真实宿主全部取消/故障路径、最低 Photoshop 版本、大图性能；与 After 同尺寸配准后的定量与主观效果。自动 landmarks、语义皮肤分割、完整相机透视还原、全脸肤质与非 sRGB 颜色管理尚未实现。当前 Skin/Tone 为累计像素快照，不是独立调整层或智能滤镜。
