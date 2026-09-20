import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { Open } from 'unzipper'
import { isSafeDirectorPackRelativePath, parseDirectorPackage } from '../engine/director-package'
import type {
  ImportedDirectorPackAsset,
  ImportedDirectorPackResult,
  ImportedDirectorPackVersion
} from '../shared/director-pack'

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
const MAX_FILE_BYTES = 256 * 1024 * 1024
const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
const MAX_ENTRIES = 2000
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MODEL_EXTENSIONS = new Set(['.glb', '.gltf', '.fbx', '.blend'])

// The desktop supplies its real decoder; every import route must validate images.
export type InspectPackImage = (sourcePath: string) => Promise<{ width: number; height: number }>

function portableJoin(...parts: string[]): string {
  return parts.join('/')
}

function resolvedInside(root: string, relativePath: string): string {
  const rootPath = resolve(root)
  const target = resolve(rootPath, ...relativePath.split('/'))
  if (!target.startsWith(rootPath + sep)) throw new Error(`包内路径越界：${relativePath}`)
  return target
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectHash)
    stream.on('end', resolveHash)
  })
  return hash.digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function validateDirectorPackArchiveEntry(name: string): void {
  if (!name || name.includes('\\') || !isSafeDirectorPackRelativePath(name.replace(/\/$/u, 'placeholder'))) {
    throw new Error(`压缩包包含不安全路径：${name || '(empty)'}`)
  }
  if (name.endsWith('/')) return
  if (name === 'director.ailin.json') return
  const extension = extname(name).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension) && !MODEL_EXTENSIONS.has(extension)) {
    throw new Error(`压缩包包含不支持的文件：${name}`)
  }
}

interface CheckedFile {
  relativePath: string
  sourcePath: string
  sha256: string
  sizeBytes: number
  kind: 'image' | 'model'
  width?: number
  height?: number
}

async function checkPayloadFile(extractedFolder: string, relativePath: string, declaredSha?: string): Promise<CheckedFile> {
  validateDirectorPackArchiveEntry(relativePath)
  const sourcePath = resolvedInside(extractedFolder, relativePath)
  const info = await lstat(sourcePath)
  if (info.isSymbolicLink() || !info.isFile() || info.size <= 0 || info.size > MAX_FILE_BYTES) {
    throw new Error(`资产文件无效、是符号链接或超过 256MB：${relativePath}`)
  }
  const sha256 = await sha256File(sourcePath)
  if (declaredSha && sha256 !== declaredSha.toLowerCase()) {
    throw new Error(`资产文件 SHA-256 不匹配：${relativePath}`)
  }
  return {
    relativePath,
    sourcePath,
    sha256,
    sizeBytes: info.size,
    kind: IMAGE_EXTENSIONS.has(extname(relativePath).toLowerCase()) ? 'image' : 'model'
  }
}

function versionFor(packageId: string, file: CheckedFile, now: string): ImportedDirectorPackVersion {
  return {
    id: `sha-${file.sha256.slice(0, 16)}`,
    path: portableJoin('assets', 'director-packages', packageId, file.relativePath),
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    sourceName: basename(file.relativePath),
    createdAt: now,
    ...(file.kind === 'image' ? { width: file.width, height: file.height } : {})
  }
}

