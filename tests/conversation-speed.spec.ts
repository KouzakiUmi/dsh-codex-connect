import { expect, it } from 'vitest'
import { ConversationSpeedRegistry, createConversationSpeedRegistry } from '../src/conversation-speed.ts'
import { httpRouteTestContext } from './http-route-test-context.ts'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import type { ConversationSpeedScope } from '../src/conversation-speed.ts'

const scope: ConversationSpeedScope = { workspace: 'fixture-workspace', accountKey: 'acct_' + 'a'.repeat(43), provider: 'openai-codex', model: 'gpt-6.1-sol' }
it('ignores a foreign Session incarnation with the same id instead of clearing an owned choice', async () => {
  const { ctx } = httpRouteTestContext()
  await ctx.plugin(Sessions)
  const owned = (ctx.get('sessions') as unknown as Sessions).create(SessionId('owned-speed'))
  const registry = createConversationSpeedRegistry(ctx)
  const current = { ...scope, workspace: registry.workspaceFor(owned.id) }
  choose(registry, 'ultrafast', current, owned.id)
  const foreign = { id: owned.id } as Session
  ctx.emit('session/event', foreign, { type: 'model/selection', seq: 1 } as SessionEvent)
  expect(registry.requestSpeed(owned.id, current)).toBe('ultrafast')
})
it('observes the real Host live SessionStore append feed without reading session history', async () => {
  const { ctx } = httpRouteTestContext()
  await ctx.plugin(Sessions)
  const sessions = ctx.get('sessions') as unknown as Sessions
  const session = sessions.create(SessionId('native-speed'))
  const registry = createConversationSpeedRegistry(ctx)
  const before = { ...scope, workspace: registry.workspaceFor(session.id) }
  choose(registry, 'ultrafast', before, session.id)
  const captured = registry.captureSpeed(session.id)
  session.append('model/selection', { provider: 'openai-codex', model: 'gpt-6-astra' })
  session.append('model/selection', { provider: 'openai-codex', model: 'gpt-6.1-sol' })
  const after = { ...scope, workspace: registry.workspaceFor(session.id) }
  expect(after.workspace).not.toBe(before.workspace)
  expect(registry.requestSpeed(session.id, after)).toBe('standard')
  expect(() => registry.confirmCapturedSpeed(session.id, captured, after)).toThrow('ULTRAFAST_SELECTION_EXPIRED')
  expect(registry.readSpeed(session.id, after).mode).toBe('standard')
})
it('invalidates a paid login/account A/B/A choice and pending mutation without changing legacy Fast preferences', () => {
  const registry = new ConversationSpeedRegistry(), before = { ...scope, workspace: registry.workspaceFor('session') }
  const old = choose(registry, 'ultrafast', before), captured = registry.captureSpeed('session')
  registry.set('legacy', true)
  registry.invalidateAccountSelections(); registry.invalidateAccountSelections()
  const after = { ...scope, workspace: registry.workspaceFor('session') }
  expect(() => registry.confirmCapturedSpeed('session', captured, after)).toThrow('ULTRAFAST_SELECTION_EXPIRED')
  expect(() => registry.selectSpeed('session', after, old.generation, old.revision, 'ultrafast')).toThrow('SPEED_SELECTION_STALE')
  expect(registry.readSpeed('session', after).mode).toBe('standard')
  expect(registry.isEnabled('legacy')).toBe(true)
})
it('invalidates a paid choice across Host selection A/B/A even if no HTTP invalidation succeeds', () => {
  const session = { id: SessionId('session') } as Session
  const { ctx } = httpRouteTestContext({ sessions: { get: () => session } })
  const registry = createConversationSpeedRegistry(ctx)
  const before = { ...scope, workspace: registry.workspaceFor('session') }
  choose(registry, 'ultrafast', before)
  const captured = registry.captureSpeed('session')
  ctx.emit('session/event', session, { type: 'model/selection', seq: 2 } as SessionEvent)
  ctx.emit('session/event', session, { type: 'model/selection', seq: 3 } as SessionEvent)
  const after = { ...scope, workspace: registry.workspaceFor('session') }
  expect(after.workspace).not.toBe(before.workspace)
  expect(() => registry.confirmCapturedSpeed('session', captured, after)).toThrow('ULTRAFAST_SELECTION_EXPIRED')
  expect(registry.readSpeed('session', after).mode).toBe('standard')
})
it('fails closed when a Host cannot expose the live conversation selection', () => {
  const { ctx } = httpRouteTestContext()
  const registry = createConversationSpeedRegistry(ctx), current = { ...scope, workspace: registry.workspaceFor('session') }
  expect(registry.readSpeed('session', current).selectionAvailable).toBe(false)
  expect(() => choose(registry, 'ultrafast', current)).toThrow('ULTRAFAST_SELECTION_UNAVAILABLE')
})
function choose(registry: ConversationSpeedRegistry, mode: 'standard' | 'fast' | 'ultrafast', currentScope = scope, session = 'session') {
  const state = registry.readSpeed(session, currentScope)
  return registry.selectSpeed(session, currentScope, state.generation, state.revision, mode)
}
it('starts Standard with unknown eligibility and keeps the three modes exclusive', () => {
  const registry = new ConversationSpeedRegistry()
  expect(registry.readSpeed('session', scope)).toMatchObject({ mode: 'standard', eligibility: 'unknown', modelSupported: true })
  expect(choose(registry, 'fast').mode).toBe('fast')
  expect(registry.isEnabled('session')).toBe(true)
  expect(choose(registry, 'ultrafast').mode).toBe('ultrafast')
  expect(registry.isEnabled('session')).toBe(false)
  expect(registry.requestSpeed('session', scope)).toBe('ultrafast')
  expect(choose(registry, 'standard').eligibility).toBe('unknown')
  expect(registry.requestSpeed('session', scope)).toBe('standard')
})
it('lets legacy Fast/Standard commands invalidate every previous Ultrafast choice', () => {
  const registry = new ConversationSpeedRegistry(), old = choose(registry, 'ultrafast')
  registry.set('session', true)
  expect(registry.requestSpeed('session', scope)).toBe('fast')
  registry.setEnabled('session', false)
  expect(registry.requestSpeed('session', scope)).toBe('standard')
  expect(() => registry.selectSpeed('session', scope, old.generation, old.revision, 'ultrafast')).toThrow('SPEED_SELECTION_STALE')
})
it.each(['choice-first', 'invalidation-first'])('prevents a pending old-model Ultrafast choice from reactivating after %s', order => {
  const registry = new ConversationSpeedRegistry(), old = registry.readSpeed('session', scope)
  if (order === 'choice-first') registry.selectSpeed('session', scope, old.generation, old.revision, 'ultrafast')
  registry.readSpeed('session', { ...scope, workspace: 'changed-workspace' })
  if (order === 'invalidation-first') {
    expect(() => registry.selectSpeed('session', scope, old.generation, old.revision, 'ultrafast')).toThrow('SPEED_SELECTION_STALE')
  }
  const next = registry.readSpeed('session', scope)
  expect(next.generation).not.toBe(old.generation)
  expect(next.mode).toBe('standard')
})
it('does not let an old-model mutation clear a newer explicit choice', () => {
  const registry = new ConversationSpeedRegistry(), old = choose(registry, 'ultrafast')
  const nextScope = { ...scope, model: 'gpt-6-astra' }
  choose(registry, 'ultrafast', nextScope)
  expect(() => registry.selectSpeed('session', scope, old.generation, old.revision, 'standard')).toThrow('SPEED_SELECTION_STALE')
  expect(registry.requestSpeed('session', nextScope)).toBe('ultrafast')
})
it.each([{ accountKey: 'acct_' + 'b'.repeat(43) }, { workspace: 'other-workspace' }, { model: 'gpt-6-astra' }])('refuses a request after a bound scope changes instead of silently changing tier', patch => {
  const registry = new ConversationSpeedRegistry(); choose(registry, 'ultrafast')
  expect(() => registry.requestSpeed('session', { ...scope, ...patch })).toThrow('ULTRAFAST_SELECTION_EXPIRED')
  expect(() => registry.requestSpeed('session', scope)).toThrow('ULTRAFAST_SELECTION_EXPIRED')
  expect(registry.readSpeed('session', scope).mode).toBe('standard')
  expect(registry.requestSpeed('session', scope)).toBe('standard')
})
it('preserves an explicitly enabled legacy Fast choice through a model change', () => {
  const registry = new ConversationSpeedRegistry(); registry.set('session', true)
  const previous = registry.readSpeed('session', scope)
  expect(previous.mode).toBe('fast')
  expect(registry.readSpeed('session', { ...scope, model: 'gpt-5.6-sol' }).mode).toBe('fast')
})
it('requires a signed-in scope and an exact supported model for Ultrafast', () => {
  const registry = new ConversationSpeedRegistry()
  expect(() => choose(registry, 'ultrafast', { ...scope, accountKey: undefined })).toThrow('ULTRAFAST_SIGN_IN_REQUIRED')
  expect(() => choose(registry, 'ultrafast', { ...scope, model: 'gpt-6-sol' })).toThrow('ULTRAFAST_MODEL_UNSUPPORTED')
})
it('does not accept an old generation after bounded control eviction', () => {
  const registry = new ConversationSpeedRegistry(1), old = choose(registry, 'ultrafast')
  registry.readSpeed('other', scope)
  expect(() => registry.selectSpeed('session', scope, old.generation, old.revision, 'ultrafast')).toThrow('SPEED_SELECTION_STALE')
  expect(registry.readSpeed('session', scope).generation).not.toBe(old.generation)
})
it('rejects a duplicate or stale mutation without replaying it', () => {
  const registry = new ConversationSpeedRegistry(), old = registry.readSpeed('session', scope)
  registry.selectSpeed('session', scope, old.generation, old.revision, 'ultrafast')
  expect(() => registry.selectSpeed('session', scope, old.generation, old.revision, 'fast')).toThrow('SPEED_SELECTION_STALE')
  expect(registry.requestSpeed('session', scope)).toBe('ultrafast')
})
it('keeps an in-flight captured account choice independent of later control changes', () => {
  const registry = new ConversationSpeedRegistry(); choose(registry, 'ultrafast')
  const captured = registry.captureSpeed('session')
  const nextScope = { ...scope, accountKey: 'acct_' + 'b'.repeat(43) }
  expect(registry.readSpeed('session', nextScope).mode).toBe('standard')
  expect(registry.confirmCapturedSpeed('session', captured, scope)).toBe('ultrafast')
  expect(registry.confirmCapturedSpeed('session', registry.captureSpeed('session'), nextScope)).toBe('standard')
})
it('does not poison a newer account choice when an older captured request is rejected', () => {
  const registry = new ConversationSpeedRegistry(); choose(registry, 'ultrafast')
  const captured = registry.captureSpeed('session'), nextScope = { ...scope, accountKey: 'acct_' + 'b'.repeat(43) }
  choose(registry, 'ultrafast', nextScope)
  expect(() => registry.confirmCapturedSpeed('session', captured, nextScope)).toThrow('ULTRAFAST_SELECTION_EXPIRED')
  expect(() => registry.confirmCapturedSpeed('session', captured, scope)).toThrow('ULTRAFAST_SELECTION_EXPIRED')
  expect(registry.requestSpeed('session', nextScope)).toBe('ultrafast')
})
