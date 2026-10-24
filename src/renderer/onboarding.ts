// UI-only guidance: no project mutations, execution, credentials or network calls.
import type { BusEvents } from './bus'

export type GuideTrack = 'sample' | 'package' | 'export' | 'manual'
export type GuideView = 'director' | 'stage' | 'shoot' | 'deliver' | 'settings'
export type GuideCheck = BusEvents['guideAction']['kind'] | 'entity-added' | 'actor-marks' | 'camera-marks' | 'playing'
export interface GuideStep {
  view: GuideView
  target: string
  title: string
  text: string
  check?: GuideCheck
  hint?: string
}

const delivery: GuideStep[] = [
  { view: 'deliver', target: '.core-delivery-selectors', title: '选择要生成的镜头', text: '先选场景，再选镜头。每次生成当前这一镜；多镜头需要逐镜选择并生成。导演包生成的是可编辑场景，MP4 在这里导出。' },
  { view: 'deliver', target: '.white-model-engine-picker', title: '第一次先用快速白模', text: '点击“快速白模”可尽快检查走位和构图，需要本机 FFmpeg。高级白模还需安装 Blender，可额外输出 .blend 和首中尾检查图。开源 EXE 不捆绑这两个工具。', hint: '若提示找不到工具，请先参照使用说明完成 FFmpeg / Blender 的安装配置，再重新启动软件。练习白模不需要购买云端生成服务。' },
  { view: 'deliver', target: '.white-model-generate', title: '点击生成，等到视频真正完成', text: '点击高亮按钮开始渲染。生成完成后会出现视频卡片，此步骤才会亮起“下一步”；出错时先按提示修复，也可跳过本步稍后再试。', check: 'video-exported' },
  { view: 'deliver', target: '.white-model-previews', title: '播放检查，再取出 MP4', text: '在视频卡片播放，检查开头、中间和结尾的人物、走位、机位。点击“打开输出位置”取得 MP4；需要时可设为最终交付参考。白模是制作参考，不是最终生视频成片。' },
  { view: 'deliver', target: '[data-guide="save"]', title: '保存这次白模成果', text: '点击顶栏“保存”或按 Ctrl+S，将场景和生成的视频记录保存在项目中。下次从“项目与说明”打开项目，便可继续查看和修改。', check: 'project-saved' }
]

