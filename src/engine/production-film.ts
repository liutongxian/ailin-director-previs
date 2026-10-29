export interface FilmClip { path: string; duration: number; hasAudio: boolean; trimStart?: number; trimEnd?: number; caption?: string }
export function filmPlan(clips: FilmClip[], aspect: '16:9' | '9:16' | '1:1', music = false): { filter: string; duration: number; subtitles: string } {
  if (!clips.length) throw new Error('没有采用的视频。')
  const [width, height] = aspect === '9:16' ? [720, 1280] : aspect === '1:1' ? [960, 960] : [1280, 720]
  const filters: string[] = [], subtitles: string[] = []
  let position = 0
  const timestamp = (seconds: number): string => {
    const ms = Math.round(seconds * 1000)
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
  }
  clips.forEach((clip, index) => {
    const start = clip.trimStart ?? 0, end = clip.duration - (clip.trimEnd ?? 0)
    if (![start, end, clip.duration].every(Number.isFinite) || start < 0 || (clip.trimEnd ?? 0) < 0 || end - start < 0.1) throw new Error(`第${index + 1}镜裁剪后不足0.1秒。`)
    const duration = Math.floor((end - start) * 24) / 24
    filters.push(`[${index}:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p,settb=AVTB[v${index}]`)
    filters.push(clip.hasAudio ? `[${index}:a]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${duration}[a${index}]` : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[a${index}]`)
    if (clip.caption?.trim()) subtitles.push(`${subtitles.length + 1}\n${timestamp(position)} --> ${timestamp(position + duration)}\n${clip.caption.trim().replace(/\r/g, '').replace(/\n{2,}/g, '\n')}\n`)
    position += duration
  })
  filters.push(`${clips.map((_clip, index) => `[v${index}][a${index}]`).join('')}concat=n=${clips.length}:v=1:a=1[outv][speech]`)
  filters.push(music ? `[${clips.length}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.18,atrim=duration=${position}[music];[speech][music]amix=inputs=2:duration=first:normalize=0[outa]` : '[speech]anull[outa]')
  return { filter: filters.join(';'), duration: position, subtitles: subtitles.join('\n') }
}
