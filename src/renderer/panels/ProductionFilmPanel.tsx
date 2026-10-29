import { useState } from 'react'
import type { ProjectDoc } from '@engine/types'
import { useStore, currentProjectJson } from '../store'
import { MediaPreview } from './ProductionWorkspace'

export function ProductionFilmPanel({ doc, folder, onShot }: { doc: ProjectDoc; folder: string; onShot: (id: string) => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mutate = useStore((state) => state.mutate)
  const shots = doc.scenes.flatMap((scene) => scene.shots)
  const ready = shots.filter((shot) => shot.productionAttempts?.some((item) => item.id === shot.selectedProductionAttemptId && item.status === 'complete' && item.localPath)).length
  const settings = doc.productionExport ?? { aspect: '16:9' as const }
  const edit = (id: string, patch: { trimStart?: number; trimEnd?: number; caption?: string }): void => mutate('编辑成片剪辑', (project) => {
    const shot = project.scenes.flatMap((scene) => scene.shots).find((item) => item.id === id)!
    shot.productionEdit = { ...shot.productionEdit, ...patch }
  })
  const exportFilm = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const json = currentProjectJson()
      if (!json) return
      await window.blockout.saveProject(folder, json)
      const output = await window.blockout.productionExportFilm(folder, doc.id)
      if (useStore.getState().doc?.id !== doc.id) return
      mutate('保存成片记录', (project) => { (project.productionFilms ??= []).push(output) })
      await window.blockout.saveProject(folder, currentProjectJson()!)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  return <>
    <div className="pf-section-heading"><div><h1>把采用的镜头连成影片</h1><p>调整首尾、填写字幕、选择配乐，再导出成片。{ready} / {shots.length} 个镜头就绪。</p></div></div>
    <section className="pf-card"><div className="pf-two-fields"><label>成片画幅<select aria-label="成片画幅" value={settings.aspect} onChange={(event) => mutate('设置成片画幅', (project) => { project.productionExport = { ...settings, aspect: event.target.value as typeof settings.aspect } })}><option>16:9</option><option>9:16</option><option>1:1</option></select></label><label>背景音乐<select aria-label="背景音乐" value={settings.musicMediaId ?? ''} onChange={(event) => mutate('选择背景音乐', (project) => { project.productionExport = { ...settings, musicMediaId: event.target.value || undefined } })}><option value="">不添加背景音乐</option>{doc.productionMedia?.filter((media) => media.kind === 'audio').map((media) => <option value={media.id} key={media.id}>{media.name}</option>)}</select></label></div><p className="pf-muted">保留各镜头原声，音乐以较低音量混入；不同尺寸自动适配画幅。字幕另外导出为 SRT 文件。</p></section>
    <section className="pf-card">{shots.map((shot, index) => <article key={shot.id} className="pf-film-shot"><div className="pf-export-row"><span>{String(index + 1).padStart(2, '0')}</span><b>{shot.name}</b><span>{shot.selectedProductionAttemptId ? '✓ 已采用' : '等待选择视频'}</span><button className="btn small" onClick={() => onShot(shot.id)}>查看视频</button></div><div className="pf-two-fields"><label>裁掉开头（秒）<input type="number" min={0} step={0.1} value={shot.productionEdit?.trimStart ?? 0} onChange={(event) => edit(shot.id, { trimStart: Math.max(0, Number(event.target.value)) })} /></label><label>裁掉结尾（秒）<input type="number" min={0} step={0.1} value={shot.productionEdit?.trimEnd ?? 0} onChange={(event) => edit(shot.id, { trimEnd: Math.max(0, Number(event.target.value)) })} /></label></div><label>本镜字幕<textarea rows={2} value={shot.productionEdit?.caption ?? ''} placeholder="填写对白或旁白字幕（可留空）" onChange={(event) => edit(shot.id, { caption: event.target.value })} /></label></article>)}<div className="pf-row"><button className="btn primary" disabled={busy || ready !== shots.length} onClick={() => void exportFilm()}>{busy ? '正在合成，请稍候…' : '导出 MP4 与字幕'}</button><button className="btn" onClick={() => void window.blockout.showFolder(folder)}>打开项目文件夹</button></div>{error && <p role="alert" className="pf-warning">{error}</p>}</section>
    {!!doc.productionFilms?.length && <section className="pf-card"><h3>已导出的成片</h3>{[...doc.productionFilms].reverse().map((film) => <details key={film.path}><summary>{new Date(film.createdAt).toLocaleString('zh-CN')} · {film.duration.toFixed(1)}秒</summary><MediaPreview folder={folder} path={film.path} kind="video" name="已导出成片" /><p>{film.path}</p><small>字幕：{film.subtitlePath}</small></details>)}</section>}
  </>
}
