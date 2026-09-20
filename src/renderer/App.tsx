// Modified from Blockout for the open-core Director Desk; see MODIFICATIONS.md.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, currentProjectJson } from './store'
import { Viewport } from './viewport/Viewport'
import { Library } from './panels/Library'
import { Inspector } from './panels/Inspector'
import { ProjectRail } from './panels/ProjectRail'
import { Timeline } from './panels/Timeline'
import { Toasts } from './panels/Toasts'
import { HelpOverlay, BlockingCoach } from './panels/Help'
import { useI18n } from './i18n'

const LAST_PROJECT_KEY = 'director.lastProjectFolder'
const PLATFORM_CLASS = `platform-${window.blockout.platform.platform}`

export function App(): JSX.Element {
  const { locale, setLocale, t } = useI18n()
  const doc = useStore((state) => state.doc)
  const dirty = useStore((state) => state.dirty)
  const mode = useStore((state) => state.mode)
  const folder = useStore((state) => state.projectFolder)
  const newProject = useStore((state) => state.newProject)
  const newDemoProject = useStore((state) => state.newDemoProject)
  const loadFromJson = useStore((state) => state.loadFromJson)
  const markSaved = useStore((state) => state.markSaved)
  const setMode = useStore((state) => state.setMode)
  const toast = useStore((state) => state.toast)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const started = useRef(false)

  const save = useCallback(async (): Promise<void> => {
    const json = currentProjectJson()
    const currentFolder = useStore.getState().projectFolder
    if (!json || !currentFolder) return
    await window.blockout.saveProject(currentFolder, json)
    if (currentProjectJson() === json) markSaved()
  }, [markSaved])

  const restore = useCallback(async (projectFolder: string): Promise<boolean> => {
    const { json, backupJson, backupNewer } = await window.blockout.loadProject(projectFolder)
    const selected = backupNewer && backupJson ? backupJson : json ?? backupJson
    if (!selected || !loadFromJson(projectFolder, selected)) return false
    window.localStorage.setItem(LAST_PROJECT_KEY, projectFolder)
    if (selected === backupJson) toast('已恢复最近的自动保存。', 'info')
    return true
  }, [loadFromJson, toast])

  const openDemo = useCallback(async (): Promise<void> => {
    const project = await window.blockout.createDemoProject()
    newDemoProject(project.folder, project.name)
    await save()
    window.localStorage.setItem(LAST_PROJECT_KEY, project.folder)
  }, [newDemoProject, save])

  const openProject = useCallback(async (): Promise<void> => {
    if (dirty && !window.confirm('当前项目还有未保存修改。确定要切换项目吗？')) return
    const selected = await window.blockout.openProjectDialog()
    if (!selected) return
    if (!await restore(selected)) toast('无法打开该项目。', 'error')
    else setSettingsOpen(false)
  }, [dirty, restore, toast])

  const createProject = useCallback(async (): Promise<void> => {
    if (dirty && !window.confirm('当前项目还有未保存修改。确定要切换项目吗？')) return
    const selected = await window.blockout.newProjectDialog()
    if (!selected) return
    newProject(selected.folder, selected.name)
    await save()
    window.localStorage.setItem(LAST_PROJECT_KEY, selected.folder)
    setSettingsOpen(false)
  }, [dirty, newProject, save])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const recent = window.localStorage.getItem(LAST_PROJECT_KEY)
      if (recent) {
        try { if (await restore(recent)) return } catch { /* fall back to demo */ }
        window.localStorage.removeItem(LAST_PROJECT_KEY)
      }
      try { await openDemo() } catch (error) { toast(String(error), 'error') }
    })()
  }, [openDemo, restore, toast])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    if (!doc || !folder) return
    const timer = window.setInterval(() => {
      const json = currentProjectJson()
      if (json) void window.blockout.saveBackup(folder, json)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [Boolean(doc), folder])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const state = useStore.getState()
      if (!state.doc) return
      const focused = document.activeElement
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement) return
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
      } else if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      } else if (event.key === ' ') {
        event.preventDefault()
        state.setPlaying(!state.playing)
      } else if (event.key.toLowerCase() === 'm' && state.selection &&
        (state.selection.kind === 'entity' || state.selection.kind === 'camera')) {
        state.setDroppingMarks(!state.droppingMarks)
      } else if (event.key.toLowerCase() === 'c') {
        state.setLookThrough(!state.lookThrough)
      } else if (event.key === '?') {
        state.setHelpOpen(!state.helpOpen)
      } else if (event.key === 'Escape') {
        if (state.helpOpen) state.setHelpOpen(false)
        else {
          state.setPlacingAsset(null)
          state.setPlacingSequence(null)
          state.setPlacingChoreography(null)
          state.setDroppingMarks(false)
          state.setSelection(null)
        }
      } else if (event.key >= '1' && event.key <= '9') {
        const mark = state.shot()?.camera.marks.slice().sort((a, b) => a.time - b.time)[Number(event.key) - 1]
        if (mark) state.setTime(mark.time)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  if (!doc) return (
    <div className={`app ${PLATFORM_CLASS}`}>
      <div className="startup-gate" aria-label="正在进入导演台">
        <div className="startup-gate-mark">导</div>
        <b>正在进入导演台</b>
      </div>
      <Toasts />
    </div>
  )

  return (
    <div className={`app ${PLATFORM_CLASS}`}>
      <div className="titlebar">
        <span className="app-name">艾琳导演台 · 白模预演</span>
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{doc.name}{dirty ? ' •' : ''}</span>
        <div className="mode-switch">
          <button aria-label="STAGE" className={mode === 'stage' ? 'active' : ''} onClick={() => setMode('stage')}>{t('mode.stage')}</button>
          <button aria-label="SHOOT" className={mode === 'shoot' ? 'active' : ''} onClick={() => setMode('shoot')}>{t('mode.shoot')}</button>
        </div>
        <button className="btn small" aria-label="Save" onClick={() => void save()}>{t('common.save')}</button>
        <button className="btn small" onClick={() => setSettingsOpen(true)}>项目与说明</button>
        <button className="btn small" onClick={() => useStore.getState().setHelpOpen(true)}>{t('common.help')}</button>
      </div>
      <div className="main">
        <div className="panel">
          <ProjectRail />
          {mode === 'stage' && <Library />}
        </div>
        <div className="center-column">
          <div className="viewport-wrap"><Viewport /></div>
          {mode === 'shoot' && <Timeline />}
        </div>
        <div className="panel right"><Inspector /></div>
      </div>
      <Toasts />
      {settingsOpen && (
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-label="项目与说明" onClick={(event) => event.stopPropagation()}>
            <header className="settings-header"><div><span>AILIN DIRECTOR PREVIS</span><h2>项目与说明</h2></div><button className="btn small" onClick={() => setSettingsOpen(false)}>完成</button></header>
            <div className="settings-body">
              <section className="settings-section"><h3>{doc.name}{dirty ? ' · 未保存' : ''}</h3><div className="settings-actions"><button className="btn primary" onClick={() => void openProject()}>打开项目</button><button className="btn" onClick={() => void createProject()}>新建项目</button><button className="btn" onClick={() => void openDemo()}>载入示例</button></div></section>
              <section className="settings-section"><h3>界面与帮助</h3><div className="settings-actions"><button className="btn" onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}>{locale === 'zh-CN' ? 'Switch to English' : '切换到中文'}</button><button className="btn" onClick={() => { setSettingsOpen(false); useStore.getState().setHelpOpen(true) }}>使用说明</button></div></section>
              <section className="settings-section settings-about"><h3>关于</h3><p>搭景、调度镜头，并生成 Three.js 或 Blender 白模预演视频。</p><p>基于 Sam Wasserman 的 Blockout；源代码采用 Apache-2.0，参见 LICENSE、NOTICE 与 MODIFICATIONS.md。</p></section>
            </div>
          </section>
        </div>
      )}
      <HelpOverlay />
      <BlockingCoach />
    </div>
  )
}
