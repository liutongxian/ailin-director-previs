// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Help overlay, redesigned for a filmmaker skimming (not reading):
 *   • Quick start — six visual cards, the whole app at a glance.
 *   • How do I…? — a live-searchable task list distilled from the reference.
 *   • Shortcuts — the keyboard reference as a tidy kbd grid.
 * Opened from the titlebar ?, the welcome screen, or the ? key. Esc closes
 * (wired outside via the helpOpen store flag).
 */

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { useI18n } from '../i18n'

const MOD = window.blockout.platform.primaryModifier
const ALT = window.blockout.platform.alternateModifier

function Kbd({ children }: { children: string }): JSX.Element {
  return <kbd className="help-kbd">{children}</kbd>
}

/* ---------------------------- Quick start cards --------------------------- */

interface Card {
  emoji: string
  title: string
  body: string
  then: string
}

const CARDS: Card[] = [
  {
    emoji: '📋',
    title: 'Import a director package',
    body: 'In DIRECTOR, copy the full prompt for an external agent, then import its .ailinpack or .ailin.json file.',
    then: 'then: review the shot cards and start/middle/end summaries.'
  },
  {
    emoji: '🎬',
    title: 'Build editable previs',
    body: 'Use the one-click build button to create scenes and shots from the reviewed package.',
    then: 'then: each shot remains editable.'
  },
  {
    emoji: '🏗',
    title: 'Stage your set',
    body: 'In STAGE, adjust the imported people, props, environment, and lighting.',
    then: 'then: check the cast positions and labels.'
  },
  {
    emoji: '🚶',
    title: 'Check the motion',
    body: 'In SHOOT, review character paths and camera marks on the timeline; play the shot.',
    then: 'then: adjust timing or camera framing if needed.'
  },
  {
    emoji: '⚙️',
    title: 'Prepare local tools',
    body: 'Install FFmpeg for Three.js export; install Blender and FFmpeg for advanced Blender export.',
    then: 'then: make both tools available on PATH or configure their executable paths.'
  },
  {
    emoji: '📦',
    title: 'Render a white-model MP4',
    body: 'In DELIVER, select a scene and shot, choose Three.js or Blender, and generate the current white-model video.',
    then: 'then: play the result and open its output folder; repeat for other shots.'
  }
]

/* ------------------------------- How do I…? ------------------------------- */

interface Task {
  q: string
  a: JSX.Element
}

