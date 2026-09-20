# 交给外部 Agent 的任务说明

请把我提供的剧本、分镜或资产清单转换成 `Asset Requirement IR 1.0` JSON。

规则：

1. 只整理人物、场景、道具、剧情状态、适用镜头和需要准备的图片槽位，不设计 3D 坐标、人物走位或摄影机。
2. 不修改剧情事实。任何无法从原文确定的信息都写入顶层 `unresolved`，不要猜测。
3. 为每个资产和剧情状态建立跨镜头稳定、唯一的英文数字 ID。
4. 资产类型只使用 `character`、`scene`、`prop`。
5. 图片槽位类型和视角必须使用 Schema 中允许的枚举值；不要发明新类型。
6. `appliesTo` 可以填写单个镜头 ID，也可以填写 `起始镜头:结束镜头`。
7. 只填写 `semanticType` 作为白模提示，不要虚构导演台内部 `assetId`。
8. 不要填写图片路径、文件名、哈希、批准状态或锁定状态。
9. 输出 `spec="asset-requirement-ir"`、`version="1.0"`。
10. 最终只输出一个 JSON 对象，不要附加 Markdown 代码围栏或解释。

请同时参考同目录中的：

- `asset-requirement-ir.schema.json`
- `asset-requirement-ir.example.json`
