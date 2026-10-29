import { useEffect, useState } from 'react'
import { ASSET_MODELS, DEFAULT_LOCAL_QWEN, defaultAssetDraft, type AssetCreationDraft, type AssetCreationJob } from '@engine/production-assets'
import type { ProjectDoc } from '@engine/types'
import { newId } from '@engine/ids'
import { hasUnreceivedAssetJobs, receiveAssetJobs } from '@engine/production-asset-plan'
import { useStore, currentProjectJson } from '../store'

const assetKeys: Record<string, string> = {}
export function ProductionAssetMaker({ doc, folder, assetNeedId }: { doc: ProjectDoc; folder: string; assetNeedId?: string }): JSX.Element {
  const need = doc.productionAssetPlan?.find((item) => item.id === assetNeedId)
  const defaults = doc.productionAssetDraft ?? defaultAssetDraft()
  const input: AssetCreationDraft = need ? { ...defaults, assetNeedId: need.id, name: need.name, prompt: need.prompt, referenceIds: need.referenceIds } : { ...defaults, assetNeedId: undefined }
  const local = input.model === 'qwen-image-2.1-local'
  const localOptions = input.localQwen ?? DEFAULT_LOCAL_QWEN
  const provider = local ? 'local-qwen' : input.model === 'image-01' ? 'minimax' : 'volcengine-ark'
  const providerName = provider === 'minimax' ? 'MiniMax' : '火山方舟'
  const [key, setKey] = useState(assetKeys[provider] ?? '')
  const [environmentKey, setEnvironmentKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [jobs, setJobs] = useState<AssetCreationJob[]>([])
  const [connection, setConnection] = useState('')
  const [checking, setChecking] = useState(false)
  const mutate = useStore((state) => state.mutate)
  const merge = (rows: AssetCreationJob[]): void => {
    if (useStore.getState().doc?.id !== doc.id || useStore.getState().projectFolder !== folder) return
    setJobs(rows)
    if (hasUnreceivedAssetJobs(useStore.getState().doc!, rows)) mutate('接收生成素材并关联镜头', (project) => receiveAssetJobs(project, rows))
  }
  useEffect(() => {
    let live = true
    void window.blockout.productionAssetJobs(folder, doc.id).then((rows) => { if (live) merge(rows) }).catch((reason) => { if (live) setError(String(reason)) })
    return () => { live = false }
  }, [folder, doc.id])
  useEffect(() => {
    let live = true
    setKey(assetKeys[provider] ?? ''); setEnvironmentKey(false)
    if (provider !== 'local-qwen') void window.blockout.cloudVideoKeyStatus(provider).then((result) => { if (live) setEnvironmentKey(result.available) }).catch(() => {})
    return () => { live = false }
  }, [provider])
  useEffect(() => {
    if (!jobs.some((job) => job.status === 'submitting')) return
    let live = true
    const timer = window.setTimeout(() => { void window.blockout.productionAssetJobs(folder, doc.id).then((rows) => { if (live) merge(rows) }).catch((reason) => { if (live) setError(String(reason)) }) }, 1000)
    return () => { live = false; window.clearTimeout(timer) }
  }, [folder, doc.id, jobs])
  const edit = (patch: Partial<AssetCreationDraft>): void => mutate('编辑素材制作描述', (project) => {
    if (need) {
      const target = project.productionAssetPlan!.find((item) => item.id === need.id)!
      if (patch.name !== undefined) target.name = patch.name
      if (patch.prompt !== undefined) target.prompt = patch.prompt
      if (patch.referenceIds !== undefined) target.referenceIds = patch.referenceIds
      if (patch.model || patch.size || patch.localQwen) project.productionAssetDraft = { ...(project.productionAssetDraft ?? defaultAssetDraft()), ...(patch.model ? { model: patch.model } : {}), ...(patch.size ? { size: patch.size } : {}), ...(patch.localQwen ? { localQwen: patch.localQwen } : {}) }
    } else project.productionAssetDraft = { ...input, ...patch, assetNeedId: undefined }
  })
  useEffect(() => { setConnection('') }, [localOptions.baseUrl, key])
  const checkConnection = async (): Promise<void> => {
    setChecking(true); setConnection('')
    try { setConnection((await window.blockout.productionLocalQwenStatus(localOptions.baseUrl, key)).message) }
    catch (reason) { setConnection(String(reason)) } finally { setChecking(false) }
  }
  const generate = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (useStore.getState().doc?.id !== doc.id || useStore.getState().projectFolder !== folder) return
      mutate('保存本次素材输入', (project) => { project.productionAssetDraft = structuredClone(input) })
      await window.blockout.saveProject(folder, currentProjectJson()!)
      const result = await window.blockout.productionGenerateAsset(folder, doc.id, newId('assetjob'), key, input)
      merge([...jobs, result])
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <details className="pf-card" open={need ? true : undefined}><summary>{need ? `制作素材 · ${need.name}` : '制作新素材 · 生成图片'}</summary><p>{need ? '提示词已根据分镜整理，可直接修改。参考图用于保持身份与画风一致。' : '描述人物、场景或道具，可选择已有图片作为参考。生成后自动进入项目素材库。'}</p>
    <div className="pf-two-fields"><label>素材名称<input aria-label="制作素材名称" value={input.name} onChange={(event) => edit({ name: event.target.value })} /></label><label>图片模型<select value={input.model} onChange={(event) => edit({ model: event.target.value, ...(event.target.value === 'image-01' ? { size: '2K' as const } : {}) })}>{ASSET_MODELS.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}</select></label></div>
    <label>图片提示词<textarea aria-label="素材生成描述" rows={4} value={input.prompt} onChange={(event) => edit({ prompt: event.target.value })} placeholder="描述人物外貌与服装、场景布局、道具造型或画风…" /></label>
    {provider !== 'minimax' && <details><summary>选择参考图 · {input.referenceIds.length} 张</summary><div className="pf-picker">{!doc.productionMedia?.some((media) => media.kind === 'image') && <p>先导入图片，即可选作参考。</p>}{doc.productionMedia?.filter((media) => media.kind === 'image').map((media) => <label key={media.id}><input type="checkbox" checked={input.referenceIds.includes(media.id)} disabled={!input.referenceIds.includes(media.id) && input.referenceIds.length >= 14} onChange={() => edit({ referenceIds: input.referenceIds.includes(media.id) ? input.referenceIds.filter((id) => id !== media.id) : [...input.referenceIds, media.id] })} />{media.name}</label>)}</div></details>}
    {local ? <details open><summary>本地连接与图片设置</summary><p className="pf-muted">连接已启动的 Unsloth Studio，并在其中加载 Qwen-Image 2.1。另一台电脑请填写它的局域网或 Tailscale 地址。</p><label>本地生图服务地址<input value={localOptions.baseUrl} onChange={(event) => edit({ localQwen: { ...localOptions, baseUrl: event.target.value } })} /></label><label>Unsloth 登录密码<input type="password" autoComplete="off" value={key} placeholder="只在本次打开期间使用；同机安装可自动读取" onChange={(event) => { setKey(event.target.value); assetKeys[provider] = event.target.value }} /></label><button className="btn small" disabled={checking} onClick={() => void checkConnection()}>{checking ? '正在检查…' : '检查本地连接'}</button>{connection && <p role="status">{connection}</p>}<div className="pf-two-fields"><label>本地图片比例<select value={`${localOptions.width}x${localOptions.height}`} onChange={(event) => { const [width, height] = event.target.value.split('x').map(Number); edit({ localQwen: { ...localOptions, width: width!, height: height! } }) }}><option value="768x768">方形 · 768×768</option><option value="576x768">竖图 · 576×768</option><option value="1024x576">横图 · 1024×576</option></select></label><label>生成步数<input type="number" min={1} max={50} value={localOptions.steps} onChange={(event) => edit({ localQwen: { ...localOptions, steps: Number(event.target.value) } })} /></label></div></details> : <div className="pf-two-fields"><label>图片尺寸<select value={input.size} onChange={(event) => edit({ size: event.target.value as AssetCreationDraft['size'] })}><option>2K</option>{provider !== 'minimax' && <option>4K</option>}</select></label><label>{providerName} API 密钥<input type="password" aria-label="素材制作API密钥" autoComplete="off" value={key} onChange={(event) => { setKey(event.target.value); assetKeys[provider] = event.target.value }} placeholder={environmentKey ? '已检测到环境密钥，可留空' : '只在本次打开期间使用'} /></label></div>}
    {provider === 'minimax' && !!input.referenceIds.length && <p className="pf-warning">已选参考图；请切换 Seedream 使用参考图，或<button className="btn small" onClick={() => edit({ referenceIds: [] })}>清空参考图</button></p>}<button className="btn primary" disabled={busy || !input.prompt.trim() || !local && !key && !environmentKey || jobs.some((job) => ['submitting', 'unknown'].includes(job.status))} onClick={() => void generate()}>{busy ? '正在生成图片…' : '生成一张素材'}</button><p className="pf-muted">{local ? '使用本地模型生成，首次运行可能较慢。' : `点击后使用${providerName}额度。`}生成记录保存本次描述、参考版本和输出文件。</p>
    {error && <p className="pf-warning" role="alert">{error}</p>}
    {jobs.map((job) => <div className="pf-row" key={job.id}><span>{job.input.name} · {job.status === 'complete' ? '已入库' : job.status === 'dismissed' ? '已关闭' : '待核对'}</span>{job.error && <span className="pf-warning">{job.error}</span>}{job.status === 'unknown' && <button className="btn small" onClick={() => { if (window.confirm('请先核对供应商后台。确认关闭此条未知记录？')) void window.blockout.productionDismissAsset(folder, job.id).then(() => window.blockout.productionAssetJobs(folder, doc.id)).then(merge).catch((reason) => setError(String(reason))) }}>已核对，关闭记录</button>}</div>)}
  </details>
}
