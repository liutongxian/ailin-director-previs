import { useEffect, useMemo, useRef, useState } from 'react'
import { approvePrevisExport, previsExportEngine, registerPrevisExport, selectedWhiteModelEngine, type WhiteModelEngine } from '@engine/previs-delivery'
import { newId } from '@engine/ids'
import type { PrevisExportRecord, Scene, Shot } from '@engine/types'
import type { BlenderJobSnapshot } from '../../shared/blender-job'
import { exportShot } from '../export/exporter'
import { compileEditableBlenderPlan } from '../export/blender-plan'
import { useStore } from '../store'
import { emit } from '../bus'

function useProjectVideo(folder: string | null, relativePath?: string): { url: string | null; invalid: boolean } {
  const [url, setUrl] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    let live = true
    let objectUrl: string | null = null
    setUrl(null)
    setInvalid(false)
    if (!folder || !relativePath) return () => { live = false }
    void window.blockout.readProjectFile(folder, relativePath).then((buffer) => {
      if (!live) return
      objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }))
      setUrl(objectUrl)
    }).catch(() => { if (live) setInvalid(true) })
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [folder, relativePath])
  return { url, invalid }
}

function EnginePreview({
  engine,
  record,
  approved,
  folder,
  onApprove,
  onShowFolder
}: {
  engine: WhiteModelEngine
  record?: PrevisExportRecord
  approved: boolean
  folder: string | null
  onApprove(id: string): void
  onShowFolder(record: PrevisExportRecord): void
}): JSX.Element {
  const media = useProjectVideo(folder, record?.relativePath)
  const blender = engine === 'blender'
  return (
    <article className={`white-model-preview-card engine-${engine}${approved ? ' is-approved' : ''}`}>
      <header>
        <div><b>{blender ? '高级白模 · Blender' : '快速白模 · Three.js'}</b><span>{blender ? '高质量复核' : '实时调整'}</span></div>
        {approved && <em>交付使用中</em>}
      </header>
      {record ? (
        <>
          {media.url && !media.invalid
            ? <video controls preload="metadata" src={media.url} />
            : <div className="white-model-empty">{media.invalid ? '视频文件无法读取' : '正在载入预演…'}</div>}
          <small>{record.duration.toFixed(2)}s · {record.width}×{record.height} · {record.fps}fps</small>
          <div className="white-model-card-actions">
            {!approved && <button className="btn small" onClick={() => onApprove(record.id)}>设为最终交付参考</button>}
            <button className="btn small" onClick={() => onShowFolder(record)}>打开输出位置</button>
          </div>
        </>
      ) : (
        <div className="white-model-empty">尚未生成此方式的白模预演</div>
      )}
    </article>
  )
}

