import { spawn } from 'child_process'
import { basename, dirname, extname, join } from 'path'
import { readFile, stat } from 'fs/promises'
import { nativeImage } from 'electron'
import { resolveFfmpeg } from './ffmpeg'

export async function validateReferenceFile(file: string): Promise<void> {
  const info = await stat(file)
  if (!info.isFile() || !info.size) throw new Error('参考文件为空或无效。')
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extname(file).toLowerCase())) {
    if (info.size > 100 * 1024 * 1024 || nativeImage.createFromBuffer(await readFile(file)).isEmpty()) throw new Error('参考图片无法解码。')
    return
  }
  const ffmpeg = await resolveFfmpeg()
  const name = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const ffprobe = ffmpeg === basename(ffmpeg) ? name : join(dirname(ffmpeg), name)
  const valid = await new Promise<boolean>((done) => {
    const probe = spawn(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { windowsHide: true })
    let output = ''
    const timer = setTimeout(() => { probe.kill(); done(false) }, 15000)
    probe.stdout.on('data', (data: Buffer) => { output += data.toString() })
    probe.on('error', () => { clearTimeout(timer); done(false) })
    probe.on('close', (code) => {
      clearTimeout(timer)
      try {
        const stream = JSON.parse(output).streams?.[0] as { width?: number; height?: number } | undefined
        done(code === 0 && Number(stream?.width) > 0 && Number(stream?.height) > 0)
      } catch { done(false) }
    })
  })
  if (!valid) throw new Error('参考视频无法读取有效画面，请选择可播放的视频。')
}
