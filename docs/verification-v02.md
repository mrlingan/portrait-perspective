# v0.2 验证记录

日期：2026-10-08。宿主：Adobe Photoshop 27.0.0，官方 UXP Developer Tool。插件版本：0.2.0。

## 代码检查

- manifest v5、入口、16 个运行时 JS 语法 / require 路径及 24 个 HTML ID 检查通过。
- 20 项 Node 测试全部通过。包括模拟宿主中的回滚与所有权保护，以及新局部形变的独立方向、缺点跳过、零强度、归一化和 32 组极端参数的采样 Jacobian。
- 未把模拟测试当作 Adobe 宿主验证。

## 合成图真实宿主检查

运行 `scripts/host-check.js`，新建 320×400、RGB 8 位、sRGB 专用测试文档。最终通过的 documentID 为 87。

| 项目 | 实际结果 |
| --- | --- |
| UDT Reload / 初始化 | Plugin Reload Successful；v0.2 初始化与 show 日志 |
| 独立脸颊、下颌、鼻部与眼部组合 | 脸宽为 0 时仍实际改变像素 |
| Imaging 往返 | 逐 RGB 通道与 CPU 计算结果完全一致，包括处理区外像素 |
| 原始源图层 | 像素保持一致 |
| 预览 → 应用 | 完整替换，只有一个结果组，不累积变形 |
| 恢复 | 只剩原始源图层 |
| 历史状态往返 | 通过 activeHistoryState 恢复结果，再返回恢复后的状态 |

最终日志：`PORTRAIT_HOST_CHECK_PASS`，localControls、imagingRoundTrip、sourceUnchanged、replacePreview、reset、historyRestore 均为 PASS。

宿主检查过程中修复了直接删除组容器会保留 Geometry 的问题。现有逻辑先验证所有权，再删除子层与空组；模拟宿主同步覆盖此行为。测试脚本也修正了两项验收代码问题：读取像素放入 modal，以及 RGB / RGBA 比较按 RGB 内容而非缓冲长度判断。

## 面板与真实照片

- 在宿主通过真实选区和按钮事件核验左眼记录：选框中心转换为 `{x:0.34375,y:0.35}`，UI 显示记录成功。此步骤验证事件处理逻辑，不等同于完整面板视觉布局验收。
- 打开用户提供的第一张参考原图，768×1024、RGB 8 位；根据目视位置填写八个手动近似锚点，明确没有自动检测。
- 通过面板分析与预览事件运行默认 Reference Style。文档 ID 95，生成 `Portrait Correction [Preview] → Geometry`，原始背景层 ID 1 保留。
- 源图 RGB 数据与运行前逐字节一致。预览与源图存在 RGB 差异的像素为 52,245；脸框外改变像素为 0。这只验证处理实际发生和局部范围，不衡量修正质量或参考匹配程度。
- 实际 Photoshop Command+Z 后只剩背景图层；Command+Shift+Z 后恢复同一个预览组 ID 3。
- Photoshop 截图确认真实照片和处理组可见。未保存、未覆盖用户 JPEG；保留预览供用户切换组可见性比较。此前合成测试文档已经关闭。

## 仍需验收 / 未实现

真实照片上的精确几何与 After 对齐、发丝/耳朵/背景边缘、完整面板视觉布局、更多姿态及输入、更多 profile 和最低宿主版本、真实宿主中的全部取消与失败路径。自动人脸检测、语义分割、肤质和色调仍未实现。
