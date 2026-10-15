/** Source/test and standalone CLI entry. The host build substitutes host-pi-ai.ts. */
export { InMemoryCredentialStore, ModelsError, createModels, defaultProviderAuthContext, createAssistantMessageEventStream } from '@earendil-works/pi-ai'
export { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
export { convertResponsesMessages, convertResponsesTools } from '@earendil-works/pi-ai/api/openai-responses-shared'
export { getCurrentSystemPrompt, getCurrentTools, normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
