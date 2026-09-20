// Modified for Director Desk packaged-generator isolation; see MODIFICATIONS.md.
import { spawn, type ChildProcess } from 'child_process'
import { access, mkdir, writeFile } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep, win32 } from 'path'
import type { BlenderPlan } from '../engine/blender-plan'
import type { BlenderJobSnapshot } from '../shared/blender-job'
import { resolveFfmpeg, terminateProcessTree } from './ffmpeg'

interface RunningJob {
  snapshot: BlenderJobSnapshot
  child?: ChildProcess
  outputFolder: string
  planPath: string
  log: string
  stdoutBuffer: string
}

const jobs = new Map<string, RunningJob>()

export async function resolveBlenderGenerator(appRoot: string, cwd = process.cwd(), resourcesPath = process.resourcesPath): Promise<string> {
  const source = resolve(appRoot, 'scripts', 'blender', 'generate_blockout.py')
  const working = resolve(cwd, 'scripts', 'blender', 'generate_blockout.py')
  const packaged = resourcesPath ? resolve(resourcesPath, 'blender', 'generate_blockout.py') : source
  // A packaged executable must never accidentally run a neighboring checkout.
  for (const candidate of [packaged, source, working]) if (await executableExists(candidate)) return candidate
  throw new Error(`Blender generator not found: ${packaged}`)
}

function safeSegment(value: string, fallback: string): string {
  const safe = value.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/gu, '')
  return safe || fallback
}

export function resolveBlenderJobPaths(projectFolder: string, shotId: string, jobId: string): {
  outputFolder: string
  outputRelativePath: string
  planPath: string
} {
  const projectRoot = resolve(projectFolder)
  const blenderRoot = resolve(projectRoot, 'generated', 'blender')
  const folderName = `${safeSegment(shotId, 'shot')}-${safeSegment(jobId, 'job')}`
  const outputFolder = resolve(blenderRoot, folderName)
  if (outputFolder !== blenderRoot && !outputFolder.startsWith(blenderRoot + sep)) {
    throw new Error('Blender output escaped the current project.')
  }
  return {
    outputFolder,
    outputRelativePath: relative(projectRoot, outputFolder).replaceAll('\\', '/'),
    planPath: join(outputFolder, 'blender-plan.json')
  }
}

export function parseBlenderProgress(line: string): { frame: number; total: number } | null {
  const match = line.trim().match(/^AILIN_BLENDER_PROGRESS=(\d+)\/(\d+)$/u)
  if (!match) return null
  const frame = Number(match[1])
  const total = Number(match[2])
  if (!Number.isInteger(frame) || !Number.isInteger(total) || frame < 0 || total < 1 || frame > total) return null
  return { frame, total }
}

export function blenderCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    return [
      env.AILIN_BLENDER?.trim() ?? '',
      env.ProgramFiles ? win32.join(env.ProgramFiles, 'Blender Foundation', 'Blender 5.2', 'blender.exe') : '',
      env.ProgramFiles ? win32.join(env.ProgramFiles, 'Blender Foundation', 'Blender 4.5', 'blender.exe') : '',
      'blender.exe'
    ].filter(Boolean)
  }
  if (platform === 'darwin') {
    return [env.AILIN_BLENDER?.trim() ?? '', '/Applications/Blender.app/Contents/MacOS/Blender', 'blender'].filter(Boolean)
  }
  return [env.AILIN_BLENDER?.trim() ?? '', '/usr/bin/blender', '/usr/local/bin/blender', 'blender'].filter(Boolean)
}

async function executableExists(candidate: string): Promise<boolean> {
  if (!isAbsolute(candidate)) return true
  try {
    await access(candidate)
    return true
  } catch {
    return false
  }
}

export async function resolveBlender(): Promise<string> {
  for (const candidate of blenderCandidates()) {
    if (await executableExists(candidate)) return candidate
  }
  throw new Error('找不到 Blender。请安装 Blender 5.2 LTS，或设置 AILIN_BLENDER 为 blender 可执行文件路径。')
}

function appendLog(job: RunningJob, chunk: string): void {
  job.log = `${job.log}${chunk}`.slice(-60_000)
  job.snapshot.logTail = job.log.slice(-4_000)
}

