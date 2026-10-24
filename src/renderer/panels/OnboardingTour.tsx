import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { on } from '../bus'
import { useStore } from '../store'
import { GUIDE_STORAGE_KEY, GUIDE_TRACKS, placeGuideBubble, readGuideProgress, type GuideProgress, type GuideRect, type GuideTrack, type GuideView } from '../onboarding'
import '../onboarding.css'

interface Props {
  request: number
  homeOpen: boolean
  navigate(view: GuideView): void
  openSampleProject(): Promise<boolean>
}

function snapshot(): { entities: number; actors: string; camera: string; playing: boolean } {
  const s = useStore.getState()
  return {
    entities: s.scene()?.entities.length ?? 0,
    actors: JSON.stringify(s.scene()?.blocking ?? []),
    camera: JSON.stringify(s.shot()?.camera.marks ?? []), playing: s.playing
  }
}

export function OnboardingTour({ request, homeOpen, navigate, openSampleProject }: Props): JSX.Element | null {
  const [progress, setProgress] = useState<GuideProgress>(readGuideProgress)
  const [menu, setMenu] = useState(() => !readGuideProgress().seen)
  const [active, setActive] = useState(false)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [notice, setNotice] = useState('')
  const [rect, setRect] = useState<GuideRect | null>(null)
  const [size, setSize] = useState({ width: 360, height: 340 })
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const bubble = useRef<HTMLElement>(null)
  const autoWelcome = useRef(!readGuideProgress().seen)
  const track = GUIDE_TRACKS[progress.track]
  const step = track.steps[progress.step]!
  const shown = menu || active
  const exportRunning = useStore((state) => state.exportProgress.running)
  const locked = busy || rendering || exportRunning

  useEffect(() => on('guideRendering', ({ running }) => setRendering(running)), [])

  useEffect(() => {
    try { window.localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(progress)) } catch { /* Guide still works for this session. */ }
  }, [progress])

  useEffect(() => {
    if (!request) return
    autoWelcome.current = false
    setMenu(true)
    setActive(false)
    setNotice('')
  }, [request])

  useEffect(() => {
    if (!homeOpen && autoWelcome.current && !active) {
      autoWelcome.current = false
      setMenu(false)
      setProgress((value) => ({ ...value, seen: true }))
    }
  }, [homeOpen, active])

  const close = (): void => {
    autoWelcome.current = false
    setMenu(false)
    setActive(false)
    setProgress((value) => ({ ...value, seen: true }))
    document.querySelector<HTMLButtonElement>('[data-guide="launcher"]')?.focus()
  }

  useEffect(() => {
    if (!shown) return
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Let Esc cancel asset/mark placement before dismissing its instructions.
      const s = useStore.getState()
      if (active && (s.placingAssetId || s.droppingMarks || s.placingSequence || s.placingChoreography)) return
      event.preventDefault()
      event.stopPropagation()
      autoWelcome.current = false
      setMenu(false)
      setActive(false)
      setProgress((value) => ({ ...value, seen: true }))
      document.querySelector<HTMLButtonElement>('[data-guide="launcher"]')?.focus()
    }
    const outside = (event: PointerEvent): void => {
      if (!menu || bubble.current?.contains(event.target as Node)) return
      if ((event.target as Element).closest('[data-guide="launcher"]')) return
      autoWelcome.current = false
      setMenu(false)
      setProgress((value) => ({ ...value, seen: true }))
    }
    window.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside) }
  }, [shown, menu, active])

  useEffect(() => {
    if (!active) return
    setDone(false)
    setNotice('')
    navigate(step.view)
    const baseline = snapshot()
    const off = on('guideAction', ({ kind }) => { if (kind === step.check) setDone(true) })
    const unsubscribe = useStore.subscribe(() => {
      if (!step.check) return
      const state = useStore.getState()
      if ((step.check === 'entity-added' && (state.scene()?.entities.length ?? 0) > baseline.entities) ||
          (step.check === 'actor-marks' && JSON.stringify(state.scene()?.blocking ?? []) !== baseline.actors) ||
          (step.check === 'camera-marks' && JSON.stringify(state.shot()?.camera.marks ?? []) !== baseline.camera) ||
          (step.check === 'playing' && state.playing)) setDone(true)
    })
    return () => { off(); unsubscribe() }
  }, [active, progress.track, progress.step, navigate, step])

  useLayoutEffect(() => {
    if (!shown) return
    let frame = 0
    let revealed = false
    const refresh = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(menu ? '[data-guide="launcher"]' : step.target)
        if (target && !revealed) {
          revealed = true
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
        const r = target?.getBoundingClientRect()
        const width = window.innerWidth, height = window.innerHeight
        const visible = r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height && r.right > 0 && r.left < width
        const next = visible ? {
          left: Math.max(6, r.left), top: Math.max(6, r.top),
          width: Math.max(0, Math.min(width - 6, r.right) - Math.max(6, r.left)),
          height: Math.max(0, Math.min(height - 6, r.bottom) - Math.max(6, r.top))
        } : null
        setRect((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
        setViewport((v) => v.width === width && v.height === height ? v : { width, height })
        if (bubble.current) {
          const measured = { width: bubble.current.offsetWidth, height: bubble.current.offsetHeight }
          setSize((v) => v.width === measured.width && v.height === measured.height ? v : measured)
        }
      })
    }
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'hidden'] })
    const resize = new ResizeObserver(refresh)
    if (bubble.current) resize.observe(bubble.current)
    window.addEventListener('resize', refresh)
    document.addEventListener('scroll', refresh, true)
    refresh()
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect()
      window.removeEventListener('resize', refresh); document.removeEventListener('scroll', refresh, true)
    }
  }, [shown, menu, step, done])

  const start = async (id: GuideTrack, resume = false): Promise<void> => {
    if (locked) return
    setBusy(true)
    setNotice('')
    try {
      if (id === 'sample' && !resume && !await openSampleProject()) return
      autoWelcome.current = false
      useStore.getState().setHelpOpen(false)
      useStore.getState().setCoachOpen(false)
      useStore.getState().setPlaying(false)
      setProgress((value) => ({ ...value, seen: true, track: id, step: resume ? value.step : 0 }))
      setMenu(false)
      setActive(true)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '打开练习失败，请稍后重试。')
    } finally { setBusy(false) }
  }

  const move = (direction: number): void => {
    if (locked) return
    useStore.getState().setPlaying(false)
    useStore.getState().setDroppingMarks(false)
    if (step.check === 'entity-added') useStore.getState().setPlacingAsset(null)
    if (progress.step + direction >= track.steps.length) {
      setProgress((value) => ({ ...value, step: 0, viewed: [...new Set([...value.viewed, value.track])] }))
      setActive(false)
      setMenu(true)
      setNotice('已看完这条引导。可以继续另一条路线，或关闭后自由操作。')
    } else setProgress((value) => ({ ...value, step: Math.max(0, value.step + direction) }))
  }

  if (!shown) return null
  const position = placeGuideBubble(rect, size.width, size.height, viewport.width, viewport.height)
  const waiting = Boolean(step.check) && !done
  return createPortal(
    <div className="previs-guide-layer">
      {!menu && rect && <div className="previs-guide-spotlight" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} aria-hidden="true" />}
      <aside ref={bubble} className="previs-guide-bubble" style={{ left: position.left, top: position.top }} data-side={position.side} role="dialog" aria-modal="false" aria-labelledby="previs-guide-title" data-testid="previs-guide">
        <header><span>{menu ? '新手引导' : `${track.title} · ${progress.step + 1} / ${track.steps.length}`}</span><button type="button" aria-label="关闭新手引导" onClick={close}>×</button></header>
        <div className="previs-guide-body">
          <h2 id="previs-guide-title">{menu ? '从第一条白模视频开始' : step.title}</h2>
          {menu ? <>
            <p>第一次建议先跑内置示例。气泡会指向实际控件，操作区仍可点击；随时关闭，之后从顶栏“新手引导”继续。</p>
            {progress.seen && progress.step > 0 && <button className="btn guide-resume" disabled={locked} onClick={() => void start(progress.track, true)}>继续上次：{track.title}（第 {progress.step + 1} 步）</button>}
            <div className="previs-guide-routes">{(Object.keys(GUIDE_TRACKS) as GuideTrack[]).map((id, index) => <button key={id} type="button" disabled={locked} onClick={() => void start(id)}><b>{index + 1}. {GUIDE_TRACKS[id].title}{progress.viewed.includes(id) ? ' · 已浏览' : ''}</b><span>{GUIDE_TRACKS[id].description}</span></button>)}</div>
            {(rendering || exportRunning) && <p className="previs-guide-hint">请等待当前白模任务结束，再切换引导路线。</p>}
            {notice && <p className="previs-guide-notice" role="status">{notice}</p>}
            <button className="btn" disabled={busy} onClick={close}>{busy ? '正在准备练习…' : '稍后再看'}</button>
          </> : <>
            <p>{step.text}</p>
            {step.hint && <p className="previs-guide-hint">{step.hint}</p>}
            <p className="previs-guide-status" role="status">{done ? '已完成这个操作，可以继续。' : waiting ? '请先操作高亮控件，完成后再继续。' : '看清这一步后，点击下一步。'}</p>
            {!rect && !done && <button className="btn small" onClick={() => { navigate(step.view); requestAnimationFrame(() => document.querySelector(step.target)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })) }}>返回本步骤的页面</button>}
            <div className="previs-guide-navigation"><button className="btn" disabled={progress.step === 0 || locked} onClick={() => move(-1)}>上一步</button><button className="btn primary" disabled={waiting || locked} onClick={() => move(1)}>{progress.step === track.steps.length - 1 ? '完成这条引导' : '下一步'}</button></div>
            <div className="previs-guide-secondary"><button disabled={locked} onClick={() => { setActive(false); setMenu(true) }}>选择其他路线</button>{waiting && <button disabled={locked} onClick={() => move(1)}>跳过本步</button>}</div>
          </>}
        </div>
      </aside>
    </div>, document.body
  )
}
