// Modified from Blockout for the open-core Director Desk; see MODIFICATIONS.md.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, currentProjectJson } from './store'
import { Viewport } from './viewport/Viewport'
import { Library } from './panels/Library'
import { Inspector } from './panels/Inspector'
import { ProjectRail } from './panels/ProjectRail'
import { DirectorCorePanel } from './panels/DirectorCorePanel'
import { WhiteModelWorkspace } from './panels/WhiteModelWorkspace'
import { ProductionWorkspace } from './panels/ProductionWorkspace'
import { Timeline } from './panels/Timeline'
import { Toasts } from './panels/Toasts'
import { HelpOverlay, BlockingCoach } from './panels/Help'
import { useI18n } from './i18n'
import { emit } from './bus'
import { OnboardingTour } from './panels/OnboardingTour'
import type { GuideView } from './onboarding'

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
  const scene = useStore((state) => state.scene())
  const shot = useStore((state) => state.shot())
  const toast = useStore((state) => state.toast)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [homeOpen, setHomeOpen] = useState(true)
  const [guideRequest, setGuideRequest] = useState(0)
  const started = useRef(false)

  const save = useCallback(async (): Promise<void> => {
    const json = currentProjectJson()
    const currentFolder = useStore.getState().projectFolder
    if (!json || !currentFolder) return
    await window.blockout.saveProject(currentFolder, json)
    if (currentProjectJson() === json) markSaved()
    emit('guideAction', { kind: 'project-saved' })
  }, [markSaved])

  const restore = useCallback(async (projectFolder: string): Promise<boolean> => {
    const { json, backupJson, backupNewer } = await window.blockout.loadProject(projectFolder)
    const selected = backupNewer && backupJson ? backupJson : json ?? backupJson
    if (!selected || !loadFromJson(projectFolder, selected)) return false
    window.localStorage.setItem(LAST_PROJECT_KEY, projectFolder)
    if (selected === backupJson) toast('已恢复最近的自动保存。', 'info')
    return true
  }, [loadFromJson, toast])

  const openDemo = useCallback(async (): Promise<boolean> => {
    if (useStore.getState().dirty && !window.confirm('当前项目还有未保存修改。请先保存；仍要切换到独立示例项目吗？')) return false
    const project = await window.blockout.createDemoProject()
    newDemoProject(project.folder, project.name)
    await save()
    window.localStorage.setItem(LAST_PROJECT_KEY, project.folder)
    return true
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
    emit('guideAction', { kind: 'project-created' })
  }, [dirty, newProject, save])

  const guideNavigate = useCallback((view: GuideView): void => {
    useStore.getState().setHelpOpen(false)
    useStore.getState().setCoachOpen(false)
    setHomeOpen(false)
    setSettingsOpen(view === 'settings')
    const destination = view === 'settings' ? 'stage' : view
    // Staying on the same page must preserve the asset the learner just picked.
    if (useStore.getState().mode !== destination) setMode(destination)
  }, [setMode])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const recent = window.localStorage.getItem(LAST_PROJECT_KEY)
      if (recent) {
        try { if (await restore(recent)) return } catch { /* start a blank project */ }
        window.localStorage.removeItem(LAST_PROJECT_KEY)
      }
      try {
        const project = await window.blockout.createProductionProject()
        newProject(project.folder, project.name)
        await save()
        window.localStorage.setItem(LAST_PROJECT_KEY, project.folder)
      } catch (error) { toast(String(error), 'error') }
    })()
  }, [newProject, save, restore, toast])

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
      if (homeOpen) return
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
  }, [homeOpen, save])

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
        <span className="app-name">艾琳导演台 · 开源核心</span>
        {!homeOpen && <button className="btn small" onClick={() => { useStore.getState().setPlaying(false); setHomeOpen(true) }}>返回首页</button>}
        {!homeOpen && <>
        <span className="project-title">{doc.name}{dirty ? ' •' : ''}</span>
        <div className="mode-switch">
          <button aria-label="PRODUCTION" className={mode === 'production' ? 'active' : ''} onClick={() => setMode('production')}>全流程制作</button>
          <button aria-label="DIRECTOR" className={mode === 'director' ? 'active' : ''} onClick={() => setMode('director')}>导演包</button>
          <button aria-label="STAGE" className={mode === 'stage' ? 'active' : ''} onClick={() => setMode('stage')}>{t('mode.stage')}</button>
          <button aria-label="SHOOT" className={mode === 'shoot' ? 'active' : ''} onClick={() => setMode('shoot')}>{t('mode.shoot')}</button>
          <button aria-label="DELIVER" className={mode === 'deliver' ? 'active' : ''} onClick={() => setMode('deliver')}>白模交付</button>
        </div>
        <button className="btn small" aria-label="Save" data-guide="save" onClick={() => void save()}>{t('common.save')}</button>
        <button className="btn small" onClick={() => setSettingsOpen(true)}>项目与说明</button>
        <button className="btn small" onClick={() => useStore.getState().setHelpOpen(true)}>{t('common.help')}</button>
        </>}
        <button className="btn small" data-guide="launcher" onClick={() => { setSettingsOpen(false); useStore.getState().setHelpOpen(false); useStore.getState().setCoachOpen(false); setGuideRequest((value) => value + 1) }}>新手引导</button>
      </div>
      {homeOpen ? (
        <main className="previs-home" aria-label="导演台首页">
          <div className="previs-home-content">
            <h1>开始你的故事</h1>
            <p>选择一种方式开始。</p>
            <div className="previs-home-actions">
              <button className="previs-home-choice" onClick={() => { setMode('production'); setHomeOpen(false) }}>
                <strong>开始全流程制作</strong>
                <span>写剧本、拆分镜、做素材、看预演、生成视频与导出成片。</span>
              </button>
              <button className="previs-home-choice" onClick={() => { setMode('director'); setHomeOpen(false) }}>
                <strong>导演包一键生成白模预演</strong>
                <span>导入导演包，核对镜头，一键生成可编辑预演。</span>
              </button>
              <button className="previs-home-choice" onClick={() => { setMode('stage'); setHomeOpen(false) }}>
                <strong>手动搭建白模预演</strong>
                <span>摆放人物与道具，调整走位、动作和摄影机。</span>
              </button>
            </div>
          </div>
        </main>
      ) : mode === 'production' ? (
        <ProductionWorkspace />
      ) : mode === 'director' ? (
        <div className="director-layout">
          <DirectorCorePanel />
          <div className="director-preview"><Viewport /><span className="director-preview-label">当前可编辑 3D 场景</span></div>
        </div>
      ) : mode === 'deliver' ? (
        <div className="deliver-layout">
          <div className="deliver-export-runtime"><Viewport /></div>
          <div className="core-delivery-content">
            <div className="director-heading"><div><div className="director-kicker">可编辑场景 → MP4 白模参考</div><h1>白模交付</h1><p>逐镜头选择 Three.js 快速白模或 Blender 高级白模。高级方式真实调用本机 Blender 与 FFmpeg，输出 MP4、.blend 和检查图。</p></div></div>
            <div className="core-delivery-selectors">
              <label>场景<select aria-label="交付场景" value={scene?.id ?? ''} onChange={(event) => useStore.getState().selectScene(event.target.value)}>{doc.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>镜头<select aria-label="交付镜头" value={shot?.id ?? ''} onChange={(event) => useStore.getState().selectShot(event.target.value)}>{scene?.shots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>
            {scene && shot ? <WhiteModelWorkspace scene={scene} shot={shot} /> : <p>请先在“导演包”生成预演镜头。</p>}
          </div>
        </div>
      ) : (
        <div className="main">
          <div className="panel"><ProjectRail />{mode === 'stage' && <div data-guide="library"><Library /></div>}</div>
          <div className="center-column"><div className="viewport-wrap"><Viewport /></div>{mode === 'shoot' && <Timeline />}</div>
          <div className="panel right" data-guide="inspector"><Inspector /></div>
        </div>
      )}
      <Toasts />
      {settingsOpen && (
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-label="项目与说明" onClick={(event) => event.stopPropagation()}>
            <header className="settings-header"><div><span>AILIN DIRECTOR PREVIS</span><h2>项目与说明</h2></div><button className="btn small" onClick={() => setSettingsOpen(false)}>完成</button></header>
            <div className="settings-body">
              <section className="settings-section"><h3>{doc.name}{dirty ? ' · 未保存' : ''}</h3><div className="settings-actions"><button className="btn primary" onClick={() => void openProject()}>打开项目</button><button className="btn" data-guide="new-project" onClick={() => void createProject()}>新建项目</button><button className="btn" onClick={() => void openDemo()}>载入示例</button></div></section>
              <section className="settings-section"><h3>界面与帮助</h3><div className="settings-actions"><button className="btn" onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}>{locale === 'zh-CN' ? 'Switch to English' : '切换到中文'}</button><button className="btn" onClick={() => { setSettingsOpen(false); useStore.getState().setHelpOpen(true) }}>使用说明</button></div></section>
              <section className="settings-section settings-about"><h3>关于</h3><p>剧本 → 分镜 → 资产与参考素材 → 白模预演 → 云端视频 → 成片。也支持导入外部 Agent 导演包。</p><p>基于 Sam Wasserman 的 Blockout；源代码采用 Apache-2.0，参见 LICENSE、NOTICE 与 MODIFICATIONS.md。</p></section>
            </div>
          </section>
        </div>
      )}
      <HelpOverlay />
      {!homeOpen && <BlockingCoach />}
      <OnboardingTour request={guideRequest} homeOpen={homeOpen} navigate={guideNavigate} openSampleProject={openDemo} />
    </div>
  )
}