const TASKS: { area: string; items: Task[] }[] = [
  {
    area: 'Stage',
    items: [
      {
        q: 'How do I put a set and people in the scene?',
        a: (
          <>
            In <b>STAGE</b> mode, click a Library item (a person, prop, or a whole environment kit),
            then click the floor. Hold <Kbd>{ALT}</Kbd> to place several; <Kbd>Esc</Kbd> cancels.
          </>
        )
      },
      {
        q: 'How do I move, rotate, or duplicate something?',
        a: (
          <>
            Click to select, then drag the arrows to move. Press <Kbd>R</Kbd> to rotate,{' '}
            <Kbd>G</Kbd> back to move, <Kbd>{`${MOD}D`}</Kbd> to duplicate, <Kbd>⌫</Kbd> to delete.
          </>
        )
      },
      {
        q: 'How do I name a character for the AI generator?',
        a: (
          <>
            Select the person and type a label like <b>HERO</b> in the inspector, then pick a color.
            It floats above them, tints the model, and tells the generator who is who.
          </>
        )
      },
      {
        q: 'How do I pose someone without animating?',
        a: (
          <>
            Use the inspector&apos;s <b>Pose</b> section — Stand, Sit, Crouch, Lie, Talk, Fallen.
            Open <b>Pose limbs</b> for 14 sliders to build fight or dance stances.
          </>
        )
      },
      {
        q: 'How do I put a rider on a bike so they move together?',
        a: (
          <>
            Place the person, then choose <b>Marry to…</b> the bike in their inspector. Drag the
            bike and the rider comes along; <b>Unmarry</b> separates them.
          </>
        )
      },
      {
        q: 'How do I move a whole crowd I placed?',
        a: (
          <>
            Marry every performer to one lead, then move that lead — the group follows. Or{' '}
            <Kbd>⇧</Kbd>-click them all and drag, since a multi-selection moves as one.
          </>
        )
      },
      {
        q: 'How do I set the lighting?',
        a: (
          <>
            With nothing selected, the inspector shows the scene: pick a preset (Day, Golden hour,
            Night, Club…), drag the sun, add fog. Generators read light direction from your reference.
          </>
        )
      },
      {
        q: 'How do I get a real sky over the scene?',
        a: (
          <>
            Pick a physical-sky preset — <b>Midday Sky</b>, <b>Golden Sky</b>, or <b>Blue Hour Sky</b> —
            in the scene inspector. The sky is lit from the sun azimuth/elevation and renders into the
            clean export (it stays out of the depth and normal passes).
          </>
        )
      },
      {
        q: 'How do I stage a scene from a photo?',
        a: (
          <>
            <b>Populate from reference…</b> at the bottom of the Library stages people, poses,
            lighting, and a matching camera from an image. Needs a Claude API key; one <Kbd>{`${MOD}Z`}</Kbd> undoes it all.
          </>
        )
      },
      {
        q: 'How do I bring in my own 3D model?',
        a: (
          <>
            <b>Import 3D Model…</b> in the Library loads a GLB/glTF and copies it into the project.
          </>
        )
      },
      {
        q: 'How do I block inside a real location I scanned?',
        a: (
          <>
            Scan a place with your phone (Polycam, Luma, Scaniverse) or any video-to-3D tool, then{' '}
            <b>Import 3D scan…</b> in the Library. Position it with the inspector&apos;s Scans fields
            and block the action inside it. Scans are a staging aid — they stay out of every export.
          </>
        )
      },
      {
        q: 'How do I keep something out of the render but visible while I work?',
        a: (
          <>
            Select it and tick <b>Hide in exports</b> in the inspector. It stays in the editor but
            drops out of every rendered pass.
          </>
        )
      }
    ]
  },
  {
    area: 'Shoot',
    items: [
      {
        q: 'How do I make someone walk a path?',
        a: (
          <>
            In <b>SHOOT</b>, select them, press <Kbd>M</Kbd>, and click the floor to drop marks.
            They walk between marks on the timeline; select a mark to set its gait or hold.
          </>
        )
      },
      {
        q: 'How do I puppeteer someone with my mouse instead?',
        a: (
          <>
            Select a character or vehicle and press <b>● Record performer</b> — steer with the
            cursor and the gait matches your speed. <b>■ Stop</b> saves; re-record to replace it.
          </>
        )
      },
      {
        q: 'How do I run a take — rehearse, record, review?',
        a: (
          <>
            The <b>Take bar</b> in Shoot walks the whole loop: <b>🔁 Rehearse</b> plays the blocking
            with path ribbons on; <b>⏺ Record camera</b> / <b>⏺ Record performance</b> start after a
            3-2-1 countdown; <b>▶ Review</b> plays back through the shot camera. Click the countdown to cancel.
          </>
        )
      },
      {
        q: 'How do I show or hide the floor marks and paths?',
        a: (
          <>
            The viewport HUD has <b>MARKS</b> and <b>PATHS</b> eye toggles. Marks are the numbered
            spike-tape T&apos;s; selecting an actor or the camera adds direction chevrons and{' '}
            <b>t=2.4s</b> time labels along its path. Both are editor-only — they never appear in an export.
          </>
        )
      },
      {
        q: 'How do I learn blocking step by step?',
        a: (
          <>
            Open the <b>Set your marks</b> coach from the Quick start tab — a checklist that ticks
            itself off as you select an actor, drop two marks, play, record, and open the export.
          </>
        )
      },
      {
        q: 'How do I make two people fight?',
        a: (
          <>
            Select a person, open the <b>Animate</b> tab, and Apply a fight move — it lays down
            editable pose marks at the playhead. Do the same on their opponent to trade blows.
          </>
        )
      },
      {
        q: 'How do I make a character dance?',
        a: (
          <>
            Select them and Apply a dance from the <b>Animate</b> tab (hip-hop, salsa, moonwalk,
            breakdance…). Or in Stage, drop a whole <b>Dance number</b> sequence at once.
          </>
        )
      },
      {
        q: 'How do I fly a plate across the room?',
        a: (
          <>
            Select any entity and Apply a flight from <b>Action presets</b>, or <b>● Record</b> it
            and use the <b>scroll wheel for altitude</b>. Set a mark&apos;s <b>Altitude</b> by hand later.
          </>
        )
      },
      {
        q: 'How do I land a plane or topple a building?',
        a: (
          <>
            Aim the entity first, then Apply from <b>Action presets</b> — plane takeoff / landing /
            flyby, heli orbit, car chase moves, falling debris, building topple. The path starts
            from where it stands.
          </>
        )
      },
      {
        q: 'How do I have someone board a bus or get off a plane?',
        a: (
          <>
            Select an actor&apos;s last mark and set <b>Board on arrival → the Bus</b>. To alight,
            marry them to a parked plane, then give them marks that start after it lands.
          </>
        )
      },
      {
        q: 'How do I retime or delete a move on the timeline?',
        a: (
          <>
            Drag a pill to retime it, drag its right edge to add a hold, and double-click to delete.
            <Kbd>⇧</Kbd>-click to multi-select pills.
          </>
        )
      },
      {
        q: 'How do I make a whole choreographed group at once?',
        a: (
          <>
            In Stage, the <b>Sequences</b> box stages a full cast: Dance number, Fight, Foot chase,
            or Car chase. Set the count and style, and it drops them already choreographed.
          </>
        )
      },
      {
        q: 'How do I choreograph a real routine — timed exchanges and formations?',
        a: (
          <>
            The <b>Choreographer</b> panel builds staged dance phrases, paired fight exchanges, and
            chases with formations, canon, and mirroring. <b>Spawn</b> a fresh cast, or select people
            you already placed and <b>Apply to selection</b>. The dice re-rolls the seed.
          </>
        )
      }
    ]
  },
  {
    area: 'Camera',
    items: [
      {
        q: 'How do I frame a shot?',
        a: (
          <>
            Select the camera and press <Kbd>C</Kbd> to look through it, then pick a shot size
            (WS/MS/CU) to auto-frame, or a framing (<b>2-SHOT / OTS / REV / TOP / LOW / DUTCH</b>).
          </>
        )
      },
      {
        q: 'How do I move the camera during a shot?',
        a: (
          <>
            Frame it, drop <b>+ Cam mark</b>, move and reframe, drop another — it travels between
            marks. Pick a <b>rig</b> (dolly, steadicam, handheld, crane, drone) for the motion feel.
          </>
        )
      },
      {
        q: 'How do I use one of the ready-made camera moves?',
        a: (
          <>
            The camera inspector has <b>39 moves</b> — orbits, cranes, drone follows, whip pan,
            vertigo dolly-zoom, spiral in/out, crash-zoom, dutch roll. One click lays down editable
            marks around your subject.
          </>
        )
      },
      {
        q: 'How do I track a plane with the camera?',
        a: (
          <>
            Turn on <b>Track subject</b> in the camera inspector and pick the subject — the aim
            locks on no matter how it moves, and focus follows too.
          </>
        )
      },
      {
        q: 'How do I fly the camera like an operator?',
        a: (
          <>
            Select the camera and press <b>● Record camera</b> — your blocking replays while you
            orbit, pan, and zoom the view, and your flight becomes the move, synced to the action.
          </>
        )
      },
      {
        q: 'How do I add a second camera?',
        a: (
          <>
            <b>Cameras (A/B/C)</b> at the top of the camera inspector: <b>+</b> adds Camera B with
            its own marks and rig. The chips switch between them; the export uses the active one.
          </>
        )
      },
      {
        q: 'How do I watch exactly what will export?',
        a: (
          <>
            <b>▶ Play shot</b> plays through the shot camera — the exact export frame. The{' '}
            <b>SHOT PREVIEW</b> box shows it live; <Kbd>Space</Kbd> plays, <Kbd>1–9</Kbd> jump to camera marks.
          </>
        )
      },
      {
        q: 'How do I match an existing shot?',
        a: (
          <>
            <b>🎞 Ref</b> ghosts any video (even a depth-map video) over the viewport, synced to
            your timeline — recreate its blocking by eye and adjust opacity and offset.
          </>
        )
      },
      {
        q: 'How do I try a risky version without losing my shot?',
        a: (
          <>
            Hover the shot in the left rail and click <b>+ Draft</b> — it snapshots as &quot;1A v1&quot;.
            Drafts play and export like shots; <b>▲</b> promotes one back to the real shot.
          </>
        )
      }
    ]
  },
  {
    area: 'Deliver',
    items: [
      {
        q: 'How do I import an external agent’s director package?',
        a: (
          <>
            In <b>DIRECTOR</b>, copy the full director-package prompt and give it with your script
            to an external agent. Import the resulting <b>.ailinpack</b> or <b>.ailin.json</b>,
            review the shot cards, then build all editable 3D previs scenes.
          </>
        )
      },
      {
        q: 'How do I generate a white-model reference video?',
        a: (
          <>
            In <b>DELIVER</b>, select a scene and shot, choose <b>Three.js</b> or <b>Blender</b>,
            then generate the current white-model MP4. Preview it and open its output folder.
          </>
        )
      },
      {
        q: 'What do I need to install for video export?',
        a: (
          <>
            <b>Three.js</b> export needs local FFmpeg. <b>Blender</b> export needs local Blender
            and FFmpeg. Put the tools on PATH or set their executable paths before launching the app.
          </>
        )
      },
      {
        q: 'What does Blender export include?',
        a: (
          <>
            The shot output folder contains an H.264 MP4, an editable <b>.blend</b> file,
            inspection images, and a render log.
          </>
        )
      },
      {
        q: 'How do I render multiple shots?',
        a: (
          <>
            Select each scene and shot in <b>DELIVER</b> and generate its white-model MP4.
            This open-core release exports one shot at a time; it does not stitch a long video.
          </>
        )
      },
      {
        q: 'How do I take the blocking into Blender?',
        a: (
          <>
            In <b>DELIVER</b>, choose <b>Blender</b> and generate the selected shot.
            Open its output folder for the editable <b>.blend</b> and MP4.
          </>
        )
      }
    ]
  },
  {
    area: 'Projects',
    items: [
      {
        q: 'How do I save a set to reuse in another project?',
        a: (
          <>
            <b>Stage Presets</b> save the current staging (set + characters + blocking) globally.
            Stage it as a fresh scene in any project; the original never changes.
          </>
        )
      },
      {
        q: 'How do I shoot the same action from another angle?',
        a: (
          <>
            The scene owns the blocking and each shot owns its own camera, so make a{' '}
            <b>new shot</b> and just reframe — no need to redo the moves.
          </>
        )
      },
      {
        q: 'How do I recover work after a crash?',
        a: (
          <>
            A backup autosaves every minute; after a crash, <b>Open Project</b> restores the
            unsaved work. A project is just a folder of readable JSON, safe to back up or git.
          </>
        )
      },
      {
        q: 'How do I let an AI agent drive the app?',
        a: (
          <>
            Register <b>mcp/blockout-mcp.mjs</b> with Claude Code, Codex, or Hermes — the agent can
            stage scenes, frame shots, and screenshot the viewport. See mcp/README.md.
          </>
        )
      }
    ]
  }
]

