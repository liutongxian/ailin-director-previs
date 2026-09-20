# Previs IR 1.0

Previs IR 是与大模型供应商无关的预演交换格式。外部 AI Agent 或专业管线可以输出 `.previs.json` 文件，再通过导演包接口导入为可编辑镜头。本开源核心不内置大模型生成服务。

## 你可以给导演工作台什么

1. 在界面中手动搭景、编排镜头，或使用本地 Agent 控制接口导入导演包。
2. 外部 Agent 可按本目录的 schema 和示例生成 Previs IR，再用于导演包制作。
3. 可选的 GLB/GLTF 人物、场景和道具资产可从搭景界面导入。

## 外部 AI Agent 交付要求

- 根节点必须包含 `spec: "previs-ir"` 和 `version: "1.0"`。
- 人物、地点和核心道具跨镜头使用稳定 ID。
- 画面位置使用 `left / center / right`，景深使用 `foreground / midground / background`。
- 移动动作尽量提供 `from / to / startTime / endTime`。
- 只有原文明确提供米制坐标时才填写 `x / y / z` 和摄影机坐标；普通文字分镜可只用画面位置、景深和相对关系，导演台会使用确定性默认值生成可编辑草稿。
- `unresolved` 只记录会改变剧情、身份、关键空间关系或动作含义且必须由人确认的歧义；缺少焦距、米制坐标、精确时间点或灯光数值不会阻断搭景。
- 不知道导演工作台内部资产 ID 时填写 `semanticType`，不要虚构 `assetId`。

使用 `previs-ir-1.0.schema.json` 校验，参考 `previs-ir-1.0.example.json`。
