import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { expect, it } from 'vitest'
import { selectPersistencePlugin } from '../scripts/persistence-plugin-fixture.mjs'

it('preserves the legacy class and namespace plugin identities and schemas', () => {
  class Legacy { static Config = {} }
  const namespace = { name: 'session-persistence-jsonl', Config: {}, apply() {} }
  expect(selectPersistencePlugin({ default: Legacy })).toBe(Legacy)
  const sourceRunnerNamespace = Object.assign(Object.create({ apply: Function.prototype.apply }), { default: Legacy })
  expect(selectPersistencePlugin(sourceRunnerNamespace)).toBe(Legacy)
  expect(() => selectPersistencePlugin({ default: undefined, apply() {} })).toThrow('UNSUPPORTED_PERSISTENCE_PLUGIN_EXPORT')
  expect(() => selectPersistencePlugin({ default: Legacy, apply: 'invalid' })).toThrow('UNSUPPORTED_PERSISTENCE_PLUGIN_EXPORT')
  expect(selectPersistencePlugin(namespace)).toBe(namespace)
  expect(selectPersistencePlugin(namespace).Config).toBe(namespace.Config)
  const legacyObject = { Config: {}, apply() {} }
  expect(selectPersistencePlugin({ default: legacyObject })).toBe(legacyObject)
})

it.each([undefined, null, [], {}, { default: undefined }, { default: {} },
  { apply: 'invalid' }, { default() {}, apply() {} }, { default: {}, apply() {} }])(
  'fails closed for unsupported or ambiguous persistence exports (%j)', value => {
    expect(() => selectPersistencePlugin(value)).toThrow('UNSUPPORTED_PERSISTENCE_PLUGIN_EXPORT')
  })

it('mounts and disposes the actual published JSONL provider with its Config intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'persistence-plugin-shape-'))
  const ctx = new Context()
  try {
    const plugin = selectPersistencePlugin(Persistence)
    expect(plugin.Config).toBeDefined()
    await expect(ctx.plugin(plugin, { compression: 'none' } as never)).rejects.toThrow()
    const fiber = await ctx.plugin(plugin, { root, compression: 'none' })
    expect(ctx.sessionPersistence).toBeDefined()
    await ctx.sessionPersistence.flush()
    await fiber.dispose()
    expect(ctx.sessionPersistence).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