/* ------------------------------- Shortcuts -------------------------------- */

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause the shot'],
  ['M', 'Drop marks for the selection (click the floor)'],
  ['C', 'Look through the shot camera'],
  ['G / R', 'Gizmo: move / rotate'],
  ['⇧-click', 'Multi-select entities, or marks on the timeline'],
  [`${MOD}A / ⇧${MOD}A`, 'Select all marks in the shot / in the current lane'],
  [`${MOD}D`, 'Duplicate selection'],
  ['⌫', 'Delete selection (all of a multi-selection)'],
  [`${MOD}Z / ⇧${MOD}Z`, 'Undo / redo — every action is undoable'],
  [`${MOD}S`, 'Save project'],
  ['1–9', 'Jump to camera mark N'],
  [`${ALT}-click`, 'Place multiple copies while staging'],
  ['Esc', 'Cancel placement / mark-dropping / selection'],
  ['?', 'Open this help']
]

/* --------------------------- Blocking coach ------------------------------ */

interface CoachStep {
  key: string
  label: string
  hint: string
}

const COACH_STEPS: CoachStep[] = [
  { key: 'select', label: 'Select an actor or vehicle', hint: 'Click a character in the viewport.' },
  { key: 'mark1', label: 'Press M and drop the first mark', hint: 'M, then click the floor where they start.' },
  { key: 'mark2', label: 'Drop a second mark', hint: 'Click again further along — they walk between marks.' },
  { key: 'play', label: 'Press Space to watch it walk', hint: 'Space plays the shot; the path ribbon shows the route.' },
  { key: 'record', label: 'Try ⏺ Record to puppeteer', hint: 'Record camera or performance from the Take bar.' },
  { key: 'export', label: 'Open DELIVER to export', hint: 'Switch to Deliver to render a white-model MP4.' }
]