export function WhiteModelWorkspace({ scene, shot }: { scene: Scene; shot: Shot }): JSX.Element {
  const doc = useStore((state) => state.doc)
  const folder = useStore((state) => state.projectFolder)
  const mutate = useStore((state) => state.mutate)
  const toast = useStore((state) => state.toast)
  const [threeRunning, setThreeRunning] = useState(false)
  const [blenderJob, setBlenderJob] = useState<BlenderJobSnapshot | null>(null)
  const [blenderPlanVideo, setBlenderPlanVideo] = useState<string | null>(null)
  const registeredBlenderJob = useRef<string | null>(null)
  const engine = selectedWhiteModelEngine(shot)
  const records = useMemo(() => [...(shot.previsExports ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [shot.previsExports])
  const latest = (target: WhiteModelEngine): PrevisExportRecord | undefined => records.find((record) => previsExportEngine(record) === target)
  const approved = shot.previsExports?.find((record) => record.id === shot.approvedPrevisId)

  useEffect(() => {
    emit('guideRendering', { running: threeRunning || ['queued', 'running'].includes(blenderJob?.status ?? '') })
    return () => emit('guideRendering', { running: false })
  }, [threeRunning, blenderJob?.status])

  useEffect(() => {
    if (!blenderJob || !['queued', 'running'].includes(blenderJob.status)) return
    let live = true
    const timer = window.setInterval(() => {
      void window.blockout.blenderGet(blenderJob.id).then((next) => {
        if (live) setBlenderJob(next)
      }).catch((error) => {
        if (live) setBlenderJob((current) => current ? { ...current, status: 'failed', error: String(error) } : current)
      })
    }, 500)
    return () => { live = false; window.clearInterval(timer) }
  }, [blenderJob?.id, blenderJob?.status])

  useEffect(() => {
    if (!blenderJob || blenderJob.status !== 'complete' || registeredBlenderJob.current === blenderJob.id || !blenderPlanVideo || !doc) return
    registeredBlenderJob.current = blenderJob.id
    const plan = compileEditableBlenderPlan({ projectName: doc.name, scene, shot })
    mutate('register Blender white model', (project) => {
      const targetScene = project.scenes.find((item) => item.id === scene.id)
      const target = [...(targetScene?.shots ?? []), ...(targetScene?.drafts ?? [])].find((item) => item.id === shot.id)
      if (!target) return
      registerPrevisExport(target, {
        id: newId('previs'),
        relativePath: `${blenderJob.outputRelativePath}/${blenderPlanVideo}`,
        packageRelativePath: blenderJob.outputRelativePath,
        createdAt: blenderJob.completedAt ?? new Date().toISOString(),
        duration: plan.shot.durationSeconds,
        fps: plan.shot.fps,
        width: plan.shot.resolution.width,
        height: plan.shot.resolution.height,
        aspect: plan.shot.aspect,
        engine: 'blender'
      })
    })
    toast('Blender高级白模已生成，可在右侧播放并选择为最终交付参考。', 'success')
    emit('guideAction', { kind: 'video-exported' })
  }, [blenderJob?.id, blenderJob?.status, blenderPlanVideo, doc, scene.id, shot.id])

  const chooseEngine = (next: WhiteModelEngine): void => {
    mutate('select white model engine', (project) => {
    const targetScene = project.scenes.find((item) => item.id === scene.id)
    const target = [...(targetScene?.shots ?? []), ...(targetScene?.drafts ?? [])].find((item) => item.id === shot.id)
    if (target) target.whiteModelEngine = next
    })
  }

  const reportThreeFailure = (message: string): void => {
    toast(message.includes('no export job')
      ? '白模编码器未能启动或提前退出。请检查 FFmpeg 的安装与配置后再试。'
      : message, 'error')
  }

  const generateThree = async (): Promise<void> => {
    if (!folder || threeRunning) return
    setThreeRunning(true)
    try {
      const result = await exportShot({
        profileId: 'minimax-h3-ref2va', passes: { clean: true, depth: false, normal: false },
        labels: 'off', resolution: 'auto', fpsOverride: 24
      })
      if (!result.ok || !result.referenceVideo) {
        reportThreeFailure(result.error ?? 'Three.js快速白模生成失败。')
        return
      }
      mutate('register Three.js white model', (project) => {
        const targetScene = project.scenes.find((item) => item.id === scene.id)
        const target = [...(targetScene?.shots ?? []), ...(targetScene?.drafts ?? [])].find((item) => item.id === shot.id)
        if (target) registerPrevisExport(target, { id: newId('previs'), createdAt: new Date().toISOString(), engine: 'threejs', ...result.referenceVideo! })
      })
      toast('Three.js快速白模已生成，可在右侧播放检查。', 'success')
      emit('guideAction', { kind: 'video-exported' })
    } catch (error) {
      reportThreeFailure(error instanceof Error ? error.message : '快速白模生成失败，请检查 FFmpeg 配置。')
    } finally {
      setThreeRunning(false)
    }
  }

  const generateBlender = async (): Promise<void> => {
    if (!folder || !doc || ['queued', 'running'].includes(blenderJob?.status ?? '')) return
    const plan = compileEditableBlenderPlan({ projectName: doc.name, scene, shot })
    setBlenderPlanVideo(plan.outputs.video)
    registeredBlenderJob.current = null
    const started = await window.blockout.blenderStart(folder, plan)
    setBlenderJob(started)
    if (started.status === 'failed') toast(started.error ?? 'Blender高级白模启动失败。', 'error')
  }

  const generate = (): void => {
    if (engine === 'blender') void generateBlender()
    else void generateThree()
  }

  const approve = (recordId: string): void => {
    mutate('approve white model for delivery', (project) => {
      const targetScene = project.scenes.find((item) => item.id === scene.id)
      const target = [...(targetScene?.shots ?? []), ...(targetScene?.drafts ?? [])].find((item) => item.id === shot.id)
      if (target) approvePrevisExport(target, recordId, new Date().toISOString())
    })
    toast('已设为最终交付页使用的白模参考视频。', 'success')
  }

  const showRecordFolder = (record: PrevisExportRecord): void => {
    if (folder) void window.blockout.showFolder(`${folder.replace(/[\\/]+$/u, '')}/${record.packageRelativePath}`)
  }

  const running = threeRunning || ['queued', 'running'].includes(blenderJob?.status ?? '')
  const progress = blenderJob?.progress.total ? Math.round(blenderJob.progress.frame / blenderJob.progress.total * 100) : 0

  return (
    <div className="white-model-workspace" data-testid="white-model-workspace">
      <section className="panel-section">
        <div className="panel-title">白模生成方式</div>
        <div className="white-model-engine-picker">
          <button aria-label="快速白模 Three.js" className={engine === 'threejs' ? 'active' : ''} onClick={() => chooseEngine('threejs')}>
            <b>快速白模</b><span>Three.js · 实时可调</span>
          </button>
          <button aria-label="高级白模 Blender" className={engine === 'blender' ? 'active advanced' : 'advanced'} onClick={() => chooseEngine('blender')}>
            <b>高级白模</b><span>Blender · 精细交付</span>
          </button>
        </div>
        {engine === 'blender' && <p className="white-model-advanced-hint"><b>高级生成</b>：生成更慢，可输出 `.blend`、首中尾检查图和高质量MP4，适合最终复核与交付。</p>}
        <button className="btn primary white-model-generate" disabled={running || !folder} onClick={generate}>
          {running ? '正在生成白模…' : engine === 'blender' ? '生成当前Blender高级白模' : '生成当前Three.js快速白模'}
        </button>
        {blenderJob && <div className={`white-model-job is-${blenderJob.status}`}><span>{blenderJob.status === 'complete' ? 'Blender生成完成' : blenderJob.status === 'failed' ? 'Blender生成失败' : blenderJob.status === 'cancelled' ? 'Blender任务已取消' : `Blender生成中 ${progress}%`}</span>{blenderJob.error && <small>{blenderJob.error}</small>}</div>}
      </section>
      <section className="panel-section white-model-previews">
        <div className="panel-title">当前镜头的两种白模版本</div>
        <p>两种方式都读取当前搭景、走位和摄影机；选择其中一个作为最终交付参考。</p>
        <EnginePreview engine="threejs" record={latest('threejs')} approved={previsExportEngine(approved ?? {}) === 'threejs' && Boolean(approved)} folder={folder} onApprove={approve} onShowFolder={showRecordFolder} />
        <EnginePreview engine="blender" record={latest('blender')} approved={previsExportEngine(approved ?? {}) === 'blender' && Boolean(approved)} folder={folder} onApprove={approve} onShowFolder={showRecordFolder} />
      </section>
    </div>
  )
}
