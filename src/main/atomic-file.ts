import { mkdir, open, rename, rm } from 'fs/promises'
import { dirname, resolve } from 'path'
import { randomUUID } from 'crypto'
import { setTimeout as delay } from 'timers/promises'

const writes = new Map<string, Promise<void>>()
/** Serialize per-file writes; a crash before rename leaves the last complete file. */
export function writeAtomic(path: string, content: string | Buffer | (() => Promise<string | Buffer>)): Promise<void> {
  const key = resolve(path).toLowerCase()
  const previous = writes.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    const bytes = typeof content === 'function' ? await content() : content
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx')
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      // Windows scanners/readers can briefly deny replacement. Never delete the destination.
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, path); break } catch (error) {
          if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
          await delay(50 * 2 ** attempt)
        }
      }
    } finally { await rm(temporary, { force: true }) }
  })
  writes.set(key, next)
  void next.finally(() => { if (writes.get(key) === next) writes.delete(key) }).catch(() => {})
  return next
}