const COACH_STEPS_ZH: CoachStep[] = [
  { key: 'select', label: '选择一个人物或车辆', hint: '在预演画面中点击要调度的对象。' },
  { key: 'mark1', label: '按 M，放下第一个走位点', hint: '按 M，再点击地面上的起始位置。' },
  { key: 'mark2', label: '放下第二个走位点', hint: '继续点击下一个位置；对象会在两点间移动。' },
  { key: 'play', label: '按空格预览走位', hint: '播放镜头后，路径带会显示完整路线。' },
  { key: 'record', label: '尝试“录制”直接操控', hint: '从拍摄控制条录制摄影机或人物表演。' },
  { key: 'export', label: '打开“白模交付”导出', hint: '切换到白模交付页，生成当前镜头的白模 MP4。' }
]

/**
 * "Set your marks" walkthrough. A lightweight renderer-side component that
 * watches the store: each step ticks itself off when the app reaches the
 * matching state. Dismissible; re-openable from Help. Mounted at the app root.
 */
export function BlockingCoach(): JSX.Element | null {
  const { locale } = useI18n()
  const open = useStore((s) => s.coachOpen)
  const setOpen = useStore((s) => s.setCoachOpen)
  const [done, setDone] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!open) return
    const check = (): void => {
      const s = useStore.getState()
      setDone((prev) => {
        const next = { ...prev }
        if (s.selection?.kind === 'entity' || s.selection?.kind === 'entities') next.select = true
        const scene = s.scene()
        const shot = s.shot()
        const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
        const maxMarks = take ? Math.max(0, ...take.tracks.map((t) => t.marks.length)) : 0
        if (maxMarks >= 1) next.mark1 = true
        if (maxMarks >= 2) next.mark2 = true
        if (s.playing) next.play = true
        if (s.recording) next.record = true
        if (s.mode === 'deliver') next.export = true
        return next
      })
    }
    check()
    const unsub = useStore.subscribe(check)
    return unsub
  }, [open])

  if (!open) return null
  const steps = locale === 'zh-CN' ? COACH_STEPS_ZH : COACH_STEPS
  const currentIdx = steps.findIndex((st) => !done[st.key])
  const allDone = currentIdx === -1

  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        bottom: 16,
        width: 300,
        zIndex: 30,
        background: 'var(--panel, #16181d)',
        border: '1px solid var(--border-strong, #33343a)',
        borderRadius: 10,
        padding: '14px 16px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 15 }}>🎯</span>
        <b style={{ fontSize: 13 }}>{locale === 'zh-CN' ? '设置走位' : 'Set your marks'}</b>
        <span style={{ flex: 1 }} />
        <button className="btn small" style={{ padding: '2px 8px' }} onClick={() => setOpen(false)} title="Dismiss (re-open from Help)">
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {steps.map((st, i) => {
          const isDone = !!done[st.key]
          const isCurrent = i === currentIdx
          return (
            <div key={st.key} style={{ display: 'flex', gap: 8, opacity: isDone ? 0.7 : isCurrent ? 1 : 0.5 }}>
              <span style={{ fontSize: 13 }}>{isDone ? '✅' : isCurrent ? '▶' : '○'}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: isCurrent ? 700 : 500, textDecoration: isDone ? 'line-through' : 'none' }}>
                  {st.label}
                </div>
                {isCurrent && <div style={{ fontSize: 11, color: 'var(--text-faint, #8a8d96)', marginTop: 2 }}>{st.hint}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {allDone && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--success, #46a758)' }}>
          {locale === 'zh-CN' ? '第一次走位已经完成，可以随时关闭这个引导。' : <>That&apos;s the whole loop — nice. Close this any time.</>}
        </div>
      )}
    </div>
  )
}

