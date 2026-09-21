# 艾琳导演台 · 开源核心

把外部 Agent 做好的导演包导入桌面导演台，核对镜头卡，一键生成可编辑 3D 预演，再用本机 Blender 与 FFmpeg 输出供生视频模型参考的白模 MP4。也支持直接导入 Previs IR 或在本地识别分镜文字。项目基于 Sam Wasserman 的 [Blockout](https://github.com/wassermanproductions/blockout) 改造；来源与修改见 [NOTICE](NOTICE)、[MODIFICATIONS.md](MODIFICATIONS.md)。

![开源核心主界面：导演包审阅与可编辑 3D 预演](media/showcase/director-ui.png)

上图为 v0.2.0 开源核心实际界面，导入仓库示例导演包并生成预演后截取。[查看搭景界面](media/showcase/stage-ui.png)。

## 白模效果展示

点击预览图可看同步对比视频；也可分别打开两种引擎的原始白模 MP4。

| 通用镜头 | 同步对比视频 | 单独白模视频 |
| --- | --- | --- |
| 咖啡馆会面 · 7 秒 | [![咖啡馆 Three.js 与 Blender 白模对比](media/showcase/cafe-compare.png)](media/showcase/cafe-compare.mp4) | [Three.js](media/showcase/cafe-threejs.mp4) · [Blender](media/showcase/cafe-blender.mp4) |
| 仓库对峙 · 8 秒 | [![仓库 Three.js 与 Blender 白模对比](media/showcase/warehouse-compare.png)](media/showcase/warehouse-compare.mp4) | [Three.js](media/showcase/warehouse-threejs.mp4) · [Blender](media/showcase/warehouse-blender.mp4) |
| 街角追逐 · 6 秒 | [![街角 Three.js 与 Blender 白模对比](media/showcase/street-compare.png)](media/showcase/street-compare.mp4) | [Three.js](media/showcase/street-threejs.mp4) · [Blender](media/showcase/street-blender.mp4) |

这些是三组通用案例的既有白模样片，不是随附“双人调度”入门包的输出，也不包含最终生视频模型成片。开源核心使用同一类 Three.js／Blender 白模渲染流程；可按下文教程用自己的导演包生成新视频。

## 下载与启动

Windows 用户可从 [Releases](https://github.com/liutongxian/ailin-director-previs/releases) 下载 `AilinDirectorPrevis-0.2.2-win-x64.exe`。这是免安装版，双击运行。当前未提供代码签名，Windows SmartScreen 可能提示；请核对发布页的 SHA-256 后自行决定是否运行。EXE 不包含 Blender 或 FFmpeg。

也可以下载源码，在 Windows PowerShell 中启动完整 UI：

```powershell
git clone https://github.com/liutongxian/ailin-director-previs.git
cd ailin-director-previs
npm ci
npm run dev
```

源码运行需要 Node.js 22.12+。要导出视频，还需自行安装 [Blender](https://www.blender.org/download/) 与支持 H.264 的 [FFmpeg](https://ffmpeg.org/download.html)；Blender 高级白模需要两者，Three.js 快速白模需要 FFmpeg。若程序找不到它们，可在启动前设置绝对路径：

```powershell
$env:AILIN_BLENDER = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
$env:BLOCKOUT_FFMPEG = 'C:\ffmpeg\bin\ffmpeg.exe'
npm run dev
```

使用 EXE 时，先在 PowerShell 设置上述环境变量，再从同一个 PowerShell 启动 EXE；或将 Blender、FFmpeg 加入系统 `PATH`。

## 第一次跑通：导演包到白模视频

1. 打开“导演包”，点击“复制导演包完整提示词”，把它和自己的剧本／分镜交给外部 Agent。提示词包含规则、JSON Schema 和完整示例。带素材时交付 `.ailinpack`（ZIP，根目录含 `director.ailin.json` 和对应 `assetBindings`）；纯文本时交付 UTF-8 `.ailin.json`。
2. 点击“导入艾琳导演包…”，选取 Agent 的文件。先看校验结果、每镜头时长、人物与机位，以及首／中／尾摘要。首次体验可直接导入仓库的 [双人调度示例](examples/双人调度.ailin.json)。
3. 点击“一键生成全部可编辑 3D 预演”。若提示替换示例场景，确认后进入“搭景”。在“搭景”调整人物、道具、场景，在“拍摄”检查摄影机和时间线。
4. 打开“白模交付”，选择场景和镜头，选择“高级白模 Blender”，点击“生成当前Blender高级白模”。完成后播放检查，也可设为最终交付参考。多镜头项目逐镜头选择并生成。
5. 点击视频卡片中的“打开输出位置”。Blender 输出包含 H.264 MP4、可编辑 `.blend`、首／中／尾检查图和运行记录；将 MP4 提供给生视频模型作空间、走位和摄影机参考。

逐屏说明、外部 Agent 提示词用法、文件结构、常见报错与验收方法见 [从导演包到白模视频](docs/从导演包到白模视频.md)。

## 界面与边界

| 页面 | 用途 |
| --- | --- |
| 导演包 | 导入 `.ailinpack`／`.ailin.json`，校验镜头卡与首中尾，或导入 Previs IR、TXT／MD 分镜 |
| 搭景 | 修改每镜头的可编辑 3D 场景、人物、道具、位置和轨迹 |
| 拍摄 | 检查机位、摄影机运动、时间线及镜头时长 |
| 白模交付 | 按镜头运行 Three.js 或 Blender 白模，播放、打开输出目录并选定参考版本 |

本开源核心是真实 Electron 桌面程序，不是静态展示页；Blender 和 FFmpeg 均由本机进程调用。它不包含商业授权、云端生视频服务、私有素材、模型 API 密钥或完整商业管理台。白模用于运动与空间参考，不替代最终生成画面、声音及人工导演判断。所有项目与输出默认保存在本机。

## 开发与验证

```powershell
npm run typecheck
npm run lint
npm test
npm run smoke
npm run package:win
```

`npm run smoke` 在 Electron 中真实跑两条 Blender/FFmpeg 链路，其中一条从示例导演包导入开始。构建后的便携 EXE 位于 `release-open-core/`；构建者仍需自行配置 Blender 和 FFmpeg。外部 Agent 也可使用 [本地 MCP/CLI](mcp/README.md)；格式定义见 [Previs IR](previs-ir/README.md)。

公开文件、发布附件及运行路径的核验范围与局限见 [公开内容与可用性核验](docs/公开内容与可用性核验-2026-09-21.md)。

源码按 [Apache License 2.0](LICENSE) 发布；重新分发时保留原项目 [NOTICE](NOTICE)、[MODIFICATIONS.md](MODIFICATIONS.md) 和适用的 [第三方说明](THIRD_PARTY_NOTICES.md)。
