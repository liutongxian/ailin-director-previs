import { nativeImage } from 'electron'
import { readFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { execFile } from 'child_process'
import type { ProductionMedia } from '../engine/production'
import { resolveFfmpeg } from './ffmpeg'

export async function probeProductionMedia(file: string, kind: ProductionMedia['kind']): Promise<Partial<Pick<ProductionMedia, 'width' | 'height' | 'duration'>>> {
  if (kind === 'image') {
    const image = nativeImage.createFromBuffer(await readFile(file))
    if (image.isEmpty()) throw new Error('图片无法解码，请换一个文件。')
    return image.getSize()
  }
  const ffmpeg = await resolveFfmpeg()
  const name = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const executable = ffmpeg === basename(ffmpeg) ? name : join(dirname(ffmpeg), name)
  const output = await new Promise<string>((done, fail) => {
    execFile(executable, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? fail(new Error('素材无法解码，请检查文件或 FFmpeg 配置。')) : done(stdout))
  })
  const result = JSON.parse(output) as { streams?: { codec_type: string; width?: number; height?: number }[]; format?: { duration?: string } }
  const stream = result.streams?.find((item) => item.codec_type === kind)
  const duration = Number(result.format?.duration)
  if (!stream || !Number.isFinite(duration) || duration <= 0) throw new Error('素材没有有效的视频或音频轨道。')
  return { ...(stream.width ? { width: stream.width, height: stream.height } : {}), duration }
}
