import { describe, expect, it } from 'vitest'
import type { Context } from '@earendil-works/pi-ai'
import { codexProviderContext } from '../src/pi-context.ts'

const user = { role: 'user' as const, content: 'fixture user message', timestamp: 0 }
// Simulate the new host library crossing into the old provider's published interface.
const incoming = (value: unknown) => value as Context

describe('host transcript conversion', () => {
  it('preserves the old host context without copying', () => {
    const context: Context = { systemPrompt: 'instructions', messages: [user], tools: [] }
    expect(codexProviderContext(context)).toBe(context)
  })
  it('retains initial instructions, tools and history without mutation', () => {
    const tools = [{ name: 'fixture', description: 'test', parameters: { type: 'object' } }]
    const context = incoming({ messages: [{ role: 'system', content: 'instructions', toolsAdded: tools, timestamp: 0 }, user] })
    expect(codexProviderContext(context)).toEqual({ systemPrompt: 'instructions', tools, messages: [user] })
    expect(context.messages).toHaveLength(2)
  })
  it('retains tool-only system messages', () => {
    expect(codexProviderContext(incoming({ messages: [{ role: 'system', content: '', toolsAdded: [] }, user] })))
      .toEqual({ systemPrompt: '', tools: [], messages: [user] })
  })
  it.each([
    { messages: [user, { role: 'system', content: 'late' }] },
    { messages: [{ role: 'system', content: 'first' }, { role: 'system', content: 'late' }] },
    { messages: [{ role: 'system', content: 'first', toolsRemoved: [] }] },
    { messages: [{ role: 'system', content: 'first', sections: {} }] },
    { systemPrompt: 'ambiguous', messages: [{ role: 'system', content: 'first' }] },
    { tools: [], messages: [{ role: 'system', content: 'first' }] },
  ])('refuses unsupported transcript changes without discarding instructions', context => {
    expect(() => codexProviderContext(incoming(context))).toThrow('cannot translate')
  })
})
