import { useEffect, useState } from 'react'
import { buildStoryboardScenes, splitStoryboardDocument, type StoryboardDocumentPlan } from '@engine/director'
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
  const [sourceText, setSourceText] = useState('')
  const [sourceName, setSourceName] = useState('粘贴的分镜.txt')
  const [plan, setPlan] = useState<StoryboardDocumentPlan | null>(null)
  const [planSource, setPlanSource] = useState<PlanSource>('local-v1')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!doc) return
    setSourceText(doc.sourceScript?.text ?? '')
    setSourceName(doc.sourceScript?.name ?? '粘贴的分镜.txt')
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
      toast('已复制导演包提示词、Schema 和完整示例。把它连同你的剧本／分镜交给外部 Agent。', 'success')
    } catch {
      toast('复制失败。请检查系统剪贴板权限。', 'error')
    }
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
            packageId: importedPack.packageId,
            imageCount: importedPack.imageCount,
            modelCount: importedPack.modelCount,
            blenderManifestPath: importedPack.blenderManifestPath
          } : {})
        }
      })
      setSourceText(text)
      setSourceName(name)
      setPlan({ sourceKind: 'storyboard', shots: cards, warnings: parsed.validation.warnings })
      setPlanSource('director-package')
      toast(`导演包校验通过：${cards.length} 个镜头。请检查首／中／尾摘要，再一键生成预演。`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const importPrevisIR = async (): Promise<void> => {
    const source = await window.blockout.pickFile([{ name: 'Previs IR', extensions: ['json', 'previs'] }])
    if (!source) return
    try {
      const imported = await window.blockout.readTextFile(source)
      const parsed = parsePrevisIR(imported.text)
      if (!parsed.ok) throw new Error(parsed.error)
      const cards = previsIRToStoryboardCards(parsed.ir)
      const text = cards.map((card) => `${card.name}\n${card.content}`).join('\n\n')
      mutate('import Previs IR', (project) => {
        project.sourceScript = { name: imported.name, text }
        project.previsIR = { name: imported.name, text: imported.text, engine: 'previs-ir' }
        delete project.directorPackage
      })
      setSourceText(text)
      setSourceName(imported.name)
      setPlan({ sourceKind: 'storyboard', shots: cards, warnings: parsed.validation.warnings })
      setPlanSource('previs-ir')
      toast(`Previs IR 已导入：${cards.length} 个镜头。`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const importScript = async (): Promise<void> => {
    const source = await window.blockout.pickFile([{ name: '剧本与分镜文本', extensions: ['txt', 'md', 'markdown', 'fountain'] }])
    if (!source) return
    try {
      const imported = await window.blockout.readTextFile(source)
      setSourceText(imported.text)
      setSourceName(imported.name)
      setPlan(null)
      toast('文本已导入。点击“本地识别镜头卡”检查结果。', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const analyze = (): void => {
    if (!sourceText.trim()) return toast('请先粘贴或导入分镜文字。', 'error')
    const next = splitStoryboardDocument(sourceText)
    if (next.shots.length === 0) return toast('没有识别出可搭建的镜头，请补充镜头描述。', 'error')
    mutate('analyze storyboard', (project) => {
      project.sourceScript = { name: sourceName, text: sourceText }
      delete project.previsIR
      delete project.directorPackage
    })
    setPlan(next)
    setPlanSource('local-v1')
    toast(`本地识别了 ${next.shots.length} 个镜头；请先核对，再生成预演。`, 'success')
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
    toast(`${scenes.length} 个镜头已生成可编辑 3D 预演；在搭景／拍摄中检查后进入白模交付。`, 'success')
  }

  const savedPackage = doc?.directorPackage ? parseDirectorPackage(doc.directorPackage.text) : null

  return (
    <div className="director-panel" data-testid="director-core-panel">
      <div className="director-heading">
        <div><div className="director-kicker">剧本 → 可编辑预演 → 白模视频</div><h1>艾琳导演台 · 开源核心</h1><p>让外部 Agent 制作导演包；在这里校验镜头、生成白模场景，再导出 MP4 给生视频模型参考。</p></div>
        <div className="director-step">1 导演包 · 2 审阅 · 3 搭景 · 4 白模视频</div>
      </div>
      <section className="director-card director-package-card">
        <div className="director-card-title"><span>① 外部 Agent 导演包</span><span className="director-engine">推荐入口</span></div>
        <p>把复制的完整提示词、你的剧本／分镜和可用场景资料交给外部 Agent。它可交付带素材的 `.ailinpack`；若不能制作 ZIP，也可交付单个 `.ailin`／JSON。请先核对剧情事实和调度假设。</p>
        <div className="director-package-actions">
          <button className="btn" onClick={() => void copyAgentPrompt()}>复制导演包完整提示词</button>
          <button className="btn primary" disabled={busy} onClick={() => void importPackage()}>{busy ? '正在校验导入…' : '导入艾琳导演包…'}</button>
        </div>
        {doc?.directorPackage && <div className="director-package-valid">已导入：{doc.directorPackage.name} · {doc.directorPackage.imageCount ?? 0} 张随包图片 · {doc.directorPackage.modelCount ?? 0} 个 3D 模型</div>}
      </section>
      <section className="director-card director-source-card">
        <div className="director-card-title"><span>② 镜头文字与本地备选入口</span><span className="director-engine">无需模型 API</span></div>
        <div className="script-source"><div><b>{sourceName}</b><small>外部导演包可保留原始分镜；也可直接输入文字</small></div></div>
        <textarea aria-label="剧本或分镜文字" value={sourceText} onChange={(event) => { setSourceText(event.target.value); setPlan(null) }} placeholder="例：第1镜 咖啡馆。林夏从门口走向桌边，摄影机缓慢推近，6秒。" />
        <div className="director-package-actions">
          <button className="btn" onClick={() => void importScript()}>导入 TXT／MD…</button>
          <button className="btn" onClick={() => void importPrevisIR()}>导入 Previs IR…</button>
          <button className="btn" onClick={analyze}>本地识别镜头卡</button>
        </div>
      </section>
      <section className="director-card">
        <div className="director-card-title"><span>③ 核对镜头卡并生成预演</span><span className="director-engine">{plan?.shots.length ?? 0} 镜头</span></div>
        {plan?.shots.length ? <>
          {plan.warnings.length > 0 && <details className="director-defaults"><summary>{plan.warnings.length} 项调度提示／默认值</summary>{plan.warnings.map((warning, index) => <div key={index}>{warning}</div>)}</details>}
          <div className="director-shot-cards">{plan.shots.map((card, index) => {
            const review = savedPackage?.ok && card.sourceShotId ? directorPackageReview(savedPackage.package, card.sourceShotId) : null
            const stage = savedPackage?.ok && card.sourceShotId ? savedPackage.package.stagePlans.find((item) => item.shotId === card.sourceShotId) : null
            return <article className="director-shot-card" key={`${card.sourceShotId ?? card.name}-${index}`}><strong>{card.name}</strong><span>{card.plan.duration}s · {card.plan.aspect}</span><p>{card.content}</p><small>{card.plan.summary} · {card.plan.entities.length} 个实体 · {card.plan.camera.marks.length} 个机位点</small>{review && <div className="director-package-review"><span><i>首</i>{review.start}</span><span><i>中</i>{review.middle}</span><span><i>尾</i>{review.end}</span></div>}{stage?.generationPrompt && <details className="director-generation-prompt"><summary>该镜头的生视频提示词（供白模交付后参考）</summary><p>{stage.generationPrompt}</p></details>}{stage?.unresolved && stage.unresolved.length > 0 && <details className="director-generation-prompt"><summary>{stage.unresolved.length} 项需人工确认的调度假设</summary>{stage.unresolved.map((item, itemIndex) => <p key={itemIndex}>{item.field}：{item.reason}</p>)}</details>}</article>
          })}</div>
          <button className="btn primary director-build-all" onClick={buildAll}>一键生成全部可编辑 3D 预演</button>
        </> : <p className="director-muted">导入导演包后会显示镜头卡。请先确认人物、站位、时长及首／中／尾摘要，再生成场景。</p>}
      </section>
      <section className="director-next"><div><b>④ 调整并导出白模 MP4</b><span>到“搭景”修改实体，到“拍摄”检查轨迹与摄影机，最后到“白模交付”选择 Three.js 或 Blender 生成视频。</span></div><button className="btn" onClick={() => setMode('deliver')}>前往白模交付 →</button></section>
    </div>
  )
}
