import { useEffect, useState } from 'react'
import type { ProjectDoc, Shot } from '@engine/types'
import { createShot } from '@engine/schema'
import { newId } from '@engine/ids'
import { CLOUD_VIDEO_PROVIDERS, getCloudVideoModel, cloudVideoDurationOptions } from '@engine/cloud-video'
import { PURPOSE_LABELS, defaultGenerationInput, generationProblems, mediaPurposes, mergeProductionAttempts, scriptParagraphs, type GenerationInput, type ProductionAttempt, type ProductionMedia } from '@engine/production'
import { useStore, currentProjectJson } from '../store'
import { WhiteModelWorkspace } from './WhiteModelWorkspace'
import { DirectorCorePanel } from './DirectorCorePanel'
import { Viewport } from '../viewport/Viewport'
import { ProductionFilmPanel } from './ProductionFilmPanel'
import { ProductionAssetMaker } from './ProductionAssetMaker'
import { ProductionAssetChecklist } from './ProductionAssetChecklist'
import { ProductionBreakdown } from './ProductionBreakdown'
import { hasUnreceivedAssetJobs, receiveAssetJobs, syncProductionAssetPlan } from '@engine/production-asset-plan'
import './production.css'

const STEPS = ['写剧本', '拆分镜', '做素材', '看预演', '生成视频', '导出成片']
const KEYS: Record<string, string> = {}
const STATUS: Record<ProductionAttempt['status'], string> = { submitting: '提交中', unknown: '待核对', queued: '排队中', running: '生成中', complete: '已完成', failed: '失败', expired: '已过期', cancelled: '已取消' }
const FILTERS = [{ name: '图片、视频与音频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'aac'] }]

async function saveCurrent(): Promise<void> {
  const state = useStore.getState()
  const json = currentProjectJson()
  if (!state.projectFolder || !json) throw new Error('请先创建或打开项目。')
  await window.blockout.saveProject(state.projectFolder, json)
  if (useStore.getState().projectFolder === state.projectFolder && currentProjectJson() === json) state.markSaved()
}
function changeShot(id: string, label: string, edit: (shot: Shot) => void): void {
  useStore.getState().mutate(label, (doc) => {
    const shot = doc.scenes.flatMap((scene) => scene.shots).find((item) => item.id === id)
    if (shot) edit(shot)
  })
}
function mergeAttempts(projectId: string, attempts: ProductionAttempt[]): void {
  if (useStore.getState().doc?.id !== projectId) return
  useStore.getState().mutate('更新生成记录', (doc) => mergeProductionAttempts(doc, attempts))
}
export function MediaPreview({ folder, path, kind, name }: { folder: string; path: string; kind: ProductionMedia['kind']; name: string }): JSX.Element {
  const [url, setUrl] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let live = true
    let objectUrl = ''
    setUrl(''); setError(false)
    void window.blockout.readProjectFile(folder, path).then((bytes) => {
      if (!live) return
      objectUrl = URL.createObjectURL(new Blob([bytes])); setUrl(objectUrl)
    }).catch(() => { if (live) setError(true) })
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [folder, path])
  return <div className={`pf-preview pf-${kind}`}>
    {error ? <span className="pf-warning">文件缺失，请重新导入</span> : !url ? <span>载入素材…</span> : kind === 'image' ? <img src={url} alt={name} /> : kind === 'video' ? <video src={url} controls preload="metadata" aria-label={name} /> : <audio src={url} controls aria-label={name} />}
  </div>
}

function GenerationPanel({ doc, shot, folder, importMedia }: { doc: ProjectDoc; shot: Shot; folder: string; importMedia: () => Promise<void> }): JSX.Element {
  const input = shot.generationInput ?? defaultGenerationInput(shot)
  const linkedNeeds = doc.productionAssetPlan?.filter((need) => need.shotIds.includes(shot.id)) ?? []
  const model = getCloudVideoModel(input.provider, input.model)
  const [key, setKey] = useState(KEYS[input.provider] ?? '')
  const [environmentAvailable, setEnvironmentAvailable] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [picker, setPicker] = useState(false)
  const [recoverIds, setRecoverIds] = useState<Record<string, string>>({})
  const issues = generationProblems(doc, shot)
  const attempts = shot.productionAttempts ?? []
  const pending = attempts.some((item) => ['submitting', 'unknown', 'queued', 'running'].includes(item.status))
  useEffect(() => {
    setKey(KEYS[input.provider] ?? ''); setEnvironmentAvailable(false)
    let live = true
    void window.blockout.cloudVideoKeyStatus(input.provider).then((result) => { if (live) setEnvironmentAvailable(result.available) }).catch(() => {})
    return () => { live = false }
  }, [input.provider])
  const edit = (patch: Partial<GenerationInput>): void => useStore.getState().mutate('编辑生成输入', (project) => {
    const target = project.scenes.flatMap((scene) => scene.shots).find((item) => item.id === shot.id)
    if (!target) return
    if (patch.references) for (const reference of target.generationInput?.references ?? []) {
      const replacement = patch.references.find((item) => item.mediaId === reference.mediaId)
      if (reference.assetNeedId && (!replacement || replacement.purpose !== reference.purpose)) {
        const need = project.productionAssetPlan?.find((item) => item.id === reference.assetNeedId)
        if (need) need.shotIds = need.shotIds.filter((id) => id !== shot.id)
        if (replacement) delete replacement.assetNeedId
      }
    }
    target.generationInput = { ...(target.generationInput ?? defaultGenerationInput(target)), ...patch }
  })
  const run = async (id: string, action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(id); setNotice('')
    try { await action() } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) } finally { setBusy('') }
  }
  const submit = (): Promise<void> => run('submit', async () => {
    if (!shot.generationInput) edit(input)
    await saveCurrent()
    if (useStore.getState().doc?.id !== doc.id) return
    const attempt = await window.blockout.productionSubmit(folder, doc.id, shot.id, newId('attempt'), key)
    mergeAttempts(doc.id, [attempt]); await saveCurrent()
  })
  const update = (attempt: ProductionAttempt, action: 'query' | 'download' | 'recover' | 'dismiss'): Promise<void> => run(attempt.id, async () => {
    if (action === 'dismiss' && !window.confirm('请先在供应商后台确认未产生有效任务。确认关闭此条记录？')) return
    const result = await window.blockout.productionUpdate(folder, attempt.id, action, KEYS[attempt.snapshot.input.provider], recoverIds[attempt.id])
    mergeAttempts(doc.id, [result]); await saveCurrent()
  })
  const toggle = (item: ProductionMedia): void => {
    const selected = input.references.some((reference) => reference.mediaId === item.id)
    edit({ references: selected ? input.references.filter((reference) => reference.mediaId !== item.id) : [...input.references, { mediaId: item.id, purpose: mediaPurposes(item.kind)[0]! }] })
  }
  return <>
    <div className="pf-section-heading"><div><h2>{shot.name} · 生成视频</h2><p>选择素材，说明画面，再选择模型生成。每次生成都保留独立版本。</p></div></div>
    <div className="pf-generation-grid">
      <section className="pf-card">
        <label className="pf-label">画面与动作描述<textarea aria-label="生成提示词" rows={6} value={input.prompt} placeholder="画面中有谁，发生什么，摄影机怎样运动…" onChange={(event) => edit({ prompt: event.target.value })} /></label>
        <div className="pf-row"><h3>参考素材 <small>{input.references.length} 个</small></h3><button className="btn" onClick={() => setPicker(!picker)}>从素材库选择</button><button className="btn" onClick={() => void importMedia()}>导入文件</button></div>
        {linkedNeeds.length > 0 && <p className="pf-muted">资产清单已关联 {linkedNeeds.filter((need) => need.selectedMediaId).length} / {linkedNeeds.length} 项。{linkedNeeds.some((need) => !need.selectedMediaId) && `待制作：${linkedNeeds.filter((need) => !need.selectedMediaId).map((need) => need.name).join('、')}。可到“做素材”完成。`}</p>}
        {!input.references.length && <p className="pf-empty">可以选择人物图、场景图、首尾帧、动作视频或音频，也可以只写提示词。</p>}
        <div className="pf-reference-list">{input.references.map((reference) => {
          const media = doc.productionMedia?.find((item) => item.id === reference.mediaId)
          return <div className="pf-reference" key={reference.mediaId}>
            {media ? <MediaPreview folder={folder} path={media.path} kind={media.kind} name={media.name} /> : <span className="pf-warning">素材不存在</span>}
            <div><b>{media?.name ?? reference.mediaId}</b><select aria-label={`${media?.name ?? '素材'}的用途`} value={reference.purpose} onChange={(event) => edit({ references: input.references.map((item) => item.mediaId === reference.mediaId ? { ...item, purpose: event.target.value as typeof reference.purpose } : item) })}>{mediaPurposes(media?.kind ?? 'image').map((purpose) => <option key={purpose} value={purpose}>{PURPOSE_LABELS[purpose]}参考</option>)}</select>
              {media && input.provider !== 'minimax' && <details><summary>云端素材地址{media.kind === 'video' ? '（必填）' : '（可选）'}</summary><input aria-label={`${media.name}的云端地址`} placeholder="https://… 或 asset://素材ID" value={media.cloudSources?.[input.provider] ?? ''} onChange={(event) => useStore.getState().mutate('设置云端素材地址', (project) => { const target = project.productionMedia!.find((item) => item.id === media.id)!; (target.cloudSources ??= {})[input.provider] = event.target.value })} /><small className="pf-muted">此服务的视频参考需要公网地址或已上传的素材ID。含人脸素材按服务商的授权素材流程接入。</small></details>}
            </div>
            <button className="btn small" aria-label={`移除${media?.name ?? '素材'}`} onClick={() => edit({ references: input.references.filter((item) => item !== reference) })}>移除</button>
          </div>
        })}</div>
        {picker && <div className="pf-picker"><div className="pf-row"><b>选择本镜头使用的素材</b><button className="btn small" onClick={() => setPicker(false)}>完成</button></div>{!(doc.productionMedia?.length) ? <p>素材库还是空的，请先导入文件。</p> : doc.productionMedia.map((media) => <label key={media.id}><input type="checkbox" checked={input.references.some((ref) => ref.mediaId === media.id)} onChange={() => toggle(media)} /><span>{media.name}</span><small>{media.kind === 'image' ? '图片' : media.kind === 'video' ? '视频' : '音频'}</small></label>)}</div>}
      </section>
      <section className="pf-card pf-settings"><h3>生成设置</h3>
        <label>生成模型<select aria-label="生成模型" value={`${input.provider}:${input.model}`} onChange={(event) => {
          const [provider, modelId] = event.target.value.split(':')
          const selectedModel = getCloudVideoModel(provider as GenerationInput['provider'], modelId!)
          const durations = cloudVideoDurationOptions(selectedModel)
          edit({ provider: selectedModel.provider, model: selectedModel.id, resolution: selectedModel.resolutions[0]!, duration: durations.includes(input.duration) ? input.duration : durations[0]!, generateAudio: selectedModel.supportsAudioGeneration && input.generateAudio })
        }}>{CLOUD_VIDEO_PROVIDERS.map((provider) => <optgroup key={provider.id} label={provider.label}>{provider.models.map((item) => <option value={`${provider.id}:${item.id}`} key={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
        <div className="pf-two-fields"><label>时长<select aria-label="生成时长" value={input.duration} onChange={(event) => edit({ duration: Number(event.target.value) })}>{cloudVideoDurationOptions(model).map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label><label>画幅<select aria-label="生成画幅" value={input.ratio} onChange={(event) => edit({ ratio: event.target.value })}>{model.ratios.map((value) => <option key={value} value={value}>{value === 'adaptive' ? '随参考画幅' : value}</option>)}</select></label></div>
        <label>清晰度<select value={input.resolution} onChange={(event) => edit({ resolution: event.target.value })}>{model.resolutions.map((value) => <option key={value}>{value}</option>)}</select></label>
        {model.supportsAudioGeneration && <label className="pf-check"><input type="checkbox" checked={input.generateAudio} onChange={(event) => edit({ generateAudio: event.target.checked })} />生成同步声音</label>}
        <details open={!key && !environmentAvailable}><summary>连接 {CLOUD_VIDEO_PROVIDERS.find((item) => item.id === input.provider)?.label}</summary><label>API 密钥<input aria-label="API密钥" type="password" autoComplete="off" value={key} onChange={(event) => { setKey(event.target.value); KEYS[input.provider] = event.target.value }} /></label><p className="pf-muted">{environmentAvailable ? '已检测到本机环境密钥，可直接使用。' : '密钥仅在本次打开期间使用，不写入项目。'}</p></details>
        {issues.length > 0 && <div className="pf-warning">{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
        <button className="btn primary pf-submit" disabled={!!busy || pending || issues.length > 0 || !key && !environmentAvailable} onClick={() => void submit()}>{busy === 'submit' ? '正在提交…' : '提交生成'}</button><small className="pf-muted">提交会使用所选供应商的 API 额度。</small>
        {pending && <p className="pf-warning">此镜头有未结束或待核对的任务，请在下方继续处理。</p>}
      </section>
    </div>
    {notice && <p className="pf-warning" role="alert">{notice}</p>}
    <section className="pf-card pf-versions"><h3>生成版本 <small>{attempts.length} 个</small></h3>{!attempts.length && <p className="pf-empty">还没有生成版本。生成结果下载后，可以预览并采用。</p>}
      {[...attempts].reverse().map((attempt, index) => <article className={`pf-candidate ${shot.selectedProductionAttemptId === attempt.id ? 'is-selected' : ''}`} key={attempt.id}>
        <div className="pf-row"><b>版本 {attempts.length - index} · {attempt.snapshot.input.model}</b><span className="pf-badge">{STATUS[attempt.status]}</span><small>{new Date(attempt.createdAt).toLocaleString('zh-CN')}</small>{shot.selectedProductionAttemptId === attempt.id && <strong>✓ 已采用</strong>}</div>
        {attempt.localPath && <MediaPreview folder={folder} path={attempt.localPath} kind="video" name={`生成版本${attempts.length - index}`} />}
        {attempt.error && <p className="pf-warning">{attempt.error}</p>}
        <div className="pf-row">{attempt.taskId && <button className="btn" disabled={!!busy} onClick={() => void update(attempt, 'query')}>查询进度</button>}{attempt.status === 'complete' && !attempt.localPath && <button className="btn" disabled={!!busy} onClick={() => void update(attempt, 'download')}>下载视频</button>}{attempt.status === 'complete' && attempt.localPath && <button className="btn primary" onClick={() => changeShot(shot.id, '采用视频版本', (target) => { target.selectedProductionAttemptId = attempt.id })}>采用此版本</button>}</div>
        {attempt.status === 'unknown' && <div className="pf-recover"><input aria-label="恢复任务ID" value={recoverIds[attempt.id] ?? ''} placeholder="从供应商后台复制任务ID" onChange={(event) => setRecoverIds({ ...recoverIds, [attempt.id]: event.target.value })} /><button className="btn" disabled={!!busy || !recoverIds[attempt.id]?.trim()} onClick={() => void update(attempt, 'recover')}>恢复查询</button><button className="btn" disabled={!!busy} onClick={() => void update(attempt, 'dismiss')}>已核对，关闭记录</button></div>}
        <details><summary>查看这次生成的输入</summary><p className="pf-preserve">{attempt.snapshot.input.prompt}</p><p>{attempt.snapshot.input.duration}秒 · {attempt.snapshot.input.ratio} · {attempt.snapshot.input.resolution}</p>{attempt.snapshot.media.map((media, i) => <p key={`${media.id}-${i}`}>{media.name} · {PURPOSE_LABELS[attempt.snapshot.input.references[i]!.purpose]} · {media.sha256.slice(0, 10)}</p>)}{attempt.taskId && <small>任务ID：{attempt.taskId}</small>}</details>
      </article>)}
    </section>
  </>
}

export function ProductionWorkspace(): JSX.Element {
  const doc = useStore((state) => state.doc)
  const folder = useStore((state) => state.projectFolder)
  const scene = useStore((state) => state.scene())
  const shot = useStore((state) => state.shot())
  const dirty = useStore((state) => state.dirty)
  const mutate = useStore((state) => state.mutate)
  const toast = useStore((state) => state.toast)
  const [step, setStep] = useState(() => Number(sessionStorage.getItem('production.step') || 0))
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [advanced, setAdvanced] = useState(false)
  useEffect(() => { sessionStorage.setItem('production.step', String(step)); setAdvanced(false) }, [step])
  useEffect(() => {
    if (!folder || !doc) return
    const projectId = doc.id
    let live = true
    void window.blockout.productionAttempts(folder, projectId).then((attempts) => {
      if (live && attempts.length) mergeAttempts(projectId, attempts)
    }).catch((error) => { if (live) toast(`生成记录恢复失败：${String(error)}`, 'error') })
    return () => { live = false }
  }, [folder, doc?.id, toast])
  useEffect(() => {
    if (!doc || !folder) return
    let live = true
    if (doc.previsIR && !doc.productionAssetPlan) mutate('整理已有分镜资产', syncProductionAssetPlan)
    void window.blockout.productionAssetJobs(folder, doc.id).then((jobs) => {
      const current = useStore.getState().doc
      if (live && current?.id === doc.id && hasUnreceivedAssetJobs(current, jobs)) mutate('恢复素材并关联镜头', (project) => receiveAssetJobs(project, jobs))
    }).catch((error) => { if (live) toast(`素材记录恢复失败：${String(error)}`, 'error') })
    return () => { live = false }
  }, [folder, doc?.id, mutate, toast])
  useEffect(() => {
    if (!dirty || !folder || !doc) return
    const timer = window.setTimeout(() => { void saveCurrent().catch((error) => toast(`保存失败：${String(error)}`, 'error')) }, 1500)
    return () => window.clearTimeout(timer)
  }, [doc, dirty, folder, toast])
  if (!doc || !folder || !scene || !shot) return <div className="pf-empty">请先创建项目或添加镜头。</div>
  const shots = doc.scenes.flatMap((item) => item.shots)
  const finished = shots.filter((item) => item.selectedProductionAttemptId).length
  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { await fn() } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') } finally { setBusy(false) }
  }
  const importMedia = (): Promise<void> => run(async () => {
    const files = await window.blockout.pickFiles(FILTERS)
    const failures: string[] = []
    for (const file of files) {
      try {
        const media = await window.blockout.importProductionMedia(folder, file)
        if (useStore.getState().doc?.id !== doc.id) return
        mutate('导入项目素材', (project) => {
          (project.productionMedia ??= []).push(media)
          if (step === 4) {
            const target = project.scenes.flatMap((item) => item.shots).find((item) => item.id === shot.id)
            if (target) (target.generationInput ??= defaultGenerationInput(target)).references.push({ mediaId: media.id, purpose: mediaPurposes(media.kind)[0]! })
          }
        })
      } catch (error) { failures.push(String(error)) }
    }
    await saveCurrent()
    if (failures.length) toast(`${failures.length}个文件导入失败：${failures.join('；')}`, 'error')
  })
  const addShot = (): void => {
    let id = ''
    mutate('新增镜头', (project) => {
      const target = project.scenes.find((item) => item.id === scene.id)!
      const added = createShot(target, `镜头 ${target.shots.length + 1}`)
      added.storyboard = { content: '' }; target.shots.push(added); id = added.id
    })
    useStore.getState().selectShot(id)
  }
  const canMoveShot = (offset: number): boolean => {
    const index = scene.shots.findIndex((item) => item.id === shot.id)
    if (index + offset >= 0 && index + offset < scene.shots.length) return true
    return scene.shots.length === 1 && doc.scenes[doc.scenes.findIndex((item) => item.id === scene.id) + offset]?.shots.length === 1
  }
  const moveShot = (offset: number): void => mutate('调整镜头顺序', (project) => {
    const list = project.scenes.find((item) => item.id === scene.id)!.shots
    const from = list.findIndex((item) => item.id === shot.id)
    const to = from + offset
    if (to >= 0 && to < list.length) [list[from], list[to]] = [list[to]!, list[from]!]
    else if (list.length === 1) {
      const sceneIndex = project.scenes.findIndex((item) => item.id === scene.id)
      if (project.scenes[sceneIndex + offset]?.shots.length === 1) [project.scenes[sceneIndex], project.scenes[sceneIndex + offset]] = [project.scenes[sceneIndex + offset]!, project.scenes[sceneIndex]!]
    }
  })
  return <main className="production-workspace" aria-label="全流程导演台">
    <nav className="pf-steps" aria-label="制作步骤">{STEPS.map((label, index) => <button key={label} className={step === index ? 'active' : ''} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button>)}</nav>
    <div className="pf-body"><aside className="pf-sidebar"><div className="pf-row"><b>项目镜头</b><button className="btn small" onClick={addShot}>＋</button></div><select aria-label="制作场景" value={scene.id} onChange={(event) => useStore.getState().selectScene(event.target.value)}>{doc.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <div className="pf-shot-list">{shots.map((item, index) => <button className={item.id === shot.id ? 'active' : ''} key={item.id} onClick={() => { const owner = doc.scenes.find((entry) => entry.shots.some((candidate) => candidate.id === item.id)); if (owner) useStore.getState().selectScene(owner.id); useStore.getState().selectShot(item.id) }}><span className="pf-shot-number">{String(index + 1).padStart(2, '0')}</span><span><b>{item.name}</b><small>{item.duration}秒 · {item.selectedProductionAttemptId ? '已采用视频' : item.generationInput?.references.length ? `${item.generationInput.references.length}个参考` : '待制作'}</small></span></button>)}</div><footer>{shots.length} 个镜头 · {finished} 个已采用<br />{dirty ? '正在保存修改…' : '项目已保存'}</footer>
    </aside><div className="pf-content" key={`${doc.id}:${step}`}>
      {step === 0 && <>
        <div className="pf-section-heading"><div><h1>从一个好故事开始</h1><p>保存完整剧本，再按镜头逐步制作。</p></div><button className="btn" disabled={busy} onClick={() => void run(async () => { const file = await window.blockout.pickFile([{ name: '剧本', extensions: ['txt', 'md'] }]); if (!file) return; const source = await window.blockout.readTextFile(file); if (useStore.getState().doc?.id === doc.id) mutate('导入剧本', (project) => { project.sourceScript = source }) })}>导入剧本</button></div>
        <section className="pf-card"><label className="pf-label">项目名称<input aria-label="项目名称" value={doc.name} onChange={(event) => mutate('修改项目名称', (project) => { project.name = event.target.value })} /></label><label className="pf-label">完整剧本<textarea className="pf-script" aria-label="完整剧本" value={doc.sourceScript?.text ?? ''} placeholder="在这里粘贴剧本。用空行分隔段落，方便稍后建立镜头草稿。" onChange={(event) => mutate('编辑剧本', (project) => { project.sourceScript = { name: project.sourceScript?.name ?? '剧本', text: event.target.value } })} /></label><div className="pf-row"><button className="btn" disabled={!doc.sourceScript?.text.trim()} onClick={() => mutate('保存剧本版本', (project) => { (project.scriptHistory ??= []).push({ id: newId('script'), name: `剧本版本 ${(project.scriptHistory?.length ?? 0) + 1}`, text: project.sourceScript!.text, createdAt: new Date().toISOString() }) })}>留存一个版本</button><button className="btn primary" onClick={() => setStep(1)}>下一步：拆分镜 →</button></div></section>
        {!!doc.scriptHistory?.length && <details className="pf-card"><summary>剧本版本 · {doc.scriptHistory.length}</summary>{[...doc.scriptHistory].reverse().map((version) => <div className="pf-row" key={version.id}><span>{version.name} · {new Date(version.createdAt).toLocaleString('zh-CN')}</span><button className="btn small" onClick={() => { if (window.confirm('恢复此剧本版本？当前文字可通过撤销恢复。')) mutate('恢复剧本版本', (project) => { project.sourceScript = { name: version.name, text: version.text } }) }}>恢复</button></div>)}</details>}
      </>}
      {step === 1 && <>
        <div className="pf-section-heading"><div><h1>把故事变成镜头</h1><p>逐镜写清画面、动作与时长。镜头顺序也是最终成片顺序。</p></div><button className="btn" onClick={addShot}>新增镜头</button></div>
        <ProductionBreakdown doc={doc} onAssets={() => setStep(2)} />
        <section className="pf-card"><div className="pf-row"><button className="btn" disabled={!doc.sourceScript?.text.trim()} onClick={() => {
          const paragraphs = scriptParagraphs(doc.sourceScript?.text ?? '')
          if (!paragraphs.length || !window.confirm(`按空行分段，追加${paragraphs.length}个镜头草稿？已有镜头保留。`)) return
          mutate('按段落建立镜头草稿', (project) => { const target = project.scenes.find((item) => item.id === scene.id)!; for (const paragraph of paragraphs) { const added = createShot(target, `镜头 ${target.shots.length + 1}`); added.storyboard = { content: paragraph, sourceName: project.sourceScript?.name }; target.shots.push(added) } }); toast('已建立段落草稿，请逐镜调整画面与节奏。', 'info')
        }}>按段落建立草稿</button><button className="btn" onClick={() => setAdvanced(!advanced)}>导演包与高级搭景</button><button className="btn" onClick={() => useStore.getState().setMode('director')}>导入导演包</button></div><p className="pf-muted">段落草稿按空行拆分；智能拆镜可使用已配置的模型服务。</p></section>
        {advanced && <div className="pf-advanced"><DirectorCorePanel /></div>}
        <section className="pf-card"><div className="pf-row"><h2>{shot.name}</h2><button className="btn small" disabled={!canMoveShot(-1)} onClick={() => moveShot(-1)}>上移</button><button className="btn small" disabled={!canMoveShot(1)} onClick={() => moveShot(1)}>下移</button><button className="btn small" disabled={shots.length <= 1} onClick={() => {
          if (!window.confirm('移除此镜头？可以撤销恢复。')) return
          const next = shots.find((item) => item.id !== shot.id)!
          const nextSceneId = doc.scenes.find((item) => item.shots.some((entry) => entry.id === next.id))!.id
          mutate('移除镜头', (project) => { const target = project.scenes.find((item) => item.id === scene.id)!; target.shots = target.shots.filter((item) => item.id !== shot.id); if (!target.shots.length && !target.drafts?.length) project.scenes = project.scenes.filter((item) => item.id !== target.id) }); useStore.getState().selectScene(nextSceneId); useStore.getState().selectShot(next.id)
        }}>移除</button></div><label className="pf-label">镜头名称<input aria-label="镜头名称" value={shot.name} onChange={(event) => changeShot(shot.id, '编辑镜头名称', (target) => { target.name = event.target.value })} /></label><label className="pf-label">画面、动作与对白<textarea rows={7} aria-label="分镜内容" value={shot.storyboard?.content ?? shot.notes ?? ''} onChange={(event) => changeShot(shot.id, '编辑分镜', (target) => { target.storyboard = { ...target.storyboard, content: event.target.value } })} /></label><div className="pf-two-fields"><label>镜头时长（秒）<input type="number" min={1} max={120} value={shot.duration} onChange={(event) => { const duration = Number(event.target.value); if (duration >= 1 && duration <= 120) changeShot(shot.id, '调整镜头时长', (target) => { target.duration = duration }) }} /></label><label>画幅<select value={shot.aspect} onChange={(event) => changeShot(shot.id, '调整画幅', (target) => { target.aspect = event.target.value as Shot['aspect'] })}><option>16:9</option><option>9:16</option><option>1:1</option></select></label></div></section>
      </>}
      {step === 2 && <>
        <div className="pf-section-heading"><div><h1>让人物、场景保持一致</h1><p>检查提示词，选定图片，素材自动关联到对应镜头。</p></div><button className="btn primary" disabled={busy} onClick={() => void importMedia()}>{busy ? '正在导入…' : '导入素材'}</button></div>
        <ProductionAssetChecklist doc={doc} folder={folder} />
        <details className="pf-card"><summary>其他素材与高级管理</summary><ProductionAssetMaker doc={doc} folder={folder} />
        <input className="pf-search" aria-label="搜索素材" placeholder="搜索素材名称…" value={search} onChange={(event) => setSearch(event.target.value)} />
        {!doc.productionMedia?.length && <div className="pf-empty pf-card">先导入人物图、场景图、动作视频或音频。<br />每份素材都有独立版本，重新导入会保留旧文件。</div>}
        <div className="pf-media-grid">{(doc.productionMedia ?? []).filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).map((media) => <article className="pf-card" key={media.id}><MediaPreview folder={folder} path={media.path} kind={media.kind} name={media.name} /><label>名称<input value={media.name} onChange={(event) => mutate('命名素材', (project) => { project.productionMedia!.find((item) => item.id === media.id)!.name = event.target.value })} /></label><label>素材说明<textarea rows={2} placeholder="人物身份、服装、场景或制作提示…" value={media.description ?? ''} onChange={(event) => mutate('编辑素材说明', (project) => { project.productionMedia!.find((item) => item.id === media.id)!.description = event.target.value })} /></label><small className="pf-muted">{media.width ? `${media.width}×${media.height} · ` : ''}{media.duration ? `${media.duration.toFixed(1)}秒 · ` : ''}{(media.sizeBytes / 1024 / 1024).toFixed(1)} MB</small></article>)}</div>
        </details>
      </>}
      {step === 3 && <>
        <div className="pf-section-heading"><div><h1>先看走位和镜头</h1><p>检查节奏、构图与动作，再把白模视频用作生成参考。</p></div><button className="btn" onClick={() => useStore.getState().setMode('stage')}>编辑场景与走位</button></div>
        <div className="pf-viewport"><Viewport /></div><WhiteModelWorkspace scene={scene} shot={shot} />
        {!!shot.previsExports?.length && <section className="pf-card"><h3>将白模用作生成参考</h3>{shot.previsExports.map((record) => <div className="pf-row" key={record.id}><span>{record.engine === 'blender' ? '高级' : '快速'}白模 · {record.relativePath.split('/').at(-1)}</span><button className="btn" disabled={busy} onClick={() => void run(async () => {
          const media = await window.blockout.importProductionMedia(folder, `${folder}/${record.relativePath}`)
          if (useStore.getState().doc?.id !== doc.id) return
          mutate('使用白模作为参考', (project) => { (project.productionMedia ??= []).push(media); const target = project.scenes.flatMap((item) => item.shots).find((item) => item.id === shot.id)!; (target.generationInput ??= defaultGenerationInput(target)).references.push({ mediaId: media.id, purpose: 'camera' }) }); setStep(4)
        })}>用于当前镜头生成</button></div>)}</section>}
      </>}
      {step === 4 && <GenerationPanel key={`${doc.id}:${shot.id}`} doc={doc} shot={shot} folder={folder} importMedia={importMedia} />}
      {step === 5 && <ProductionFilmPanel doc={doc} folder={folder} onShot={(id) => { const targetScene = doc.scenes.find((entry) => entry.shots.some((item) => item.id === id))!; useStore.getState().selectScene(targetScene.id); useStore.getState().selectShot(id); setStep(4) }} />}
    </div></div>
  </main>
}