/* -------------------------------- overlay -------------------------------- */

type Tab = 'quickstart' | 'tasks' | 'shortcuts'

const CARDS_ZH: Card[] = [
  {
    emoji: '📋',
    title: '1. 导入导演包',
    body: '在“导演包”复制完整提示词，连同自己的剧本交给外部 Agent；导入返回的 .ailinpack 或 .ailin.json。',
    then: '接着：核对镜头卡、时长与首／中／尾摘要。'
  },
  {
    emoji: '🎬',
    title: '2. 一键生成可编辑预演',
    body: '确认镜头卡后，点击“一键生成全部可编辑 3D 预演”，得到可继续修改的场景和镜头。',
    then: '接着：检查生成的站位和摄影机。'
  },
  {
    emoji: '🏗',
    title: '3. 搭景调整',
    body: '在“搭景”调整人物、道具、场景和灯光。选择人物后可修改名称、位置与姿态。',
    then: '接着：检查人物之间的相对位置。'
  },
  {
    emoji: '🎥',
    title: '4. 拍摄检查',
    body: '在“拍摄”检查人物走位、摄影机轨迹和时间线，播放镜头并按需调整。',
    then: '接着：确认镜头画幅和运动节奏。'
  },
  {
    emoji: '⚙️',
    title: '5. 准备本机工具',
    body: 'Three.js 快速白模需要 FFmpeg；Blender 高级白模需要 Blender 和 FFmpeg。',
    then: '让工具位于 PATH，或在启动前指定其可执行文件路径。'
  },
  {
    emoji: '📦',
    title: '6. 生成白模 MP4',
    body: '在“白模交付”选择场景和镜头，选择 Three.js 或 Blender，生成当前镜头的白模视频。',
    then: '播放检查并打开输出位置；其他镜头逐个生成。'
  }
]

