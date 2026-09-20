/**
 * Director-desk storyboard analysis.
 *
 * The local-v1 analyzer is deliberately deterministic and conservative: it
 * recognises common Chinese/English shot vocabulary, produces an editable
 * grey-box proposal, and reports uncertainty instead of inventing story
 * facts. A cloud model can later produce the same StoryboardStagePlan shape.
 */

import type {
  GaitId,
  LightingPresetId,
  RigId,
  Scene,
  Shot,
  V3
} from './types'
import { createActorMark, createCameraMark, createEntity, createScene } from './schema'
import { headingOf } from './path'

export interface PlannedMark {
  position: V3
  time: number
  gait: GaitId
  joints?: Record<string, number>
}

export interface PlannedEntity {
  /** Stable external asset ID when the entity comes from an IR/package. */
  sourceRefId?: string
  /** Production asset-center ID bound by an Ai Lin Director Pack. */
  referenceAssetId?: string
  assetId: string
  name: string
  role: 'environment' | 'character' | 'prop' | 'furniture'
  position: V3
  rotationY: number
  scale?: number
  pose?: GaitId
  marks: PlannedMark[]
}

export interface StoryboardStagePlan {
  sceneName: string
  environmentAssetId: string
  /** Production scene asset ID bound by an Ai Lin Director Pack. */
  sceneReferenceAssetId?: string
  lighting: LightingPresetId
  duration: number
  aspect: Shot['aspect']
  entities: PlannedEntity[]
  camera: {
    rig: RigId
    focalLength: number
    marks: {
      position: V3
      time: number
      pan: number
      tilt: number
      focalLength: number
    }[]
  }
  summary: string
  warnings: string[]
}

export interface ApplyStoryboardResult {
  addedEntities: number
  addedTracks: number
  cameraApplied: boolean
}

export interface StoryboardShotCard {
  name: string
  content: string
  /** Stable shot id supplied by an external IR, used to join other IR documents. */
  sourceShotId?: string
  plan: StoryboardStagePlan
  /** Preserve whether this plan came from deterministic text parsing or validated IR. */
  engine?: 'local-v1' | 'previs-ir' | 'model-ir' | 'director-package'
}

export interface StoryboardDocumentPlan {
  sourceKind: 'storyboard' | 'script'
  shots: StoryboardShotCard[]
  warnings: string[]
  blockingIssues?: string[]
}

const ENVIRONMENTS: { words: string[]; assetId: string; name: string }[] = [
  { words: ['咖啡馆', '咖啡店', 'coffee shop', 'cafe'], assetId: 'env.coffeeShop', name: '咖啡馆' },
  { words: ['修复室', '修复间', '工作间', '工作室', 'workshop'], assetId: 'env.warehouse', name: '修复室' },
  { words: ['民俗馆', '博物馆', '展厅', 'gallery', 'museum'], assetId: 'env.store', name: '展厅' },
  { words: ['办公室', 'office'], assetId: 'env.office', name: '办公室' },
  { words: ['医院', '病房', 'hospital'], assetId: 'env.hospitalRoom', name: '病房' },
  { words: ['教室', 'classroom'], assetId: 'env.classroom', name: '教室' },
  { words: ['仓库', 'warehouse'], assetId: 'env.warehouse', name: '仓库' },
  { words: ['餐厅', '饭店', 'restaurant'], assetId: 'env.restaurant', name: '餐厅' },
  { words: ['酒吧', 'bar'], assetId: 'env.bar', name: '酒吧' },
  { words: ['街道', '街上', '马路', 'street'], assetId: 'env.cityStreet', name: '街道' },
  { words: ['院子', '前院', '后院', 'yard', 'courtyard'], assetId: 'env.backyard', name: '院子' },
  { words: ['树林', '森林', 'forest'], assetId: 'env.forest', name: '森林' },
  { words: ['公园', 'park'], assetId: 'env.park', name: '公园' },
  { words: ['车内', '汽车内', 'car interior'], assetId: 'env.carInterior', name: '车内' },
  { words: ['家中', '屋内', '室内', '房间', 'interior'], assetId: 'env.houseInterior', name: '室内' }
]

