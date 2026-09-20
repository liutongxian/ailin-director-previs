# 本地 Agent 控制接口

运行 `npm run dev` 后，导演台会在 `127.0.0.1` 的随机端口启动控制服务，并在用户配置目录写入仅本机可用的随机 Bearer Token。MCP 桥接程序 `blockout-mcp.mjs` 会自动发现它；导演台必须保持运行。

将以下命令配置为 MCP 客户端的 stdio 服务（路径需换成此仓库的绝对路径）：

```text
node <仓库绝对路径>/mcp/blockout-mcp.mjs
```

例如 Codex CLI 的 `config.toml`：

```toml
[mcp_servers.ailin_previs]
command = "node"
args = ["<仓库绝对路径>/mcp/blockout-mcp.mjs"]
```

普通命令行也可使用同一控制协议：

```text
npm run ailin -- status
npm run ailin -- import-director-pack --file <导演包路径>
npm run ailin -- blender-plan --shot <镜头ID>
npm run ailin -- blender-render --shot <镜头ID>
npm run ailin -- blender-status --job <任务ID>
```

MCP 工具支持查询状态、放置和移动实体、编辑人物与摄影机时间点、导入本地扫描与参考视频、导入导演包、编译 Blender 计划、启动/查询/取消白模渲染。使用 `get_state` 先确认当前项目和镜头，再调用编辑或渲染工具。所有导入路径均指向本机文件；本接口不附带任何大模型服务或 API 密钥。

项目发现文件位于应用的独立配置目录 `ailin-director-previs`。控制服务仅监听本机环回地址，任何 RPC 请求仍需随机 Token；请勿主动分享该发现文件。