export const GUIDE_TRACKS: Record<GuideTrack, { title: string; description: string; steps: GuideStep[] }> = {
  sample: {
    title: '先跑一遍示例', description: '内置双人调度 → 可编辑场景 → 第一条 MP4',
    steps: [
      { view: 'director', target: '[data-guide="sample"]', title: '载入软件内置的入门导演包', text: '已为这次练习打开独立示例项目，不改写原项目。点击“载入入门导演包”，无需联网或另找文件。示例讲的是两个人物会面、摄影机后拉。', check: 'sample-loaded' },
      { view: 'director', target: '[data-guide="review"]', title: '先看首、中、尾', text: '核对镜头时长、画幅、人物站位与首中尾摘要。展开调度提示和人工确认项，理解软件将生成什么，再继续。' },
      { view: 'director', target: '[data-guide="build"]', title: '生成可编辑 3D 预演', text: '点击“一键生成全部可编辑 3D 预演”。如出现替换提示，确认当前是练习项目后继续。完成后会进入搭景页；这一步还没有输出视频。', check: 'previs-built' },
      { view: 'stage', target: '.center-column .viewport-wrap', title: '这是可以继续修改的场景', text: '在中央拖动观察场景，点选人物或道具，在右侧调整。生成的不是一张截图，人物、机位和走位都可以继续编辑。' },
      { view: 'shoot', target: '[data-guide="play"]', title: '播放镜头，看看走位和机位', text: '点击“播放镜头”，或按空格播放。看人物从哪里走到哪里，摄影机如何移动；下方时间轴可以拖动查看不同时间。', check: 'playing' },
      ...delivery
    ]
  },
  package: {
    title: '制作自己的导演包', description: '提示词 + 自己的剧本 → 外部 AI → 导入审阅',
    steps: [
      { view: 'director', target: '[data-guide="copy-prompt"]', title: '先复制完整提示词', text: '点击高亮按钮，复制软件要求、JSON Schema 和完整示例。这份内容规定了外部 AI 应如何描述人物、空间、动作和摄影机。', check: 'prompt-copied' },
      { view: 'director', target: '[data-guide="copy-prompt"]', title: '把提示词和剧本一起交给外部 AI', text: '在你使用的 AI 对话中粘贴提示词，再补充自己的完整剧本或分镜。例如：“两人在咖啡馆会面，人物A从门口走到桌边，摄影机后拉，3秒，16:9。请按上述规范交付导演包。”软件本身不会在这一步替你调用模型。', hint: '纯文字结果保存为 UTF-8 的 .ailin.json。需要携带图片/模型时，请让 Agent 按提示词交付 .ailinpack；不要只改扩展名，也不要把 Markdown 代码围栏一起保存。' },
      { view: 'director', target: '[data-guide="import-package"]', title: '导入 AI 交付的文件', text: '点击“导入艾琳导演包…”，选择刚保存的文件。校验成功后才会出现镜头卡；报错时将错误和原包发回 AI 修正，再重新导入。', check: 'package-imported' },
      { view: 'director', target: '[data-guide="review"]', title: '核对自己的镜头，不照单全收', text: '逐镜检查人物、站位、时长、机位、首中尾和调度假设。与剧本不符就让 AI 修改导演包，或生成后手动调整。' },
      { view: 'director', target: '[data-guide="build"]', title: '将自己的包变成 3D 场景', text: '先保存需要保留的工程。点击生成按钮时，会明确询问是否替换当前场景；确认后进入可编辑预演。', check: 'previs-built' },
      { view: 'shoot', target: '.timeline', title: '在拍摄页检查完整镜头', text: '播放、拖动时间轴并查看摄影机视角。若走位、动作或摄影机不合适，可在搭景和拍摄页修改，再进入白模交付。' },
      ...delivery
    ]
  },
  export: { title: '生成白模视频', description: '选择镜头和引擎 → 生成 → 检查并打开输出', steps: delivery },
  manual: {
    title: '练习手动搭景与拍摄', description: '空白项目 → 放人物道具 → 走位和机位 → 保存',
    steps: [
      { view: 'settings', target: '[data-guide="new-project"]', title: '从空白项目开始练习', text: '点击“新建项目”，选择本机保存位置。当前项目有未保存修改时会先询问；取消文件选择不会更换项目。想在现有工程练习也可以跳过本步。', check: 'project-created' },
      { view: 'stage', target: '[data-guide="library"]', title: '选择人物或道具', text: '在左侧资产库搜索或展开分类，点击一个人物或道具，进入放置状态。先放一个人物，再试着放桌子、椅子或场景。' },
      { view: 'stage', target: '.center-column .viewport-wrap', title: '在地面点一下完成放置', text: '选择资产后，在中央 3D 地面点一下。添加成功后“下一步”才会亮起。按 Esc 可以退出放置状态；点选已有对象后，可拖动操作手柄移动或旋转。', check: 'entity-added' },
      { view: 'stage', target: '[data-guide="inspector"]', title: '精确调整位置与朝向', text: '点选场景中的对象后，在右侧查看和修改属性。中央观察位置关系；如改错可按 Ctrl+Z 撤销。需要更多人物和道具时，回到左侧继续添加。' },
      { view: 'shoot', target: '[data-guide="actor-mark"]', title: '给人物设置走位', text: '先点选一个人物，再点击“走位关键点”。在时间轴移动到想要的时间，在地面点击目标位置。至少设置两个不同时间的位置，人物才会随时间移动；按 Esc 退出加点。', check: 'actor-marks' },
      { view: 'shoot', target: '[data-guide="frame-subject"]', title: '先让摄影机看见人物', text: '选中人物，点击“MS”自动构图，把摄影机对准主体。若不选人物，软件会优先使用场景中的第一个人物。这样可以避免空白项目的摄影机拍不到人。', check: 'camera-marks' },
      { view: 'shoot', target: '[data-guide="camera-mark"]', title: '给摄影机设置机位与运镜', text: '在中央调整观察位置，点击“机位关键点”记录当前机位。移动时间轴，再调整视角并添加另一点。切换“摄影机视角”检查构图；焦段、画幅和时长可在相关控件修改。', check: 'camera-marks' },
      { view: 'shoot', target: '.timeline', title: '播放并修正节奏', text: '按空格播放，拖动下方时间轴检查关键点。移动或调整关键点后再播放，确认人物运动、摄影机方向和镜头时长符合意图。', check: 'playing' },
      { view: 'shoot', target: '[data-guide="save"]', title: '保存刚完成的预演', text: '点击“保存”或按 Ctrl+S。保存成功后再进入白模交付。后续可以从“项目与说明”打开这个项目继续编辑。', check: 'project-saved' },
      ...delivery
    ]
  }
}

export const GUIDE_STORAGE_KEY = 'director.previs-guide.v1'
export interface GuideProgress { seen: boolean; track: GuideTrack; step: number; viewed: GuideTrack[] }
export function readGuideProgress(): GuideProgress {
  const fallback: GuideProgress = { seen: false, track: 'sample', step: 0, viewed: [] }
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(GUIDE_STORAGE_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return fallback
    const v = raw as Partial<GuideProgress>
    if (!v.track || !Object.hasOwn(GUIDE_TRACKS, v.track)) return fallback
    const max = GUIDE_TRACKS[v.track].steps.length
    return {
      seen: v.seen === true, track: v.track,
      step: Number.isInteger(v.step) && v.step! >= 0 && v.step! < max ? v.step! : 0,
      viewed: Array.isArray(v.viewed) ? v.viewed.filter((item) => Object.hasOwn(GUIDE_TRACKS, item)) : []
    }
  } catch { return fallback }
}

export interface GuideRect { left: number; top: number; width: number; height: number }
export function placeGuideBubble(target: GuideRect | null, width: number, height: number, viewportWidth: number, viewportHeight: number): { left: number; top: number; side: string } {
  const pad = 12, gap = 14
  const clampX = (x: number): number => Math.max(pad, Math.min(x, viewportWidth - width - pad))
  const clampY = (y: number): number => Math.max(pad, Math.min(y, viewportHeight - height - pad))
  if (!target) return { left: clampX(viewportWidth - width - 20), top: clampY(60), side: 'none' }
  const choices = [
    { left: target.left + target.width + gap, top: target.top, side: 'left' },
    { left: target.left - width - gap, top: target.top, side: 'right' },
    { left: target.left, top: target.top + target.height + gap, side: 'top' },
    { left: target.left, top: target.top - height - gap, side: 'bottom' }
  ].map((choice) => ({ ...choice, left: clampX(choice.left), top: clampY(choice.top) }))
  const overlap = (r: { left: number; top: number }): number => Math.max(0, Math.min(r.left + width, target.left + target.width) - Math.max(r.left, target.left)) * Math.max(0, Math.min(r.top + height, target.top + target.height) - Math.max(r.top, target.top))
  choices.sort((a, b) => overlap(a) - overlap(b))
  return choices[0]!
}
