// Modified from Blockout for the open-core Director Desk; see MODIFICATIONS.md.
/** The renderer receives a typed project, production, export, and Blender IPC surface. */
import { contextBridge, ipcRenderer } from 'electron'
import type { ImportedDirectorPackResult } from '../shared/director-pack'
import type { BlenderPlan } from '../engine/blender-plan'
import type { BlenderJobSnapshot } from '../shared/blender-job'

import type { ProductionAttempt, ProductionMedia } from '../engine/production'
import type { AssetCreationJob } from '../engine/production-assets'
import type { CloudVideoProviderId } from '../engine/cloud-video'

export interface PlatformInfo {
  platform: 'macos' | 'windows' | 'linux'
  isMac: boolean
  primaryModifier: '⌘' | 'Ctrl'
  alternateModifier: '⌥' | 'Alt'
  showInFolderLabel: 'Reveal in Finder' | 'Show in Folder'
}

export interface BlockoutAPI {
  createProductionProject(): Promise<{ folder: string; name: string }>
  pickFiles(filters: { name: string; extensions: string[] }[]): Promise<string[]>
  cloudVideoKeyStatus(provider: CloudVideoProviderId): Promise<{ available: boolean; environmentVariable: string }>
  directorCredentialStatus(): Promise<{ saved: boolean; secure: boolean }>
  directorCredentialSave(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
  directorCredentialClear(): Promise<{ ok: true } | { ok: false; error: string }>
  cancelScriptModel(requestId: string): Promise<{ cancelled: boolean }>
  analyzeScriptWithModel(
    config: { baseUrl: string; model: string; apiKey?: string },
    sourceText: string,
    images?: {
      assetId: string
      assetName: string
      kind: 'character' | 'scene' | 'prop'
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
      base64: string
    }[],
    requestId?: string
  ): Promise<{ ok: true; text: string } | { ok: false; error: string }>
  importProductionMedia(folder: string, sourcePath: string): Promise<ProductionMedia>
  productionAssetJobs(folder: string, projectId: string): Promise<AssetCreationJob[]>
  productionDismissAsset(folder: string, id: string): Promise<void>
  productionGenerateAsset(folder: string, projectId: string, id: string, apiKey?: string, input?: import('../engine/production-assets').AssetCreationDraft): Promise<AssetCreationJob>
  productionLocalQwenStatus(baseUrl: string, password?: string): Promise<{ ready: boolean; message: string }>
  productionExportFilm(folder: string, projectId: string): Promise<{ path: string; subtitlePath: string; duration: number; createdAt: string }>
  productionAttempts(folder: string, projectId: string): Promise<ProductionAttempt[]>
  productionSubmit(folder: string, projectId: string, shotId: string, id: string, apiKey?: string): Promise<ProductionAttempt>
  productionUpdate(folder: string, id: string, action: 'query' | 'download' | 'recover' | 'dismiss', apiKey?: string, taskId?: string): Promise<ProductionAttempt>
  readonly platform: PlatformInfo
  newProjectDialog(): Promise<{ folder: string; name: string } | null>
  createDemoProject(): Promise<{ folder: string; name: string }>
  openProjectDialog(): Promise<string | null>
  pickFile(filters: { name: string; extensions: string[] }[]): Promise<string | null>
  readTextFile(sourcePath: string): Promise<{ name: string; text: string }>
  importDirectorPack(projectFolder: string, sourcePath: string): Promise<ImportedDirectorPackResult>
  blenderStart(projectFolder: string, plan: BlenderPlan): Promise<BlenderJobSnapshot>
  blenderGet(jobId: string): Promise<BlenderJobSnapshot>
  blenderCancel(jobId: string): Promise<BlenderJobSnapshot>
  saveProject(folder: string, json: string): Promise<boolean>
  saveBackup(folder: string, json: string): Promise<boolean>
  loadProject(folder: string): Promise<{ json: string | null; backupJson: string | null; backupNewer: boolean; folder: string }>
  importAsset(folder: string, sourcePath: string): Promise<{ relativePath: string; name: string }>
  importScan(folder: string, sourcePath: string): Promise<{ relativePath: string; name: string }>
  importReference(folder: string, sourcePath: string): Promise<{ relativePath: string; name: string }>
  readProjectFile(folder: string, relativePath: string): Promise<ArrayBuffer>
  showFolder(path: string): Promise<void>
  exportBegin(jobId: string, outPath: string, opts: { fps: number; width: number; height: number; framesExpected: number }): Promise<boolean>
  exportFrame(jobId: string, frame: ArrayBuffer): Promise<boolean>
  exportEnd(jobId: string): Promise<boolean>
  exportCancel(jobId: string): Promise<boolean>
  exportWriteFile(path: string, data: ArrayBuffer | string): Promise<boolean>
  exportConcat(outPath: string, inputPaths: string[]): Promise<{ ok: boolean; error?: string }>
  onExportClosed(cb: (jobId: string, code: number, log: string) => void): () => void
  presetsList(): Promise<{ id: string; name: string; savedAt: string; entityCount: number }[]>
  presetSave(name: string, json: string): Promise<{ ok: boolean; id?: string; error?: string }>
  presetLoad(id: string): Promise<string | null>
  presetDelete(id: string): Promise<boolean>
  onControlInvoke(cb: (id: string, action: string, params: unknown) => void): () => void
  controlResult(id: string, result: { ok: boolean; data?: unknown; error?: string }): void
  versions(): Promise<{ app: string; electron: string; node: string; platform: NodeJS.Platform; productName: string }>
}

const platform: PlatformInfo = {
  platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
  isMac: process.platform === 'darwin',
  primaryModifier: process.platform === 'darwin' ? '⌘' : 'Ctrl',
  alternateModifier: process.platform === 'darwin' ? '⌥' : 'Alt',
  showInFolderLabel: process.platform === 'darwin' ? 'Reveal in Finder' : 'Show in Folder'
}

const api: BlockoutAPI = {
  createProductionProject: () => ipcRenderer.invoke('project:createProduction'),
  pickFiles: (filters) => ipcRenderer.invoke('dialog:pickFiles', filters),
  cloudVideoKeyStatus: (provider) => ipcRenderer.invoke('cloudVideo:keyStatus', provider),
  directorCredentialStatus: () => ipcRenderer.invoke('directorCredential:status'),
  directorCredentialSave: (apiKey) => ipcRenderer.invoke('directorCredential:save', apiKey),
  directorCredentialClear: () => ipcRenderer.invoke('directorCredential:clear'),
  cancelScriptModel: (requestId) => ipcRenderer.invoke('ai:cancelScript', requestId),
  analyzeScriptWithModel: (config, sourceText, images, requestId) => ipcRenderer.invoke('ai:analyzeScript', config, sourceText, images, requestId),
  importProductionMedia: (folder, path) => ipcRenderer.invoke('production:importMedia', folder, path),
  productionAssetJobs: (folder, projectId) => ipcRenderer.invoke('production:assetJobs', folder, projectId),
  productionDismissAsset: (folder, id) => ipcRenderer.invoke('production:dismissAsset', folder, id),
  productionGenerateAsset: (folder, projectId, id, apiKey, input) => ipcRenderer.invoke('production:generateAsset', folder, projectId, id, apiKey, input),
  productionLocalQwenStatus: (baseUrl, password) => ipcRenderer.invoke('production:localQwenStatus', baseUrl, password),
  productionExportFilm: (folder, projectId) => ipcRenderer.invoke('production:exportFilm', folder, projectId),
  productionAttempts: (folder, projectId) => ipcRenderer.invoke('production:list', folder, projectId),
  productionSubmit: (folder, projectId, shotId, id, apiKey) => ipcRenderer.invoke('production:submit', folder, projectId, shotId, id, apiKey),
  productionUpdate: (folder, id, action, apiKey, taskId) => ipcRenderer.invoke('production:update', folder, id, action, apiKey, taskId),
  platform,
  newProjectDialog: () => ipcRenderer.invoke('dialog:newProject'),
  createDemoProject: () => ipcRenderer.invoke('project:createDemo'),
  openProjectDialog: () => ipcRenderer.invoke('dialog:openProject'),
  pickFile: (filters) => ipcRenderer.invoke('dialog:pickFile', filters),
  readTextFile: (sourcePath) => ipcRenderer.invoke('file:readText', sourcePath),
  importDirectorPack: (projectFolder, sourcePath) => ipcRenderer.invoke('directorPack:import', projectFolder, sourcePath),
  blenderStart: (projectFolder, plan) => ipcRenderer.invoke('blender:start', projectFolder, plan),
  blenderGet: (jobId) => ipcRenderer.invoke('blender:get', jobId),
  blenderCancel: (jobId) => ipcRenderer.invoke('blender:cancel', jobId),
  saveProject: (folder, json) => ipcRenderer.invoke('project:save', folder, json),
  saveBackup: (folder, json) => ipcRenderer.invoke('project:saveBackup', folder, json),
  loadProject: (folder) => ipcRenderer.invoke('project:load', folder),
  importAsset: (folder, sourcePath) => ipcRenderer.invoke('project:importAsset', folder, sourcePath),
  importScan: (folder, sourcePath) => ipcRenderer.invoke('scan:import', folder, sourcePath),
  importReference: (folder, sourcePath) => ipcRenderer.invoke('project:importReference', folder, sourcePath),
  readProjectFile: (folder, relativePath) => ipcRenderer.invoke('file:readAbsolute', folder, relativePath),
  showFolder: (path) => ipcRenderer.invoke('shell:showFolder', path),
  exportBegin: (jobId, outPath, opts) => ipcRenderer.invoke('export:begin', jobId, outPath, opts),
  exportFrame: (jobId, frame) => ipcRenderer.invoke('export:frame', jobId, frame),
  exportEnd: (jobId) => ipcRenderer.invoke('export:end', jobId),
  exportCancel: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  exportWriteFile: (path, data) => ipcRenderer.invoke('export:writeFile', path, data),
  exportConcat: (outPath, inputPaths) => ipcRenderer.invoke('export:concat', outPath, inputPaths),
  onExportClosed: (cb) => {
    const listener = (_event: unknown, jobId: string, code: number, log: string): void => cb(jobId, code, log)
    ipcRenderer.on('export:closed', listener)
    return () => ipcRenderer.removeListener('export:closed', listener)
  },
  presetsList: () => ipcRenderer.invoke('presets:list'),
  presetSave: (name, json) => ipcRenderer.invoke('presets:save', name, json),
  presetLoad: (id) => ipcRenderer.invoke('presets:load', id),
  presetDelete: (id) => ipcRenderer.invoke('presets:delete', id),
  onControlInvoke: (cb) => {
    const listener = (_event: unknown, id: string, action: string, params: unknown): void => cb(id, action, params)
    ipcRenderer.on('control:invoke', listener)
    return () => ipcRenderer.removeListener('control:invoke', listener)
  },
  controlResult: (id, result) => ipcRenderer.send('control:result', id, result),
  versions: () => ipcRenderer.invoke('app:versions')
}

contextBridge.exposeInMainWorld('blockout', api)
