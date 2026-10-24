import { useEffect, useState } from 'react'
import { buildStoryboardScenes, type StoryboardDocumentPlan } from '@engine/director'
import {
  AILIN_DIRECTOR_PACKAGE_SCHEMA,
  AILIN_DIRECTOR_PACKAGE_TEMPLATE,
  DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS,
  directorPackageReview,
  directorPackageToStoryboardCards,
  parseDirectorPackage
} from '@engine/director-package'
import { mergeDirectorPackAssets } from '@engine/director-pack-assets'
import { parsePrevisIR, previsIRToStoryboardCards } from '@engine/previs-ir'
import { useStore } from '../store'
import { emit } from '../bus'
import examplePackage from '../../../examples/双人调度.ailin.json'
import type { ImportedDirectorPackResult } from '../../shared/director-pack'

type PlanSource = 'local-v1' | 'previs-ir' | 'director-package'

export function DirectorCorePanel(): JSX.Element {
  const doc = useStore((state) => state.doc)
  const folder = useStore((state) => state.projectFolder)
  const mutate = useStore((state) => state.mutate)
  const toast = useStore((state) => state.toast)
  const selectScene = useStore((state) => state.selectScene)
  const setMode = useStore((state) => state.setMode)
  const setShowMarks = useStore((state) => state.setShowMarks)
  const setShowPaths = useStore((state) => state.setShowPaths)
  const [plan, setPlan] = useState<StoryboardDocumentPlan | null>(null)
  const [planSource, setPlanSource] = useState<PlanSource>('local-v1')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!doc) return
    if (doc.directorPackage) {
      const parsed = parseDirectorPackage(doc.directorPackage.text)
      if (parsed.ok) {
        setPlan({ sourceKind: 'storyboard', shots: directorPackageToStoryboardCards(parsed.package), warnings: parsed.validation.warnings })
        setPlanSource('director-package')
        return
      }
    }
    if (doc.previsIR) {
      const parsed = parsePrevisIR(doc.previsIR.text)
      if (parsed.ok) {
        setPlan({ sourceKind: 'storyboard', shots: previsIRToStoryboardCards(parsed.ir), warnings: parsed.validation.warnings })
        setPlanSource('previs-ir')
        return
      }
    }
    setPlan(null)
    setPlanSource('local-v1')
  }, [doc?.id])

  const copyAgentPrompt = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText([
        DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS,
        'JSON Schema:', JSON.stringify(AILIN_DIRECTOR_PACKAGE_SCHEMA, null, 2),
        '完整示例:', AILIN_DIRECTOR_PACKAGE_TEMPLATE
      ].join('\n\n'))
      emit('guideAction', { kind: 'prompt-copied' })
      toast('已复制导演包提示词、Schema 和完整示例。把它连同你的剧本／分镜交给外部 Agent。', 'success')
    } catch {
      toast('复制失败。请检查系统剪贴板权限。', 'error')
    }
  }

  const applyPackage = (imported: { text: string; name: string }, importedPack?: ImportedDirectorPackResult | null): void => {
    const parsed = parseDirectorPackage(imported.text)
    if (!parsed.ok) throw new Error(parsed.error)
    const cards = directorPackageToStoryboardCards(parsed.package)
    const text = parsed.package.source?.text ?? parsed.package.previsIR.shots.map((shot) => shot.sourceText ?? shot.name ?? shot.id).join('\n\n')
    const name = parsed.package.source?.name ?? imported.name
    mutate('import director package', (project) => {
      if (importedPack) project.referenceAssets = mergeDirectorPackAssets(project.referenceAssets ?? [], parsed.package, importedPack.assets)
      project.sourceScript = { name, text }
      project.previsIR = { name: `${imported.name} · Previs IR`, text: JSON.stringify(parsed.package.previsIR), engine: 'previs-ir' }
      project.directorPackage = {
        name: imported.name,
        text: imported.text,
        ...(importedPack ? {
          packageId: importedPack.packageId, imageCount: importedPack.imageCount,
          modelCount: importedPack.modelCount, blenderManifestPath: importedPack.blenderManifestPath
        } : {})
      }
    })
    setPlan({ sourceKind: 'storyboard', shots: cards, warnings: parsed.validation.warnings })
    setPlanSource('director-package')
    emit('guideAction', { kind: 'package-imported' })
    toast(`导演包校验通过：${cards.length} 个镜头。请检查首／中／尾摘要，再一键生成预演。`, 'success')
  }

  const loadSample = (): void => {
    const text = JSON.stringify(examplePackage)
    if (doc?.directorPackage && doc.directorPackage.text !== text && !window.confirm('将用入门示例替换当前导入的导演包，当前场景暂不改变。继续吗？')) return
    try {
      applyPackage({ name: '内置双人调度.ailin.json', text })
      emit('guideAction', { kind: 'sample-loaded' })
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
  }

  const importPackage = async (): Promise<void> => {
    const source = await window.blockout.pickFile([{ name: '艾琳导演包', extensions: ['ailinpack', 'ailin', 'json'] }])
    if (!source || !folder) return
    setBusy(true)
    try {
      const importedPack = source.toLowerCase().endsWith('.ailinpack')
        ? await window.blockout.importDirectorPack(folder, source)
        : null
      const imported = importedPack ?? await window.blockout.readTextFile(source)
      applyPackage(imported, importedPack)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const buildAll = (): void => {
    if (!plan?.shots.length || !doc) return
    const occupied = doc.scenes.length > 1 || doc.scenes.some((scene) => scene.entities.length > 0)
    if (occupied && !window.confirm(`将用 ${plan.shots.length} 张镜头卡替换当前预演场景；项目素材仍会保留。继续吗？`)) return
    const scenes = buildStoryboardScenes(plan.shots, planSource)
    mutate('build director previs', (project) => { project.scenes = scenes })
    selectScene(scenes[0]!.id)
    setShowMarks(true)
    setShowPaths(true)
    setMode('stage')
    emit('guideAction', { kind: 'previs-built' })
    toast(`${scenes.length} 个镜头已生成可编辑 3D 预演；在搭景／拍摄中检查后进入白模交付。`, 'success')
  }

  const savedPackage = doc?.directorPackage ? parseDirectorPackage(doc.directorPackage.text) : null

  return (
    <div className="director-panel" data-testid="director-core-panel">
      <div className="director-heading">
        <div><h1>导演包一键生成白模预演</h1><p>导入导演包，核对镜头后生成可编辑场景。</p></div>
      </div>
      <section className="director-card director-package-card">
        <div className="director-card-title"><span>① 导入导演包</span><span className="director-engine">推荐入口</span></div>
        <p>已有导演包可直接导入。还没有时，复制提示词，连同剧本交给外部 Agent 制作。支持 .ailinpack 和 .ailin.json。</p>
        <div className="director-package-actions">
          <button className="btn" data-guide="copy-prompt" onClick={() => void copyAgentPrompt()}>复制导演包完整提示词</button>
          <button className="btn primary" data-guide="import-package" disabled={busy} onClick={() => void importPackage()}>{busy ? '正在校验导入…' : '导入艾琳导演包…'}</button>
          <button className="btn" data-guide="sample" disabled={busy} onClick={loadSample}>载入入门导演包</button>
        </div>
        {doc?.directorPackage && <div className="director-package-valid">已导入：{doc.directorPackage.name} · {doc.directorPackage.imageCount ?? 0} 张随包图片 · {doc.directorPackage.modelCount ?? 0} 个 3D 模型</div>}
      </section>
      <section className="director-card" data-guide="review">
        <div className="director-card-title"><span>② 核对镜头并生成预演</span><span className="director-engine">{plan?.shots.length ?? 0} 镜头</span></div>
        {plan?.shots.length ? <>
          {plan.warnings.length > 0 && <details className="director-defaults"><summary>{plan.warnings.length} 项调度提示／默认值</summary>{plan.warnings.map((warning, index) => <div key={index}>{warning}</div>)}</details>}
          <div className="director-shot-cards">{plan.shots.map((card, index) => {
            const review = savedPackage?.ok && card.sourceShotId ? directorPackageReview(savedPackage.package, card.sourceShotId) : null
            const stage = savedPackage?.ok && card.sourceShotId ? savedPackage.package.stagePlans.find((item) => item.shotId === card.sourceShotId) : null
            return <article className="director-shot-card" key={`${card.sourceShotId ?? card.name}-${index}`}><strong>{card.name}</strong><span>{card.plan.duration}s · {card.plan.aspect}</span><p>{card.content}</p><small>{card.plan.summary} · {card.plan.entities.length} 个实体 · {card.plan.camera.marks.length} 个机位点</small>{review && <div className="director-package-review"><span><i>首</i>{review.start}</span><span><i>中</i>{review.middle}</span><span><i>尾</i>{review.end}</span></div>}{stage?.generationPrompt && <details className="director-generation-prompt"><summary>该镜头的生视频提示词（供白模交付后参考）</summary><p>{stage.generationPrompt}</p></details>}{stage?.unresolved && stage.unresolved.length > 0 && <details className="director-generation-prompt"><summary>{stage.unresolved.length} 项需人工确认的调度假设</summary>{stage.unresolved.map((item, itemIndex) => <p key={itemIndex}>{item.field}：{item.reason}</p>)}</details>}</article>
          })}</div>
          <button className="btn primary director-build-all" data-guide="build" onClick={buildAll}>一键生成全部可编辑 3D 预演</button>
        </> : <p className="director-muted">导入导演包后会显示镜头卡。请先确认人物、站位、时长及首／中／尾摘要，再生成场景。</p>}
      </section>
      <section className="director-next"><div><b>③ 导出白模 MP4</b><span>到“搭景”修改实体，到“拍摄”检查轨迹与摄影机，最后到“白模交付”选择 Three.js 或 Blender 生成视频。</span></div><button className="btn" onClick={() => setMode('deliver')}>前往白模交付 →</button></section>
    </div>
  )
}
