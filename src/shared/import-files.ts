const TEXT_IMPORT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.fountain', '.json', '.previs', '.ailin'])
const DIRECTOR_PACKAGE_EXTENSIONS = new Set(['.json', '.ailin', '.ailinpack'])

function extensionOf(sourcePath: string): string {
  const normalized = sourcePath.trim().toLowerCase()
  const dot = normalized.lastIndexOf('.')
  return dot >= 0 ? normalized.slice(dot) : ''
}

export function isSupportedTextImport(sourcePath: string): boolean {
  return TEXT_IMPORT_EXTENSIONS.has(extensionOf(sourcePath))
}

export function isSupportedDirectorPackageImport(sourcePath: string): boolean {
  return DIRECTOR_PACKAGE_EXTENSIONS.has(extensionOf(sourcePath))
}

export const TEXT_IMPORT_LABEL = 'TXT、Markdown、Fountain、JSON、Previs 或 Ailin'