const TASKS_ZH = [
  ['怎样使用外部 Agent 的导演包？', '在“导演包”复制完整提示词，连同自己的剧本交给外部 Agent；导入返回的 .ailinpack 或 .ailin.json，检查镜头卡与首／中／尾摘要，再点击“一键生成全部可编辑 3D 预演”。'],
  ['怎样让人物移动？', '选择人物，按 M，再按运动顺序点击地面。每次点击都会生成可编辑的走位点。'],
  ['怎样制作双机位或多机位？', '进入拍摄页，选择摄影机后点击“＋”。A、B、C 机位会保留各自的镜头参数和运动轨迹。'],
  ['怎样让摄影机始终跟着人物？', '在摄影机属性的“跟踪主体”中选择人物。此后无论摄影机怎样移动，镜头都会持续对准该人物。'],
  ['怎样检查摄影机实际拍到什么？', '点击“通过摄影机查看”，并在右下角的镜头监看中切换机位；画面边框就是实际导出范围。'],
  ['怎样生成白模视频？', '进入“白模交付”，选场景和镜头，选 Three.js 快速白模或 Blender 高级白模，点击生成。播放检查后用“打开输出位置”取得 MP4。'],
  ['需要安装哪些软件？', 'Three.js 快速白模需要本机 FFmpeg；Blender 高级白模需要本机 Blender 和 FFmpeg。把它们加入 PATH，或在启动前指定绝对路径。'],
  ['怎样处理多镜头？', '逐个选择场景和镜头并生成白模 MP4。本开源核心目前没有自动拼接长视频的按钮。']
] as const

