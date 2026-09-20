import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { parseBlenderProgress, resolveBlenderJobPaths, resolveBlenderGenerator } from '../../src/main/blender-jobs'

describe('Blender job safety helpers', () => {
  it('uses the advanced Eevee render path with a three-point light rig', () => {
    const generator = fs.readFileSync(path.resolve('scripts/blender/generate_blockout.py'), 'utf8')

    expect(generator).toContain('scene.render.engine = "BLENDER_EEVEE"')
    expect(generator).toContain('ADVANCED_KEY_LIGHT')
    expect(generator).toContain('ADVANCED_FILL_LIGHT')
    expect(generator).toContain('ADVANCED_RIM_LIGHT')
    expect(generator).toContain('ADVANCED_PATH_LIGHT_START')
    expect(generator).toContain('CAFE_BACK_SHELF')
    expect(generator).toContain('WAREHOUSE_BACK_RACK')
    expect(generator).toContain('CITY_STREET_CURB')
    expect(generator).toContain('TRAFFIC_CONE_BODY')
    expect(generator).toContain('MAT_TRAFFIC_CONE_ORANGE')
    expect(generator).toContain('furniture.sidetable')
    expect(generator).not.toContain('scene.render.engine = "BLENDER_WORKBENCH"')
  })

  it('uses the bundled generator even when launched from a source checkout', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blockout-generator-priority-'))
    const working = path.join(root, 'checkout/scripts/blender/generate_blockout.py')
    const packaged = path.join(root, 'resources/blender/generate_blockout.py')
    for (const file of [working, packaged]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '# QA only') }
    expect(await resolveBlenderGenerator(path.join(root, 'app.asar'), path.join(root, 'checkout'), path.join(root, 'resources'))).toBe(packaged)
    expect(await resolveBlenderGenerator(path.join(root, 'checkout'), path.join(root, 'other'), path.join(root, 'absent'))).toBe(working)
    await expect(resolveBlenderGenerator(path.join(root, 'absent'), path.join(root, 'other'), path.join(root, 'absent'))).rejects.toThrow('not found')
  })
  it('keeps every output beneath the current project generated/blender folder', () => {
    const project = path.resolve('tmp/project.blockout')
    const paths = resolveBlenderJobPaths(project, 'E01-S010-V005', 'job-123')

    expect(paths.outputFolder.startsWith(path.join(project, 'generated', 'blender') + path.sep)).toBe(true)
    expect(paths.planPath).toBe(path.join(paths.outputFolder, 'blender-plan.json'))
    expect(paths.outputRelativePath.replaceAll('\\', '/')).toBe('generated/blender/E01-S010-V005-job-123')
  })

  it('sanitizes hostile shot and job ids instead of allowing path traversal', () => {
    const project = path.resolve('tmp/project.blockout')
    const paths = resolveBlenderJobPaths(project, '../../outside', '../job')

    expect(paths.outputFolder.startsWith(path.join(project, 'generated', 'blender') + path.sep)).toBe(true)
    expect(paths.outputRelativePath).not.toContain('..')
  })

  it('parses Blender frame progress without accepting unrelated log text', () => {
    expect(parseBlenderProgress('AILIN_BLENDER_PROGRESS=37/175')).toEqual({ frame: 37, total: 175 })
    expect(parseBlenderProgress('Fra:37 Mem:12M')).toBeNull()
    expect(parseBlenderProgress('AILIN_BLENDER_PROGRESS=200/175')).toBeNull()
  })
})