const PROPS: { words: string[]; assetId: string; name: string; role: 'prop' | 'furniture'; y?: number; scale?: number }[] = [
  { words: ['黑桌', '工作台', '工作桌'], assetId: 'furniture.diningTable', name: '黑桌', role: 'furniture' },
  { words: ['桌子', '桌边', '桌上', 'table'], assetId: 'furniture.diningTable', name: '桌子', role: 'furniture' },
  { words: ['椅子', '座椅', 'chair'], assetId: 'furniture.chair', name: '椅子', role: 'furniture' },
  { words: ['沙发', 'couch', 'sofa'], assetId: 'furniture.couch', name: '沙发', role: 'furniture' },
  { words: ['送灯娘娘像', '神像', '雕像', 'statue', 'idol'], assetId: 'prim.cylinder', name: '送灯娘娘像', role: 'prop', scale: 1.45 },
  { words: ['记录册', '册子', '本子', '书本', 'book', 'notebook'], assetId: 'prop.book', name: '记录册', role: 'prop', y: 0.82 },
  { words: ['手机', '电话', 'phone'], assetId: 'prop.phone', name: '手机', role: 'prop', y: 0.82 },
  { words: ['手电', '手电筒', 'flashlight'], assetId: 'prop.torch', name: '手电筒', role: 'prop', y: 0.82 },
  { words: ['灯笼', 'lantern'], assetId: 'prop.lantern', name: '灯笼', role: 'prop' },
  { words: ['公文包', 'briefcase'], assetId: 'prop.briefcase', name: '公文包', role: 'prop' },
  { words: ['行李箱', '箱子', 'suitcase'], assetId: 'prop.suitcase', name: '行李箱', role: 'prop' },
  { words: ['杯子', '水杯', '咖啡杯', 'cup', 'mug'], assetId: 'prop.mug', name: '杯子', role: 'prop', y: 0.82 },
  { words: ['门口', '门边', 'door'], assetId: 'furniture.doorOpen', name: '门', role: 'furniture' }
]

const INVALID_NAMES = new Set([
  '场景', '地点', '内景', '外景', '镜头', '摄影机', '画面', '特写', '近景', '中景',
  '全景', '夜晚', '白天', '室内', '门口', '桌边', '此时', '随后', '接着', '然后'
])

const FEMALE_NAME_HINTS = ['娜', '婷', '静', '倩', '琳', '雪', '晴', '夏', '兰', '梅', '芳', '敏', '丽', '菲', '薇']

function hasFemaleNameHint(name: string): boolean {
  return FEMALE_NAME_HINTS.some((hint) => name.includes(hint))
}

function includesAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase()
  return words.some((word) => lower.includes(word.toLowerCase()))
}

