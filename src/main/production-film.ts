import { execFile, spawn } from 'child_process'
import { mkdir, realpath, rename, readFile } from 'fs/promises'
import { basename, dirname, join, sep } from 'path'
import { randomUUID } from 'crypto'
import { parseProject } from '../engine/schema'
import { selectedProductionClips } from '../engine/production'
import { filmPlan, type FilmClip } from '../engine/production-film'
import { resolveFfmpeg } from './ffmpeg'
import { writeAtomic } from './atomic-file'
import { productionExistingFile } from './production-storage'

export async function exportProductionFilm(folder: string, projectId: string): Promise<{ path: string; subtitlePath: string; duration: number; createdAt: string }> {
  const doc = parseProject(await readFile(join(folder, 'project.json'), 'utf8')).doc
  if (!doc || doc.id !== projectId) throw new Error('项目文件无效或项目已切换。')
  const selected = selectedProductionClips(doc)
  const ffmpeg = await resolveFfmpeg()
  const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const ffprobe = ffmpeg === basename(ffmpeg) ? probeName : join(dirname(ffmpeg), probeName)
  const clips: FilmClip[] = []
  for (const item of selected) {
    const path = await productionExistingFile(folder, item.relativePath)
    const probe = await new Promise<string>((done, fail) => execFile(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', path], { windowsHide: true, timeout: 15000 }, (error, stdout) => error ? fail(new Error(`${item.name} 视频无法读取。`)) : done(stdout)))
    const meta = JSON.parse(probe) as { streams: { codec_type: string }[]; format: { duration: string } }
    if (!meta.streams.some((stream) => stream.codec_type === 'video')) throw new Error(`${item.name} 没有视频轨道。`)
    const shot = doc.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === item.shotId)!
    clips.push({ path, duration: Number(meta.format.duration), hasAudio: meta.streams.some((stream) => stream.codec_type === 'audio'), ...shot.productionEdit })
  }
  const music = doc.productionExport?.musicMediaId ? doc.productionMedia?.find((media) => media.id === doc.productionExport?.musicMediaId) : undefined
  if (doc.productionExport?.musicMediaId && (!music || music.kind !== 'audio')) throw new Error('所选背景音乐不存在。')
  const musicPath = music ? await productionExistingFile(folder, music.path) : undefined
  const plan = filmPlan(clips, doc.productionExport?.aspect ?? '16:9', !!musicPath)
  const directory = join(folder, 'generated', 'films')
  await mkdir(directory, { recursive: true })
  if (!(await realpath(directory)).toLowerCase().startsWith(((await realpath(folder)) + sep).toLowerCase())) throw new Error('导出目录不可链接到项目外。')
  const id = `film-${randomUUID()}`
  const partial = join(directory, `${id}.partial.mp4`)
  const args = ['-y', ...clips.flatMap((clip) => ['-i', clip.path]), ...(musicPath ? ['-stream_loop', '-1', '-i', musicPath] : []), '-filter_complex', plan.filter, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', partial]
  await new Promise<void>((done, fail) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let error = ''
    child.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-3000) })
    child.on('error', fail); child.on('close', (code) => code === 0 ? done() : fail(new Error(`影片合成失败：${error}`)))
  })
  await rename(partial, join(directory, `${id}.mp4`))
  await writeAtomic(join(directory, `${id}.srt`), plan.subtitles)
  await writeAtomic(join(directory, `${id}-镜头清单.json`), JSON.stringify({ project: doc.name, clips: selected.map((clip, i) => ({ ...clip, trimStart: clips[i]!.trimStart ?? 0, trimEnd: clips[i]!.trimEnd ?? 0, caption: clips[i]!.caption ?? '' })), music: music?.path, aspect: doc.productionExport?.aspect ?? '16:9' }, null, 2))
  return { path: `generated/films/${id}.mp4`, subtitlePath: `generated/films/${id}.srt`, duration: plan.duration, createdAt: new Date().toISOString() }
}
