#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HELP = `艾琳导演台 CLI（导演台必须正在运行）

用法：
  ailin status
  ailin import-director-pack --file <镜头.ailinpack|json|ailin>
  ailin blender-plan [--shot <镜头ID>]
  ailin blender-render [--shot <镜头ID>]
  ailin blender-status --job <任务ID>
  ailin blender-cancel --job <任务ID>

环境变量：
  BLOCKOUT_CONFIG_DIR       覆盖控制发现目录
  BLOCKOUT_CONFIG_NAMESPACE Windows 配置命名空间（默认 director-desk，兼容旧 blockout）
`

const COMMANDS = new Set([
  'status',
  'import-director-pack',
  'blender-plan',
  'blender-render',
  'blender-status',
  'blender-cancel'
])

function failUsage(message) {
  process.stderr.write(`${message}\n\n${HELP}`)
  process.exitCode = 2
}

function option(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}

function configDir(namespaceOverride) {
  if (process.env.BLOCKOUT_CONFIG_DIR?.trim()) return process.env.BLOCKOUT_CONFIG_DIR.trim()
  if (process.platform === 'win32') {
    const namespace = namespaceOverride || process.env.BLOCKOUT_CONFIG_NAMESPACE || 'director-desk'
    const segments = namespace.split(/[\\/]+/u).filter((part) => part && part !== '.' && part !== '..')
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), ...(segments.length ? segments : ['blockout']))
  }
  return join(homedir(), '.config', 'blockout')
}

async function discovery() {
  const files = process.env.BLOCKOUT_CONFIG_DIR?.trim()
    ? [join(configDir(), 'control.json')]
    : [...new Set([
        join(configDir(), 'control.json'),
        ...(process.platform === 'win32' && !process.env.BLOCKOUT_CONFIG_NAMESPACE
          ? [join(configDir('blockout'), 'control.json')]
          : []),
        join(homedir(), '.config', 'blockout', 'control.json')
      ])]
  for (const file of files) {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (Number.isInteger(value?.port) && typeof value?.token === 'string' &&
          (value.protocolVersion === undefined || value.protocolVersion === 1) &&
          (value.app === undefined || value.app === 'blockout')) return value
    } catch {
      // Try current and legacy descriptor locations.
    }
  }
  throw new Error('艾琳导演台没有运行，或控制描述文件不可用。请先启动导演台。')
}

async function call(action, params = {}) {
  const config = await discovery()
  const response = await fetch(`http://127.0.0.1:${config.port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ action, params })
  })
  const result = await response.json()
  if (!response.ok || result?.ok === false) throw new Error(result?.error || `控制请求失败：HTTP ${response.status}`)
  return result
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(HELP)
    return
  }
  const command = args[0]
  if (!COMMANDS.has(command)) {
    failUsage(`Unknown command: ${command}`)
    return
  }
  const shotId = option(args, '--shot')
  const jobId = option(args, '--job')
  let result
  switch (command) {
    case 'status':
      result = await call('get_state')
      break
    case 'import-director-pack': {
      const sourcePath = option(args, '--file')
      if (!sourcePath) return failUsage('import-director-pack requires --file.')
      result = await call('import_director_package', { sourcePath })
      break
    }
    case 'blender-plan':
      result = await call('compile_blender_plan', shotId ? { shotId } : {})
      break
    case 'blender-render':
      result = await call('render_blender_blockout', shotId ? { shotId } : {})
      break
    case 'blender-status':
      if (!jobId) return failUsage('blender-status requires --job.')
      result = await call('get_blender_job', { jobId })
      break
    case 'blender-cancel':
      if (!jobId) return failUsage('blender-cancel requires --job.')
      result = await call('cancel_blender_job', { jobId })
      break
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