function extractCharacters(text: string): string[] {
  const found: string[] = []
  const add = (raw: string): void => {
    const name = raw.trim().replace(/[（(].*$/, '')
    if (name.length < 2 || name.length > 8 || INVALID_NAMES.has(name) || found.includes(name)) return
    found.push(name)
  }

  for (const match of text.matchAll(/(?:^|\n)\s*([\p{Script=Han}A-Za-z·]{2,8})\s*[：:]/gu)) add(match[1]!)
  for (const match of text.matchAll(/(?:人物|角色|出场)\s*[：:]\s*([^\n。；;]+)/gu)) {
    for (const name of match[1]!.split(/[、,，/与和]/)) add(name)
  }
  const actionSubject = /(?:^|[。；;，,\n])\s*([\p{Script=Han}]{2,5}?)(?=(?:从|在|正|正在|站|坐|蹲|跪|躺|走|跑|来到|靠近|看|望|说|问|答|解释|沉默|转身|进入|离开|拿|递|指|扶))/gu
  for (const match of text.matchAll(actionSubject)) add(match[1]!)

  if (found.length === 0 && includesAny(text, ['女人', '女孩', '女主', '她'])) add('人物A')
  if (found.length === 0 && includesAny(text, ['男人', '男孩', '男主', '他'])) add('人物A')
  if (found.length === 0 && includesAny(text, ['双人', '两人', '二人'])) {
    add('人物A')
    add('人物B')
  }
  return found.slice(0, 8)
}

function contextFor(text: string, name: string): string {
  const index = text.indexOf(name)
  if (index < 0) return text
  return text.slice(Math.max(0, index - 12), Math.min(text.length, index + name.length + 45))
}

function poseFrom(context: string): GaitId {
  if (includesAny(context, ['蹲', '跪', 'crouch', 'kneel'])) return 'crouch'
  if (includesAny(context, ['躺', '倒在', 'lie'])) return 'lie'
  if (includesAny(context, ['坐', 'sit'])) return 'sit'
  if (includesAny(context, ['跑', 'run'])) return 'run'
  if (includesAny(context, ['快走', '小跑', 'jog'])) return 'jog'
  if (includesAny(context, ['走', '进入', '来到', '靠近', 'walk', 'enter'])) return 'walk'
  if (includesAny(context, ['指', '递', '挥手', 'gesture'])) return 'gesture'
  return 'stand'
}

function lightingFrom(text: string): LightingPresetId {
  if (includesAny(text, ['黄金时刻', '黄昏', '夕阳', 'golden hour'])) return 'goldenHourSky'
  if (includesAny(text, ['夜', '深夜', '冷色', '蓝调', 'night', 'cold light'])) return 'interiorCool'
  if (includesAny(text, ['暖光', '烛光', '暖色', 'warm light'])) return 'interiorWarm'
  if (includesAny(text, ['舞台', '霓虹', '夜店', 'club'])) return 'club'
  return includesAny(text, ['外景', '户外', '晴天', '日景', 'day']) ? 'middaySky' : 'day'
}

function durationFrom(text: string): number {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:秒|s\b)/i)
  return Math.min(15, Math.max(2, match ? Number(match[1]) : 6))
}

function cameraFor(text: string, duration: number, target: V3): StoryboardStagePlan['camera'] {
  let focalLength = 42
  let distance = 6.2
  if (includesAny(text, ['大特写', 'extreme close', 'ecu'])) {
    focalLength = 100
    distance = 3.2
  } else if (includesAny(text, ['特写', 'close-up', '近景', 'cu', 'mcu'])) {
    focalLength = includesAny(text, ['中近景', 'mcu']) ? 58 : 75
    distance = includesAny(text, ['中近景', 'mcu']) ? 4.8 : 3.8
  } else if (includesAny(text, ['全景', '远景', 'wide', 'ws'])) {
    focalLength = 28
    distance = 8.5
  } else if (includesAny(text, ['中景', 'medium', 'ms'])) {
    focalLength = 50
    distance = 5.5
  }

  const isOts = includesAny(text, ['过肩', 'ots', 'over shoulder'])
  const start = { x: isOts ? 1.15 : 0, y: 1.7, z: target.z + distance }
  const aim = (position: V3): { pan: number; tilt: number } => {
    const dx = target.x - position.x
    const dy = 1.25 - position.y
    const dz = target.z - position.z
    return {
      pan: headingOf({ x: dx, y: 0, z: dz }),
      tilt: Math.atan2(dy, Math.hypot(dx, dz))
    }
  }
  const firstAim = aim(start)
  const moving = includesAny(text, ['推近', '推进', 'dolly in', 'push in', '拉远', '拉开', 'dolly out', '横移', '跟拍', 'tracking'])
  const pullOut = includesAny(text, ['拉远', '拉开', 'dolly out'])
  const lateral = includesAny(text, ['横移', '侧移', 'tracking'])
  const handheld = includesAny(text, ['手持', 'handheld'])
  const marks = [{ position: start, time: 0, ...firstAim, focalLength }]
  if (moving) {
    const end = {
      x: lateral ? start.x + 2 : start.x,
      y: start.y,
      z: start.z + (pullOut ? 1.8 : lateral ? 0 : -1.5)
    }
    marks.push({ position: end, time: Math.max(1, duration - 0.2), ...aim(end), focalLength })
  }
  return { rig: handheld ? 'handheld' : moving ? 'dolly' : 'sticks', focalLength, marks }
}

