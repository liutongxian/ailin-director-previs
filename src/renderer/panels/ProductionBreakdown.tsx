import { useEffect, useRef, useState } from 'react'
import type { ProjectDoc } from '@engine/types'
import { applyProductionBreakdown } from '@engine/production-storyboard'
import { useStore } from '../store'

export function ProductionBreakdown({ doc, onAssets }: { doc: ProjectDoc; onAssets: () => void }): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('director.model.baseUrl') ?? '')
  const [model, setModel] = useState(() => localStorage.getItem('director.model.name') ?? '')
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(() => !localStorage.getItem('director.model.baseUrl') || !localStorage.getItem('director.model.name'))
  const request = useRef<string | null>(null)
  useEffect(() => {
    let live = true
    void window.blockout.directorCredentialStatus().then((status) => { if (live) setSaved(status.saved) }).catch(() => {})
    return () => { live = false; if (request.current) { void window.blockout.cancelScriptModel(request.current); request.current = null } }
  }, [])
  const analyze = async (): Promise<void> => {
    if (request.current) return
    const source = doc.sourceScript?.text ?? ''
    const originalFolder = useStore.getState().projectFolder
    const id = crypto.randomUUID()
    request.current = id; setBusy(true); setFeedback('正在拆镜并整理人物、场景与道具…')
    localStorage.setItem('director.model.baseUrl', baseUrl.trim()); localStorage.setItem('director.model.name', model.trim())
    try {
      const result = await window.blockout.analyzeScriptWithModel({ baseUrl: baseUrl.trim(), model: model.trim(), ...(key.trim() ? { apiKey: key.trim() } : {}) }, source, [], id)
      if (request.current !== id) return
      if (!result.ok) throw new Error(result.error)
      const state = useStore.getState()
      if (state.doc?.id !== doc.id || state.projectFolder !== originalFolder) return
      if (state.doc.sourceScript?.text !== source) throw new Error('剧本已修改，本次结果未应用。请按最新剧本重新拆镜。')
      let firstId = ''
      state.mutate('智能拆镜并整理资产', (project) => { firstId = applyProductionBreakdown(project, result.text) })
      if (firstId) {
        const scene = useStore.getState().doc?.scenes.find((item) => item.shots.some((shot) => shot.id === firstId))
        if (scene) useStore.getState().selectScene(scene.id)
        useStore.getState().selectShot(firstId)
      }
      const count = useStore.getState().doc?.productionAssetPlan?.filter((item) => item.sourceShotIds.length).length ?? 0
      setFeedback(`拆镜完成，已整理 ${count} 项资产和图片提示词。检查镜头后即可制作素材。`)
    } catch (error) { if (request.current === id) setFeedback(error instanceof Error ? error.message : String(error)) }
    finally { if (request.current === id) { request.current = null; setBusy(false) } }
  }
  return <section className="pf-card">
    <div className="pf-row"><button className="btn primary" disabled={busy || !doc.sourceScript?.text.trim() || !baseUrl.trim() || !model.trim()} onClick={() => void analyze()}>{busy ? '正在拆镜…' : '智能拆镜并整理素材'}</button>
      {busy && <button className="btn" onClick={() => { if (request.current) void window.blockout.cancelScriptModel(request.current); request.current = null; setBusy(false); setFeedback('已取消。') }}>取消</button>}
      {!!doc.productionAssetPlan?.length && <button className="btn" onClick={onAssets}>检查资产清单 →</button>}
    </div>
    <p className="pf-muted">一次整理镜头、资产和图片提示词。重新拆镜保留手动修改与已有素材，新镜头追加到列表。</p>
    <details open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}><summary>拆镜模型设置</summary><div className="pf-two-fields"><label>服务地址<input aria-label="拆镜服务地址" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="填写兼容接口地址" /></label><label>文字模型<input aria-label="拆镜文字模型" value={model} onChange={(event) => setModel(event.target.value)} /></label></div><label>API 密钥<input aria-label="拆镜API密钥" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder={saved ? '已有本机加密密钥，可留空' : '仅本次打开期间使用；本地免密服务可留空'} /></label></details>
    {feedback && <p role="status">{feedback}</p>}
  </section>
}
