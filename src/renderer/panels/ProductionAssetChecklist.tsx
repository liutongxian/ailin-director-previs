import { useState } from 'react'
import type { ProjectDoc } from '@engine/types'
import { ASSET_KIND_LABELS, selectAssetMedia, syncAssetReferences, syncProductionAssetPlan } from '@engine/production-asset-plan'
import { useStore } from '../store'
import { MediaPreview } from './ProductionWorkspace'
import { ProductionAssetMaker } from './ProductionAssetMaker'

export function ProductionAssetChecklist({ doc, folder }: { doc: ProjectDoc; folder: string }): JSX.Element {
  const needs = doc.productionAssetPlan ?? []
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const need = needs.find((item) => item.id === selected) ?? needs[0]
  const mutate = useStore((state) => state.mutate)
  const shots = doc.scenes.flatMap((scene) => scene.shots)
  const choose = (mediaId: string): void => mutate('选定资产并关联镜头', (project) => selectAssetMedia(project, need!.id, mediaId))
  const importImage = async (): Promise<void> => {
    if (!need || busy) return
    setBusy(true); setError('')
    try {
      const file = await window.blockout.pickFile([{ name: '资产图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])
      if (!file) return
      const media = await window.blockout.importProductionMedia(folder, file)
      if (useStore.getState().doc?.id !== doc.id || useStore.getState().projectFolder !== folder) return
      mutate('导入资产并关联镜头', (project) => { (project.productionMedia ??= []).push(media); selectAssetMedia(project, need.id, media.id) })
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <section aria-label="资产清单">
    <div className="pf-row"><h2>资产清单</h2><span>{needs.filter((item) => item.selectedMediaId).length} / {needs.length} 项已选素材</span><button className="btn small" disabled={!doc.previsIR} onClick={() => mutate('重新整理资产清单', syncProductionAssetPlan)}>从分镜更新清单</button></div>
    {!need ? <p className="pf-card pf-empty">智能拆镜后，这里会自动列出人物、场景和道具，并准备图片提示词。按段落建立的草稿需要先做智能拆镜。</p> : <div className="pf-asset-workbench">
      <div className="pf-asset-list" aria-label="选择资产">{needs.map((item) => <button key={item.id} className={need.id === item.id ? 'active' : ''} onClick={() => setSelected(item.id)}><span className="pf-badge">{ASSET_KIND_LABELS[item.kind]}</span><b>{item.name}</b><small>{item.shotIds.length ? `用于 ${item.shotIds.length} 个镜头` : '暂无关联镜头'} · {item.selectedMediaId ? '已选素材' : '待制作'}</small></button>)}</div>
      <div className="pf-asset-detail" key={need.id}>
        <ProductionAssetMaker doc={doc} folder={folder} assetNeedId={need.id} />
        <section className="pf-card"><div className="pf-row"><h3>选定素材</h3><button className="btn small" disabled={busy} onClick={() => void importImage()}>{busy ? '导入中…' : '导入图片并关联'}</button></div>
          <label>也可以使用素材库图片<select aria-label="选择已有资产图片" value={need.selectedMediaId ?? ''} onChange={(event) => { if (event.target.value) choose(event.target.value) }}><option value="">选择一张已有图片</option>{doc.productionMedia?.filter((media) => media.kind === 'image').map((media) => <option key={media.id} value={media.id}>{media.name}</option>)}</select></label>
          <p className="pf-muted">首张生成图自动关联到对应镜头；重做会保留旧图，选定新版本后再替换。</p>
          <div className="pf-asset-versions">{need.mediaIds.map((id) => doc.productionMedia?.find((media) => media.id === id)).filter((media) => !!media).map((media) => <article key={media.id}><MediaPreview folder={folder} path={media.path} name={media.name} kind="image" /><button className={need.selectedMediaId === media.id ? 'btn primary' : 'btn'} disabled={need.selectedMediaId === media.id} onClick={() => choose(media.id)}>{need.selectedMediaId === media.id ? '✓ 当前使用' : '使用这张并关联'}</button></article>)}</div>
          {error && <p className="pf-warning" role="alert">{error}</p>}
        </section>
        <details className="pf-card"><summary>对应镜头 · {need.shotIds.length} 个</summary><div className="pf-picker">{shots.map((shot) => <label key={shot.id}><input type="checkbox" aria-label={`关联${shot.name}`} checked={need.shotIds.includes(shot.id)} onChange={() => mutate('调整资产关联镜头', (project) => { const target = project.productionAssetPlan!.find((item) => item.id === need.id)!; target.shotIds = target.shotIds.includes(shot.id) ? target.shotIds.filter((id) => id !== shot.id) : [...target.shotIds, shot.id]; syncAssetReferences(project) })} />{shot.name}</label>)}</div><p className="pf-muted">{shots.filter((shot) => need.shotIds.includes(shot.id)).map((shot) => shot.name).join('、') || '此资产暂未用于镜头，已有图片继续保留。'}</p></details>
        <details className="pf-card"><summary>查看分镜依据与原始提示词</summary><p className="pf-preserve">{need.description}</p><p className="pf-preserve">{need.generatedPrompt}</p><button className="btn small" onClick={() => mutate('恢复资产建议提示词', (project) => { const target = project.productionAssetPlan!.find((item) => item.id === need.id)!; target.prompt = target.generatedPrompt })}>使用建议提示词</button></details>
      </div>
    </div>}
  </section>
}