export function analyzeStoryboard(raw: string): StoryboardStagePlan {
  const text = raw.trim()
  const environment = ENVIRONMENTS.find((item) => includesAny(text, item.words)) ?? {
    assetId: 'env.houseInterior',
    name: '通用室内',
    words: []
  }
  const explicitScene = text.match(/(?:场景|地点|内景|外景)\s*[：:]?\s*([^\n，。,；;]{2,20})/u)?.[1]?.trim()
  const sceneName = explicitScene || environment.name
  const duration = durationFrom(text)
  const characters = extractCharacters(text)
  const warnings: string[] = []
  if (characters.length === 0) warnings.push('没有可靠识别到人物；请在分镜中写明人物姓名和动作。')
  if (environment.words.length === 0) warnings.push('没有识别到明确地点，暂用通用室内白模。')

  const entities: PlannedEntity[] = [
    {
      assetId: environment.assetId,
      name: `${sceneName}白模`,
      role: 'environment',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      marks: []
    }
  ]

  const count = Math.max(1, characters.length)
  for (const [index, name] of characters.entries()) {
    const x = (index - (count - 1) / 2) * 1.8
    const z = index % 2 === 0 ? 0.2 : -0.45
    const position = { x, y: 0, z }
    const context = contextFor(text, name)
    const pose = poseFrom(context)
    const entering = includesAny(context, ['从门口', '进入', '走进', '来到', '靠近', 'walks in', 'enters'])
    const leaving = includesAny(context, ['离开', '走出', '退出', 'exits', 'leaves'])
    const marks: PlannedMark[] = []
    if (entering) {
      marks.push({ position: { x: x + (x <= 0 ? -3 : 3), y: 0, z: 2.4 }, time: 0, gait: 'walk' })
      marks.push({ position, time: Math.max(1.5, duration * 0.45), gait: pose === 'run' ? 'run' : 'walk' })
    } else {
      marks.push({ position, time: 0, gait: pose })
    }
    if (leaving) marks.push({ position: { x: x + (x <= 0 ? -3 : 3), y: 0, z: 2.8 }, time: duration, gait: 'walk' })
    entities.push({
      assetId: hasFemaleNameHint(name) || includesAny(context, ['她', '女', 'woman', 'girl']) ? 'person.woman' : 'person.man',
      name,
      role: 'character',
      position,
      rotationY: headingOf({ x: -x, y: 0, z: -z }),
      pose,
      marks
    })
  }

  const matchedProps = PROPS.filter((item) => includesAny(text, item.words))
  matchedProps.forEach((item, index) => {
    entities.push({
      assetId: item.assetId,
      name: item.name,
      role: item.role,
      position: { x: (index % 3 - 1) * 0.65, y: item.y ?? 0, z: -1.15 - Math.floor(index / 3) * 0.65 },
      rotationY: 0,
      ...(item.scale ? { scale: item.scale } : {}),
      marks: []
    })
  })

  const people = entities.filter((item) => item.role === 'character')
  const target = people.length > 0
    ? {
        x: people.reduce((sum, item) => sum + item.position.x, 0) / people.length,
        y: 1.2,
        z: people.reduce((sum, item) => sum + item.position.z, 0) / people.length
      }
    : { x: 0, y: 1.2, z: 0 }
  const camera = cameraFor(text, duration, target)
  const lighting = lightingFrom(text)
  const aspect: Shot['aspect'] = includesAny(text, ['竖屏', '9:16', 'vertical']) ? '9:16' : '16:9'
  const summary = `已识别 ${sceneName}、${characters.length} 个人物、${matchedProps.length} 个道具／家具、${camera.marks.length > 1 ? '运动' : '固定'}机位。`

  return {
    sceneName,
    environmentAssetId: environment.assetId,
    lighting,
    duration,
    aspect,
    entities,
    camera,
    summary,
    warnings
  }
}

