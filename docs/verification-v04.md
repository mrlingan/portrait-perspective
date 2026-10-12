# v0.4 验证记录

日期：2026-10-08。宿主：Adobe Photoshop 27.0.0，官方 UXP Developer Tool。插件：0.4.0。

## 本次范围与文件

新增 src/face/LocatorSession.js（独立点选草稿/步骤/视野/撤销）、src/ui/locator.js（UXP 原生定位对话框）、src/photoshop/thumbnail.js（有尺寸预算的显示预览）和 tests/locator.test.js。更新 ManualInput.js、controller.js、controls.js、入口 HTML/JS/CSS、manifest/package、检查脚本与 README。既有几何、肤质、色调核心算法没有改动。

本次是手动辅助定位的可用性改进，**没有接入自动 landmarks 模型**。对话框预览只供显示，处理仍读取全分辨率源图；未增加网络或文件权限，也不保存/上传预览。

## 静态检查与自动测试

- manifest v5、版本一致、panel/command 入口、21 个运行时 JS 语法/require 路径、38 个 HTML ID 检查通过。
- 36 项 Node 测试通过，包括既有几何/肤质/色调/事务，以及新定位模型的两角八点、归一化映射、缩放投影、不同分辨率/布局偏移、撤销重记、草稿隔离、无效点/输入、缩略图只读与编码异常时 dispose。
- 无文档时 thumbnail/analyze/process/reset 均通过模拟测试验证为清晰报错，不触发写入。

## 加载与窗口

首次从旧版本仅 Reload 时，宿主沿用旧入口注册，报告 Could not find command portraitLocator in manifest。已通过 UDT Unload → Load 更新注册。随后显示 Plugin Load Successful、v0.4 面板就绪、show 日志；再次 Reload 后正常初始化。本次启动问题已解决，升级说明已写入 README。

从真实 Photoshop“增效工具 → Portrait Perspective → 图片点选定位…”点击新增命令，实际打开 620×740 的 UXP dialog。验证了图片编码、标题/提示、照片、编号和底部按钮可见。首次窗口照片挤压提示的布局问题已修正：图片视区采用不压缩的 380 高度、明确叠放与标题颜色。

## 真实鼠标操作

在用户提供的 768×1024 原自拍上，通过原生鼠标操作完成：

1. 第一次两角画框后取消；面板仍为初始输入 x25/y15/宽50/高65，landmarks 为空，状态明确“已取消”；图片 src 已移除。
2. 更新布局后通过 Photoshop 菜单重新打开。真实点选两个脸框角，完成后自动放大人脸。
3. 点左眼、右眼；点鼻后使用“撤销点选”，返回鼻部步骤、保留两个眼点；重新点鼻并继续嘴、双颊、双下颌。
4. 八点齐全后完成，面板收到整幅图归一化坐标，预览 src 被移除。坐标来自真实鼠标，没有通过测试脚本代填关键点。
5. 接入已有“分析人脸 → 预览”流程，来源仍为手动 adapter。文档/源层绑定检查通过。

脸框百分比由实际点选换算，不是插件内置坐标。私人照片的定位数值不随开源文档发布。目视点选用于流程验证，不能证明人像关键点的测量精度。

## 真实照片三阶段结果

文档 ID 95、原始背景层 ID 1。试验参数为整体65、脸宽-12、脸颊-8、下颌-6、眼部0、鼻部-4、肤质80、色调80。

实际输出 REFERENCE_V04_PASS：

```json
{"documentID":95,"groupID":15,"sourceUnchanged":true,"stages":{"Geometry":{"changedPixels":75392,"changedOutsideFace":0},"Skin":{"changedPixels":77,"changedOutsideFace":0},"Tone":{"changedPixels":1988,"changedOutsideFace":0}}}
```

每个阶段与前一阶段比较 RGB 像素，原始背景与处理前逐字节一致，各阶段脸框外改变像素为 0。计数只是证明处理发生及局部范围正确，不是效果提升评分或参考匹配率。保留三阶段预览供比较，没有保存或覆盖原 JPEG。

## 合成图宿主回归

scripts/host-check.js 创建专用 320×400 sRGB 测试图，真实 documentID 194。输出：

```json
{"documentID":194,"width":320,"height":400,"locatorThumbnail":"PASS","localControls":"PASS","skinToneStages":"PASS","imagingRoundTrip":"PASS","sourceUnchanged":"PASS","replacePreview":"PASS","reset":"PASS","historyRestore":"PASS"}
```

验证新增缩略图只读/编码、三阶段逐 RGB 与 CPU 结果一致、原图不变、预览替换、不累计、恢复与历史还原。该测试图完成后关闭，未保存。

## 缩略图缩放与缓存坐标

另创建 4031×3023 的专用奇数尺寸白色测试文档（ID 201），实际 readThumbnail 返回 1200×900 JPEG 预览；Photoshop getPixels 使用 level 1，sourceBounds 为 `{left:0,top:0,right:2016,bottom:1512}`。新实现按官方规则考虑缓存级坐标及边界取整，完整画面验证通过；UI 点选始终通过视野百分比映射回完整文档，不直接使用缓存坐标。测试后关闭该图，不保存。

## 仍待实现/验收

自动模型、无脸/多人/遮挡判断、语义分割、参考 After 配准标定；最低 Photoshop 版本、小屏幕/多屏缩放、其他平台、全部真实宿主取消/故障路径仍需进一步验证。定位输入仍仅保存在会话内，Reload 前需恢复结果，重载后重新定位。肤质/色调仍只支持 sRGB，累计像素快照的限制与 v0.3 一致。

官方依据：

- [Photoshop Imaging / encodeImageData](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging)
- [UXP modal dialogs](https://developer.adobe.com/uxp/guides/how-to/add-modal-dialogs/)
- [HTMLElement / getBoundingClientRect](https://developer.adobe.com/photoshop/uxp/2022/uxp/reference-js/Global%20Members/HTML%20Elements/HTMLElement/)
- [UI event coordinates](https://developer.adobe.com/photoshop/uxp/2022/uxp/reference-js/Global%20Members/HTML%20Events/BaseUIEvent/)