function consumeStdout(job: RunningJob, chunk: string): void {
  appendLog(job, chunk)
  job.stdoutBuffer += chunk
  const lines = job.stdoutBuffer.split(/\r?\n/u)
  job.stdoutBuffer = lines.pop() ?? ''
  for (const line of lines) {
    const progress = parseBlenderProgress(line)
    if (progress) job.snapshot.progress = progress
  }
}

function snapshot(job: RunningJob): BlenderJobSnapshot {
  return structuredClone(job.snapshot)
}

export async function startBlenderJob(input: {
  projectFolder: string
  plan: BlenderPlan
  appRoot: string
}): Promise<BlenderJobSnapshot> {
  if (input.plan.spec !== 'ailin-blender-plan' || input.plan.version !== '1.0') {
    throw new Error('Unsupported Blender plan.')
  }
  const jobId = crypto.randomUUID()
  const paths = resolveBlenderJobPaths(input.projectFolder, input.plan.shot.id, jobId)
  await mkdir(paths.outputFolder, { recursive: true })
  await writeFile(paths.planPath, JSON.stringify(input.plan, null, 2), 'utf8')
  const createdAt = new Date().toISOString()
  const job: RunningJob = {
    snapshot: {
      id: jobId,
      shotId: input.plan.shot.id,
      status: 'queued',
      outputRelativePath: paths.outputRelativePath,
      progress: { frame: 0, total: input.plan.shot.frameEnd - input.plan.shot.frameStart + 1 },
      createdAt,
      logTail: ''
    },
    outputFolder: paths.outputFolder,
    planPath: paths.planPath,
    log: '',
    stdoutBuffer: ''
  }
  jobs.set(jobId, job)

  try {
    const [blender, ffmpeg] = await Promise.all([resolveBlender(), resolveFfmpeg()])
    const generator = await resolveBlenderGenerator(input.appRoot)
    const child = spawn(blender, [
      '--background', '--factory-startup', '--python', generator, '--',
      '--plan', paths.planPath, '--output', paths.outputFolder, '--ffmpeg', ffmpeg
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    job.child = child
    job.snapshot.status = 'running'
    job.snapshot.startedAt = new Date().toISOString()
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => consumeStdout(job, chunk))
    child.stderr?.on('data', (chunk: string) => appendLog(job, chunk))
    child.once('error', (error) => {
      if (job.snapshot.status === 'cancelled') return
      job.snapshot.status = 'failed'
      job.snapshot.error = error.message
      job.snapshot.completedAt = new Date().toISOString()
    })
    child.once('close', (code) => {
      void (async () => {
        if (job.stdoutBuffer) consumeStdout(job, '\n')
        if (job.snapshot.status === 'cancelled') return
        job.snapshot.completedAt = new Date().toISOString()
        let outputExists = false
        try {
          await access(join(job.outputFolder, input.plan.outputs.video))
          outputExists = true
        } catch {
          outputExists = false
        }
        if (code === 0 && outputExists) {
          job.snapshot.status = 'complete'
          job.snapshot.progress = { ...job.snapshot.progress, frame: job.snapshot.progress.total }
        } else {
          job.snapshot.status = 'failed'
          job.snapshot.error = `Blender did not produce ${input.plan.outputs.video} (exit ${code ?? 'unknown'}). ${job.snapshot.logTail}`.trim()
        }
        await writeFile(join(job.outputFolder, 'blender-job.log'), job.log, 'utf8')
      })()
    })
  } catch (error) {
    job.snapshot.status = 'failed'
    job.snapshot.error = error instanceof Error ? error.message : String(error)
    job.snapshot.completedAt = new Date().toISOString()
  }
  return snapshot(job)
}

export function getBlenderJob(jobId: string): BlenderJobSnapshot {
  const job = jobs.get(jobId)
  if (!job) throw new Error(`Unknown Blender job: ${basename(jobId)}`)
  return snapshot(job)
}

export async function cancelBlenderJob(jobId: string): Promise<BlenderJobSnapshot> {
  const job = jobs.get(jobId)
  if (!job) throw new Error(`Unknown Blender job: ${basename(jobId)}`)
  if (job.snapshot.status === 'complete' || job.snapshot.status === 'failed' || job.snapshot.status === 'cancelled') {
    return snapshot(job)
  }
  job.snapshot.status = 'cancelled'
  job.snapshot.completedAt = new Date().toISOString()
  if (job.child) await terminateProcessTree(job.child)
  await writeFile(join(job.outputFolder, 'blender-job.log'), job.log, 'utf8')
  return snapshot(job)
}
