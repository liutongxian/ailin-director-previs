import { readFile, realpath, stat } from 'fs/promises'
import { dirname, extname, resolve, sep } from 'path'

const MAX_BYTES = 256 * 1024 * 1024

/** Portable local model bytes. glTF dependencies are embedded before copying. */
export async function portableModelBytes(sourcePath: string): Promise<Buffer> {
  const info = await stat(sourcePath)
  if (!info.isFile() || info.size === 0 || info.size > MAX_BYTES) throw new Error('模型文件无效或超过256MB。')
  const bytes = await readFile(sourcePath)
  const extension = extname(sourcePath).toLowerCase()
  if (extension === '.glb') {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('GLB文件损坏或不是2.0格式。')
    const length = bytes.readUInt32LE(12)
    if (20 + length > bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB缺少有效场景数据。')
    JSON.parse(bytes.subarray(20, 20 + length).toString())
    return bytes
  }
  if (extension === '.obj') {
    const text = bytes.toString()
    if (!/^v\s+[-\d.]/m.test(text) || !/^f\s+\d/m.test(text)) throw new Error('OBJ缺少有效顶点或面。')
    return bytes
  }
  if (extension !== '.gltf') throw new Error('仅支持GLB、GLTF和OBJ模型。')
  const doc = JSON.parse(bytes.toString()) as { asset?: { version?: string }; buffers?: { uri?: string }[]; images?: { uri?: string }[] }
  if (doc.asset?.version !== '2.0') throw new Error('仅支持glTF 2.0。')
  const root = await realpath(dirname(sourcePath))
  let total = bytes.length
  for (const item of [...doc.buffers ?? [], ...doc.images ?? []]) {
    if (!item.uri || item.uri.startsWith('data:')) continue
    const uri = decodeURIComponent(item.uri)
    if (/^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith('/') || uri.startsWith('\\')) throw new Error('模型依赖必须位于模型文件夹内。')
    const file = await realpath(resolve(root, uri))
    if (!file.startsWith(root + sep)) throw new Error('模型依赖不能越过所选文件夹。')
    const dependency = await stat(file)
    total += dependency.size
    if (!dependency.isFile() || total > MAX_BYTES) throw new Error('模型依赖无效或总大小超过256MB。')
    const data = await readFile(file)
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extname(file).toLowerCase()] ?? 'application/octet-stream'
    item.uri = `data:${mime};base64,${data.toString('base64')}`
  }
  return Buffer.from(JSON.stringify(doc))
}
