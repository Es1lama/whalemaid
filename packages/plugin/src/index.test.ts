import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { checkSync } from 'proper-lockfile'
import { describe, expect, it } from 'vitest'
import { apply } from './index.js'

describe('plugin profile ownership lifecycle', () => {
  it('releases the profile lock on disposal after the no-relay early return', async () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'whalemaid-plugin-lifecycle-'))
    const ctx = new Context()
    ;(ctx as unknown as { baseUrl: string }).baseUrl = `${pathToFileURL(profileDir).href}/`

    apply(ctx)

    const stateFile = join(realpathSync(profileDir), 'whalemaid', 'store.json')
    expect(checkSync(stateFile, { realpath: false, stale: 30_000 })).toBe(true)

    await ctx.fiber.dispose()
    expect(checkSync(stateFile, { realpath: false, stale: 30_000 })).toBe(false)
  })
})