export async function importExtractedDirectorPack(
  projectFolder: string,
  extractedFolder: string,
  sourceName: string,
  inspectImage: InspectPackImage
): Promise<ImportedDirectorPackResult> {
  const directorPath = join(resolve(extractedFolder), 'director.ailin.json')
  const directorInfo = await stat(directorPath)
  if (!directorInfo.isFile() || directorInfo.size <= 0 || directorInfo.size > 5 * 1024 * 1024) {
    throw new Error('director.ailin.json 无效或超过 5MB。')
  }
  const text = await readFile(directorPath, 'utf8')
  const parsed = parseDirectorPackage(text)
  if (!parsed.ok) throw new Error(`导演包校验失败：${parsed.validation.errors.join('；')}`)
  if (!parsed.package.assetBindings || parsed.package.assetBindings.length === 0) {
    throw new Error('`.ailinpack` 必须包含至少一项 assetBindings。')
  }

  const checked = new Map<string, CheckedFile>()
  let totalBytes = 0
  const requireFile = async (relativePath: string, declaredSha?: string): Promise<CheckedFile> => {
    const previous = checked.get(relativePath)
    if (previous) {
      if (declaredSha && previous.sha256 !== declaredSha.toLowerCase()) throw new Error(`资产文件 SHA-256 不匹配：${relativePath}`)
      return previous
    }
    let file: CheckedFile
    try {
      file = await checkPayloadFile(extractedFolder, relativePath, declaredSha)
      if (file.kind === 'image') {
        const dimensions = await inspectImage(file.sourcePath)
        if (!Number.isSafeInteger(dimensions.width) || dimensions.width <= 0 ||
            !Number.isSafeInteger(dimensions.height) || dimensions.height <= 0) {
          throw new Error(`图片尺寸无效：${relativePath}`)
        }
        file.width = dimensions.width
        file.height = dimensions.height
      }
    } catch (error) {
      if (error instanceof Error && /ENOENT/u.test(String((error as NodeJS.ErrnoException).code))) {
        throw new Error(`导演包缺少资产文件：${relativePath}`)
      }
      throw error
    }
    totalBytes += file.sizeBytes
    if (totalBytes > MAX_EXPANDED_BYTES) throw new Error('导演包展开后的资产总量超过 2GB。')
    checked.set(relativePath, file)
    return file
  }

  for (const binding of parsed.package.assetBindings) {
    for (const slot of binding.slots) await requireFile(slot.relativePath, slot.sha256)
    if (binding.model) await requireFile(binding.model.relativePath, binding.model.sha256)
  }
  const contentHash = createHash('sha256').update(text)
  for (const file of [...checked.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    contentHash.update(file.relativePath).update(file.sha256)
  }
  const packageId = `pack-${contentHash.digest('hex').slice(0, 16)}`
  const projectRoot = resolve(projectFolder)
  const packagesRoot = resolve(projectRoot, 'assets', 'director-packages')
  if (!packagesRoot.startsWith(projectRoot + sep)) throw new Error('导演包目标目录越过当前项目。')
  const finalFolder = join(packagesRoot, packageId)
  const createdFinal = !(await exists(finalFolder))
  let stagingFolder: string | null = null
  if (createdFinal) {
    await mkdir(packagesRoot, { recursive: true })
    stagingFolder = join(packagesRoot, `.incoming-${randomUUID()}`)
    await mkdir(stagingFolder, { recursive: true })
    try {
      for (const file of checked.values()) {
        const destination = resolvedInside(stagingFolder, file.relativePath)
        await mkdir(resolve(destination, '..'), { recursive: true })
        await copyFile(file.sourcePath, destination)
      }
      await rename(stagingFolder, finalFolder)
      stagingFolder = null
    } catch (error) {
      if (stagingFolder) await rm(stagingFolder, { recursive: true, force: true })
      throw error
    }
  }

  const now = new Date().toISOString()
  const importedAssets: ImportedDirectorPackAsset[] = parsed.package.assetBindings.map((binding) => ({
    targetRefId: binding.targetRefId,
    assetId: binding.assetId,
    kind: binding.kind,
    stateId: binding.stateId,
    stateName: binding.stateName,
    appliesTo: binding.appliesTo ?? parsed.package.stagePlans.map((stage) => stage.shotId),
    slots: binding.slots.map((slot) => {
      const file = checked.get(slot.relativePath)!
      return {
        slotId: slot.slotId,
        label: slot.label,
        type: slot.type,
        view: slot.view,
        required: slot.required,
        ...(slot.description ? { description: slot.description } : {}),
        ...(slot.cameraId ? { cameraId: slot.cameraId } : {}),
        version: versionFor(packageId, file, now)
      }
    }),
    ...(binding.model ? { model: versionFor(packageId, checked.get(binding.model.relativePath)!, now) } : {})
  }))
  const blenderManifestPath = portableJoin('generated', 'blender', `${packageId}-assets.json`)
  const blenderManifestAbsolute = resolvedInside(projectRoot, blenderManifestPath)
  try {
    await mkdir(resolve(blenderManifestAbsolute, '..'), { recursive: true })
    await writeFile(blenderManifestAbsolute, JSON.stringify({
      spec: 'ailin-blender-asset-manifest',
      version: '1.0',
      packageId,
      assets: importedAssets
    }, null, 2), 'utf8')
  } catch (error) {
    if (createdFinal) await rm(finalFolder, { recursive: true, force: true })
    throw error
  }

  return {
    name: sourceName,
    text,
    packageId,
    assets: importedAssets,
    imageCount: [...checked.values()].filter((file) => file.kind === 'image').length,
    modelCount: [...checked.values()].filter((file) => file.kind === 'model').length,
    blenderManifestPath
  }
}

export async function importDirectorPack(projectFolder: string, sourcePath: string, inspectImage: InspectPackImage): Promise<ImportedDirectorPackResult> {
  const archiveInfo = await stat(sourcePath)
  if (!archiveInfo.isFile() || archiveInfo.size <= 0 || archiveInfo.size > MAX_ARCHIVE_BYTES || extname(sourcePath).toLowerCase() !== '.ailinpack') {
    throw new Error('请选择不超过 1GB 的 `.ailinpack` 文件。')
  }
  const temporaryFolder = await mkdtemp(join(tmpdir(), 'ailinpack-'))
  let entries = 0
  let expandedBytes = 0
  try {
    const archive = await Open.file(sourcePath)
    for (const entry of archive.files) {
      entries++
      if (entries > MAX_ENTRIES) throw new Error('导演包文件数量超过 2000。')
      validateDirectorPackArchiveEntry(entry.path)
      expandedBytes += entry.uncompressedSize
      if (entry.uncompressedSize > MAX_FILE_BYTES || expandedBytes > MAX_EXPANDED_BYTES) {
        throw new Error('导演包中的单文件或总展开大小超过限制。')
      }
      const unixMode = entry.externalFileAttributes >>> 16
      if ((unixMode & 0o170000) === 0o120000) throw new Error(`导演包不能包含符号链接：${entry.path}`)
    }
    await archive.extract({ path: temporaryFolder, concurrency: 4 })
    return await importExtractedDirectorPack(projectFolder, temporaryFolder, basename(sourcePath), inspectImage)
  } finally {
    await rm(temporaryFolder, { recursive: true, force: true })
  }
}