const SHOT_HEADING = /^(?:#{1,6}\s*)?((?:第\s*)?[零〇一二三四五六七八九十百\d]+\s*(?:镜|场)|(?:镜头|SHOT)\s*[-_#]?[零〇一二三四五六七八九十百\d]+|S\d{2,})(?:\s*[-—:：.·]?\s*(.*))?$/iu

function paragraphChunks(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
  const chunks: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 260) {
      chunks.push(paragraph)
      continue
    }
    const sentences = paragraph.match(/[^。！？!?\n]+[。！？!?]?/gu)?.map((part) => part.trim()).filter(Boolean) ?? [paragraph]
    for (let i = 0; i < sentences.length; i += 3) chunks.push(sentences.slice(i, i + 3).join(''))
  }
  return chunks
}

/**
 * Convert either a numbered storyboard or plain screenplay prose into shot
 * cards. This intentionally stays deterministic so a beginner can use it
 * without an API key; a cloud parser can later return the same card shape.
 */
export function splitStoryboardDocument(raw: string): StoryboardDocumentPlan {
  const text = raw.replace(/\r\n?/gu, '\n').trim()
  if (!text) return { sourceKind: 'script', shots: [], warnings: ['没有可分析的剧本或分镜内容。'] }

  const numbered: { name: string; lines: string[] }[] = []
  let current: { name: string; lines: string[] } | null = null
  for (const sourceLine of text.split('\n')) {
    const line = sourceLine.trim()
    const heading = line.match(SHOT_HEADING)
    if (heading) {
      if (current && current.lines.some(Boolean)) numbered.push(current)
      current = { name: heading[1]!.replace(/\s+/gu, ''), lines: heading[2]?.trim() ? [heading[2]!.trim()] : [] }
      continue
    }
    if (current) current.lines.push(sourceLine)
  }
  if (current && current.lines.some(Boolean)) numbered.push(current)

  const sourceKind = numbered.length > 0 ? 'storyboard' : 'script'
  const rawShots = numbered.length > 0
    ? numbered.map((item) => ({ name: item.name, content: item.lines.join('\n').trim() }))
    : paragraphChunks(text).map((content, index) => ({ name: `镜头${String(index + 1).padStart(2, '0')}`, content }))
  const warnings = numbered.length > 0
    ? []
    : ['没有发现明确的镜头编号，已按段落生成镜头卡；请在批量搭建前快速检查。']

  return {
    sourceKind,
    shots: rawShots.filter((item) => item.content).map((item) => ({
      ...item,
      plan: analyzeStoryboard(item.content)
    })),
    warnings
  }
}

/** Build one independent editable scene per shot, avoiding cross-shot path conflicts. */
export function buildStoryboardScenes(
  cards: StoryboardShotCard[],
  engine: 'local-v1' | 'previs-ir' | 'model-ir' | 'director-package' = 'local-v1'
): Scene[] {
  return cards.map((card, index) => {
    const scene = createScene(index + 1)
    scene.name = card.plan.sceneName
    const shot = scene.shots[0]!
    shot.name = card.name
    shot.notes = card.content
    shot.storyboard = {
      content: card.content,
      ...(card.sourceShotId ? { sourceShotId: card.sourceShotId } : {})
    }
    applyStoryboardPlan(scene, shot, card.plan, {
      replacePreviousAutoStage: true,
      replaceCamera: true,
      sourceEngine: card.engine ?? engine
    })
    return scene
  })
}

