/** Host-only bridge: import the same physical pi-ai package as DSH's adapter. */
import { assertHostPiAiFunctions, resolveHostPiAiExport, resolveHostPiAiPackage } from './host-pi-ai-resolution.ts'

const pkg = resolveHostPiAiPackage(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai'))
// Host upgrades are permitted: validate the public functions we consume, not an exact version.

const core: typeof import('@earendil-works/pi-ai') = await import(resolveHostPiAiExport(pkg, '.'))
const codex: typeof import('@earendil-works/pi-ai/providers/openai-codex') = await import(resolveHostPiAiExport(pkg, './providers/openai-codex'))
const responses: typeof import('@earendil-works/pi-ai/api/openai-responses-shared') = await import(resolveHostPiAiExport(pkg, './api/openai-responses-shared'))
const transcript: typeof import('@earendil-works/pi-ai/utils/transcript') = await import(resolveHostPiAiExport(pkg, './utils/transcript'))

assertHostPiAiFunctions(core, ['InMemoryCredentialStore', 'ModelsError', 'createModels', 'defaultProviderAuthContext', 'createAssistantMessageEventStream'])
assertHostPiAiFunctions(codex, ['openaiCodexProvider'])
assertHostPiAiFunctions(responses, ['convertResponsesMessages', 'convertResponsesTools'])
assertHostPiAiFunctions(transcript, ['getCurrentSystemPrompt', 'getCurrentTools', 'normalizeContext'])

export const { InMemoryCredentialStore, ModelsError, createModels, defaultProviderAuthContext, createAssistantMessageEventStream } = core
export const { openaiCodexProvider } = codex
export const { convertResponsesMessages, convertResponsesTools } = responses
export const { getCurrentSystemPrompt, getCurrentTools, normalizeContext } = transcript