const SHORTCUTS_ZH: [string, string][] = [
  ['Space', '播放／暂停镜头'],
  ['M', '为当前人物或摄影机添加轨迹点'],
  ['C', '通过当前摄影机查看'],
  ['G / R', '移动／旋转工具'],
  ['⇧-click', '多选对象或时间线轨迹点'],
  [`${MOD}D`, '复制所选对象'],
  ['⌫', '删除所选对象'],
  [`${MOD}Z / ⇧${MOD}Z`, '撤销／重做'],
  [`${MOD}S`, '保存项目'],
  ['1–9', '跳转到第 N 个摄影机关键点'],
  ['Esc', '取消放置、添加轨迹点或选择'],
  ['?', '打开帮助']
]

export function HelpOverlay(): JSX.Element | null {
  const { locale } = useI18n()
  const helpOpen = useStore((s) => s.helpOpen)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const setCoachOpen = useStore((s) => s.setCoachOpen)
  const [tab, setTab] = useState<Tab>('quickstart')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TASKS
    const matches = (t: Task): boolean => {
      if (t.q.toLowerCase().includes(q)) return true
      // Answer text lives in JSX children; join their string leaves to search.
      const text = JSON.stringify(t.a).toLowerCase()
      return text.includes(q)
    }
    return TASKS.map((g) => ({ area: g.area, items: g.items.filter(matches) })).filter(
      (g) => g.items.length > 0
    )
  }, [query])

  if (!helpOpen) return null

  if (locale === 'zh-CN') {
    return (
      <div className="help-backdrop" onClick={() => setHelpOpen(false)}>
        <div className="help-modal help-v4" onClick={(e) => e.stopPropagation()}>
          <div className="help-header">
            <div className="seg help-tabs">
              <button className={tab === 'quickstart' ? 'active' : ''} onClick={() => setTab('quickstart')}>快速入门</button>
              <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>常见问题</button>
              <button className={tab === 'shortcuts' ? 'active' : ''} onClick={() => setTab('shortcuts')}>快捷键</button>
            </div>
            <span style={{ flex: 1 }} />
            <button className="btn small" onClick={() => setHelpOpen(false)}>完成</button>
          </div>

          <div className="help-body help-v4-body">
            {tab === 'quickstart' && (
              <div className="help-v4-inner">
                <p className="help-intro">从外部 Agent 导演包开始：<b>导入并审阅</b> → <b>一键生成可编辑预演</b> → <b>搭景与拍摄检查</b> → <b>逐镜头导出白模 MP4</b>。</p>
                <div className="help-cards">
                  {CARDS_ZH.map((card) => (
                    <div key={card.title} className="help-card">
                      <div className="help-card-emoji">{card.emoji}</div>
                      <div className="help-card-title">{card.title}</div>
                      <div className="help-card-body">{card.body}</div>
                      <div className="help-card-then">{card.then}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="btn" onClick={() => { setCoachOpen(true); setHelpOpen(false) }}>🎯 开始走位引导</button>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>边操作边自动勾选，完成第一次人物走位。</span>
                </div>
              </div>
            )}
            {tab === 'tasks' && (
              <div className="help-v4-inner">
                {TASKS_ZH.map(([question, answer]) => (
                  <div key={question} className="help-task">
                    <div className="help-task-q">{question}</div>
                    <div className="help-task-a">{answer}</div>
                  </div>
                ))}
              </div>
            )}
            {tab === 'shortcuts' && (
              <div className="help-v4-inner">
                <p className="help-intro">常用快捷键；所有编辑操作都可以撤销。</p>
                <div className="help-kbd-grid">
                  {SHORTCUTS_ZH.map(([key, desc]) => (
                    <div key={key} className="help-kbd-row">
                      <div className="help-kbd-keys">
                        {key.split(' / ').map((part, index, parts) => (
                          <span key={part}><Kbd>{part}</Kbd>{index < parts.length - 1 ? <span className="help-kbd-sep"> / </span> : null}</span>
                        ))}
                      </div>
                      <div className="help-kbd-desc">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="help-backdrop" onClick={() => setHelpOpen(false)}>
      <div className="help-modal help-v4" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <div className="seg help-tabs">
            <button
              className={tab === 'quickstart' ? 'active' : ''}
              onClick={() => setTab('quickstart')}
            >
              Quick start
            </button>
            <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
              How do I…?
            </button>
            <button
              className={tab === 'shortcuts' ? 'active' : ''}
              onClick={() => setTab('shortcuts')}
            >
              Shortcuts
            </button>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn small" onClick={() => setHelpOpen(false)}>
            Done
          </button>
        </div>

        <div className="help-body help-v4-body">
          {tab === 'quickstart' && (
            <div className="help-v4-inner">
              <p className="help-intro">
                Start with an external agent&apos;s director package: <b>import and review</b>,{' '}
                <b>build editable previs</b>, <b>check STAGE and SHOOT</b>, then{' '}
                <b>render a white-model MP4</b> for each shot.
              </p>
              <div className="help-cards">
                {CARDS.map((c) => (
                  <div key={c.title} className="help-card">
                    <div className="help-card-emoji">{c.emoji}</div>
                    <div className="help-card-title">{c.title}</div>
                    <div className="help-card-body">{c.body}</div>
                    <div className="help-card-then">{c.then}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  className="btn"
                  onClick={() => {
                    setCoachOpen(true)
                    setHelpOpen(false)
                  }}
                  title="Open the Set your marks interactive walkthrough"
                >
                  🎯 Start the “Set your marks” coach
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  A checklist that ticks itself off as you block your first move.
                </span>
              </div>
            </div>
          )}

          {tab === 'tasks' && (
            <div className="help-v4-inner">
              <input
                className="help-search"
                type="text"
                placeholder="Search tasks — e.g. “fight”, “track a plane”, “720p”…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {filtered.length === 0 ? (
                <p className="help-empty">No tasks match “{query}”.</p>
              ) : (
                filtered.map((group) => (
                  <div key={group.area} className="help-task-group">
                    <div className="help-task-area">{group.area}</div>
                    {group.items.map((t) => (
                      <div key={t.q} className="help-task">
                        <div className="help-task-q">{t.q}</div>
                        <div className="help-task-a">{t.a}</div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="help-v4-inner">
              <p className="help-intro">Keyboard shortcuts — every action is undoable.</p>
              <div className="help-kbd-grid">
                {SHORTCUTS.map(([key, desc]) => (
                  <div key={key} className="help-kbd-row">
                    <div className="help-kbd-keys">
                      {key.split(' / ').map((k, i, arr) => (
                        <span key={k}>
                          <Kbd>{k}</Kbd>
                          {i < arr.length - 1 ? <span className="help-kbd-sep"> / </span> : null}
                        </span>
                      ))}
                    </div>
                    <div className="help-kbd-desc">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
