# 艾琳导演台 · 白模预演

一个可本地运行的开源导演工作台：搭建 3D 场景、编排人物和摄影机、预览镜头，并导出供生视频模型参考的白模预演视频。支持内置 Three.js 预演与 Blender 高级白模。项目基于 Sam Wasserman 的 [Blockout](https://github.com/wassermanproductions/blockout) 改造，详见 [NOTICE](NOTICE) 和 [MODIFICATIONS.md](MODIFICATIONS.md)。

## 从源码运行

需要 Node.js 22.12+、[Blender](https://www.blender.org/download/) 和支持 H.264 编码的 [FFmpeg](https://ffmpeg.org/download.html)。Blender 与 FFmpeg 需自行安装；本仓库不含其可执行文件。

```bash
npm ci
npm run dev
```

若可执行文件不在系统 `PATH` 中，启动前设置 `AILIN_BLENDER` 和 `BLOCKOUT_FFMPEG` 为绝对路径。例如 Windows PowerShell：

```powershell
$env:AILIN_BLENDER = 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe'
$env:BLOCKOUT_FFMPEG = 'C:\ffmpeg\bin\ffmpeg.exe'
npm run dev
```

## 生成一条白模预演视频

1. 首次启动会打开一个可编辑的通用示例项目；也可在“项目与说明”中新建或打开项目。
2. 在“搭景”中放置人物、场景和道具；在“拍摄”中调整镜头、时间线、运动轨迹和镜头时长。
3. 打开“白模预演”，选择“高级白模 Blender”，点击“生成当前 Blender 高级白模”。
4. 完成后在预演卡片中检查视频，并可选择“设为最终交付参考”。

Blender 文件位于当前项目的 `generated/blender/<镜头ID>-<任务ID>/`：包含 H.264 MP4、可继续编辑的 `.blend`、起／中／末检查图、计划 JSON 和运行日志。Three.js 白模可在同一面板单独生成。白模展示的是空间、走位、动作节奏和摄影机运动，不会代替最终的角色画面或配音。

外部 Agent 可通过 [本地 MCP/CLI](mcp/README.md) 导入导演包、摆放实体、编排镜头并启动 Blender 任务。仓库提供 [Previs IR 格式](previs-ir/README.md) 和通用示例；模型调用和素材获取由使用者自行配置。所有项目和导出默认保存在本机，不依赖云端服务。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run smoke
```

`npm run smoke` 会启动 Electron 并真实调用 Blender 与 FFmpeg，生成约一秒的测试 MP4。运行前确认两者可执行，必要时设置上述环境变量。此仓库当前只提供源码运行方式，不提供预构建安装包。

## 许可证与范围

源码按 [Apache License 2.0](LICENSE) 发布；分发或改作时请保留原项目的 [NOTICE](NOTICE) 与修改说明。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本开源核心不含商业授权、云端生视频服务、私有剧集素材，也不附带任何第三方模型 API 密钥。