export function applyStoryboardPlan(
  scene: Scene,
  shot: Shot,
  plan: StoryboardStagePlan,
  options: {
    replacePreviousAutoStage?: boolean
    replaceCamera?: boolean
    sourceEngine?: 'local-v1' | 'previs-ir' | 'model-ir' | 'director-package'
  } = {}
): ApplyStoryboardResult {
  const replace = options.replacePreviousAutoStage !== false
  if (replace) {
    const removed = new Set(scene.entities.filter((item) => item.storyboardGenerated).map((item) => item.id))
    scene.entities = scene.entities.filter((item) => !removed.has(item.id))
    for (const take of scene.blocking) {
      take.tracks = take.tracks.filter((track) => !removed.has(track.entityId))
    }
  }

  if (/^Scene\s+\d+$/i.test(scene.name) || /^场景\s*\d+$/u.test(scene.name)) scene.name = plan.sceneName
  scene.environment.lighting = plan.lighting
  if (plan.sceneReferenceAssetId) scene.referenceAssetId = plan.sceneReferenceAssetId
  shot.duration = plan.duration
  shot.aspect = plan.aspect
  shot.notes = shot.storyboard?.content || shot.notes

  let addedEntities = 0
  let addedTracks = 0
  const take = scene.blocking.find((item) => item.id === shot.blockingTakeId) ?? scene.blocking[0]
  for (const item of plan.entities) {
    const duplicate = scene.entities.find((existing) =>
      !existing.storyboardGenerated &&
      (existing.name === item.name || (item.role === 'environment' && existing.assetId === item.assetId))
    )
    if (duplicate) continue
    const entity = createEntity(item.assetId, item.name, { ...item.position })
    entity.transform.rotationY = item.rotationY
    if (item.scale) entity.transform.scale = item.scale
    if (item.pose && item.pose !== 'stand' && item.assetId.startsWith('person.')) {
      entity.params = { ...entity.params, pose: item.pose }
    }
    entity.label = item.role === 'character'
      ? { text: item.name, color: addedEntities % 2 === 0 ? '#2fb8c6' : '#f0a52b' }
      : undefined
    entity.storyboardGenerated = true
    entity.storyboardRole = item.role
    if (item.referenceAssetId) entity.referenceAssetId = item.referenceAssetId
    scene.entities.push(entity)
    addedEntities++

    if (take && item.marks.length > 0) {
      take.tracks.push({
        entityId: entity.id,
        marks: item.marks.map((mark) => {
          const created = createActorMark({ ...mark.position }, mark.time, mark.gait)
          created.arriveHeading = item.rotationY
          if (mark.joints) created.joints = { ...mark.joints }
          return created
        })
      })
      addedTracks++
    }
  }

  const canReplaceCamera = options.replaceCamera === true || shot.camera.marks.length === 0 || shot.storyboard?.cameraGenerated === true
  if (canReplaceCamera) {
    shot.camera.rig = plan.camera.rig
    shot.camera.marks = plan.camera.marks.map((mark) =>
      createCameraMark({ ...mark.position }, mark.time, mark.pan, mark.tilt, mark.focalLength)
    )
  }
  shot.storyboard = {
    content: shot.storyboard?.content ?? '',
    ...(shot.storyboard?.sourceName ? { sourceName: shot.storyboard.sourceName } : {}),
    ...(shot.storyboard?.sourceShotId ? { sourceShotId: shot.storyboard.sourceShotId } : {}),
    autoStageSummary: plan.summary,
    autoStageEngine: options.sourceEngine ?? 'local-v1',
    cameraGenerated: canReplaceCamera
  }
  return { addedEntities, addedTracks, cameraApplied: canReplaceCamera }
}
