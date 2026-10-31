# Ailin Director Desk

[简体中文](README.md) | **English**

A desktop workspace for scripts, storyboards, reusable assets, editable 3D previs and shot-by-shot AI video production. Keep shot descriptions, reference media and generation versions together in a local project.

**0.3.0-alpha.1 · Windows x64 · Development preview**

[Download Windows EXE](https://github.com/liutongxian/ailin-director-previs/releases/download/v0.3.0-alpha.1/AilinDirectorPrevis-0.3.0-alpha.1-win-x64.exe) · [Download sample project](https://github.com/liutongxian/ailin-director-previs/releases/download/v0.3.0-alpha.1/ailin-quickstart.zip) · [Release notes](https://github.com/liutongxian/ailin-director-previs/releases/tag/v0.3.0-alpha.1)

![Actual application workflow using a fictional public sample](media/quickstart/workflow.gif)

Actual app screens: script → storyboard → asset checklist → editable previs → video input. The preview does not show a successful cloud generation. The desktop UI is currently primarily Chinese; this English README does not imply an English-only onboarding experience.

## Try it without an API key

Unzip the sample, launch the app and choose **开始全流程制作** (Start production). Open **项目与说明 → 打开项目** (Project & Help → Open Project), then select the extracted `Quickstart.blockout` folder. It contains a fictional script, one editable shot and three asset requirements with image prompts. See [sample instructions](examples/quickstart/README.md).

## Workflow

| Step | What you can do |
| --- | --- |
| Script | Import or write a script and keep versions |
| Storyboard | Use a compatible text model, edit shots, organize characters, locations, props and image prompts |
| Assets | Import or generate images, keep candidates, link selected versions to the relevant shots |
| Previs | Edit staging, blocking and cameras; render white-model video with Three.js or Blender |
| Video | Choose a provider, prompt and image/video/audio references per shot; query, download and adopt results |
| Export | Trim adopted clips, concatenate shots, add music and export MP4 with a separate SRT subtitle file |

External Agent packages (`.ailin.json` / `.ailinpack`), manual staging and contextual onboarding are also supported.

## Providers and requirements

- Text: DeepSeek and other Chat Completions-compatible services using your own endpoint and model.
- Images: Ark Seedream, MiniMax Image-01, and local Qwen-Image 2.1 through Unsloth Studio.
- Video: MiniMax H3, Ark Seedance and BytePlus LAS Seedance adapters, including Seedance 2.5 presets.

Provider permissions, model availability, reference limits and billing depend on your account. Other API protocols require adapters. Local Qwen must already be installed and loaded in Studio.

The Windows EXE is portable and currently unsigned. Verify it with the release checksum file. FFmpeg / FFprobe are required for video export; Blender is additionally required for Blender previs. These tools, model weights and provider credits are not bundled.

## Privacy and current limits

Projects and media are stored locally. Clicking a cloud generation action sends the relevant script or selected references to that provider. No API keys, passwords, personal projects or machine configuration are bundled. Runtime image/video keys and local-service passwords are not saved in project files.

This is an alpha. DeepSeek breakdown has been exercised with a real service. MiniMax image/H3 generation was blocked by the test account balance; local Qwen connectivity worked but real image generation remains unverified in the test environment. Seedance real-account generation is also not yet verified. Mocked cloud tests are not evidence of a completed short-drama production.

Type checks, lint, build, 1,074 unit tests and nine source Electron flows passed for this release. The packaged app passed six onboarding flows, including a real local MP4 export.

## Development

Node.js 22.12+:

```sh
git clone https://github.com/liutongxian/ailin-director-previs.git
cd ailin-director-previs
npm ci
npm run dev
```

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run package:win` for validation and Windows packaging. See [MCP/CLI](mcp/README.md) and [workflow documentation (Chinese)](docs/全流程制作.md).

## License and attribution

Based on Sam Wasserman's [Blockout](https://github.com/wassermanproductions/blockout), under Apache-2.0. Original attribution is preserved in [LICENSE](LICENSE), [NOTICE](NOTICE) and [MODIFICATIONS.md](MODIFICATIONS.md).
