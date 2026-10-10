import { createRequire } from "node:module";
//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js
var FifoQueue = class {
	incoming = [];
	outgoing = [];
	get length() {
		return this.incoming.length + this.outgoing.length;
	}
	enqueue(value) {
		this.incoming.push(value);
	}
	dequeue() {
		if (this.outgoing.length === 0) while (this.incoming.length > 0) this.outgoing.push(this.incoming.pop());
		return this.outgoing.pop();
	}
};
var EventStream = class {
	queue = new FifoQueue();
	waiting = new FifoQueue();
	done = false;
	finalResultPromise;
	resolveFinalResult;
	isComplete;
	extractResult;
	constructor(isComplete, extractResult) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}
	push(event) {
		if (this.done) return;
		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}
		const waiter = this.waiting.dequeue();
		if (waiter) waiter({
			value: event,
			done: false
		});
		else this.queue.enqueue(event);
	}
	end(result) {
		this.done = true;
		if (result !== void 0) this.resolveFinalResult(result);
		while (this.waiting.length > 0) this.waiting.dequeue()({
			value: void 0,
			done: true
		});
	}
	async *[Symbol.asyncIterator]() {
		while (true) if (this.queue.length > 0) yield this.queue.dequeue();
		else if (this.done) return;
		else {
			const result = await new Promise((resolve) => this.waiting.enqueue(resolve));
			if (result.done) return;
			yield result.value;
		}
	}
	result() {
		return this.finalResultPromise;
	}
};
/**
* Event stream of one assistant response. It also times the response: the final message (`done` or `error` event, or
* the result passed to `end()`) gets `durationMs`, measured with a monotonic clock from the stream's creation, unless
* the message already has one or its `timestamp` predates the stream. A stream that forwards a response which started
* elsewhere, such as a deferred result fetched later, therefore leaves it untimed.
*/
var AssistantMessageEventStream = class extends EventStream {
	#startedAt = Date.now();
	#startedAtMonotonic = performance.now();
	constructor() {
		super((event) => event.type === "done" || event.type === "error", (event) => {
			if (event.type === "done") return event.message;
			else if (event.type === "error") return event.error;
			throw new Error("Unexpected event type for final result");
		});
	}
	push(event) {
		if (event.type === "done") this.#time(event.message);
		else if (event.type === "error") this.#time(event.error);
		super.push(event);
	}
	end(result) {
		if (result !== void 0) this.#time(result);
		super.end(result);
	}
	#time(message) {
		if (this.done || message.durationMs !== void 0 || message.timestamp < this.#startedAt) return;
		message.durationMs = Math.max(0, Math.round(performance.now() - this.#startedAtMonotonic));
	}
};
/** Factory function for AssistantMessageEventStream (for use in extensions) */
function createAssistantMessageEventStream() {
	return new AssistantMessageEventStream();
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/api/lazy.js
function createSetupErrorMessage(model, error, timestamp) {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0
			}
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp
	};
}
function hasResult(source) {
	return typeof source.result === "function";
}
async function forwardStream(target, source) {
	for await (const event of source) target.push(event);
	target.end(hasResult(source) ? await source.result() : void 0);
}
/**
* Returns a stream synchronously while running async setup (auth resolution,
* lazy module loading) behind it. Setup failures terminate the stream with an
* error event.
*/
function lazyStream(model, setup) {
	const startedAt = Date.now();
	const outer = new AssistantMessageEventStream();
	setup().then((inner) => forwardStream(outer, inner)).catch((error) => {
		const message = createSetupErrorMessage(model, error, startedAt);
		outer.push({
			type: "error",
			reason: "error",
			error: message
		});
		outer.end(message);
	});
	return outer;
}
function lazyApi(load, capabilities) {
	const api = {
		stream: (model, context, options) => lazyStream(model, async () => (await load()).stream(model, context, options)),
		streamSimple: (model, context, options) => lazyStream(model, async () => (await load()).streamSimple(model, context, options))
	};
	if (capabilities?.fetchDeferred) api.fetchDeferred = (model, handle, options) => lazyStream(model, async () => {
		const implementation = await load();
		if (!implementation.fetchDeferred) throw new Error("API does not support deferred responses");
		return implementation.fetchDeferred(model, handle, options);
	});
	if (capabilities?.cancelDeferred) api.cancelDeferred = async (model, handle, options) => {
		const implementation = await load();
		if (!implementation.cancelDeferred) throw new Error("API cannot cancel deferred responses");
		await implementation.cancelDeferred(model, handle, options);
	};
	return api;
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/auth/context.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
const importNodeModule = (specifier) => import(__rewriteRelativeImportExtension(specifier));
function getProcessEnv() {
	return globalThis.process?.env;
}
/**
* Default auth context: env vars from `process.env` (undefined in browsers),
* file existence via node:fs (always false in browsers).
*/
function defaultProviderAuthContext() {
	return {
		async env(name) {
			const value = getProcessEnv()?.[name];
			return typeof value === "string" && value.trim().length > 0 ? value : void 0;
		},
		async fileExists(path) {
			try {
				const fs = await importNodeModule("node:fs/promises");
				let resolved = path;
				if (resolved.startsWith("~")) resolved = (await importNodeModule("node:os")).homedir() + resolved.slice(1);
				await fs.access(resolved);
				return true;
			} catch {
				return false;
			}
		}
	};
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/abort.js
function abortReason(signal) {
	if (signal.reason !== void 0) return signal.reason;
	const error = /* @__PURE__ */ new Error("The operation was aborted");
	error.name = "AbortError";
	return error;
}
/** Create an operation-local signal for public APIs whose signal is optional. */
function operationSignal(signal) {
	return signal ?? new AbortController().signal;
}
/**
* Stop waiting for an operation when its signal aborts while continuing to
* observe the abandoned promise so a later rejection is always handled.
*/
function raceWithAbortSignal(operation, signal) {
	if (signal.aborted) {
		operation.catch(() => {});
		return Promise.reject(abortReason(signal));
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(abortReason(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		}, (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		});
		if (signal.aborted) onAbort();
	});
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/auth/credential-store.js
/**
* Default in-memory credential store. Apps inject persistent stores.
* Keyed by `Provider.id`, one credential per provider; see `CredentialStore`.
* Writes are serialized per provider through a promise chain.
*/
var InMemoryCredentialStore = class {
	credentials = /* @__PURE__ */ new Map();
	chains = /* @__PURE__ */ new Map();
	/** Serialize tasks per provider id without releasing the chain before active work settles. */
	enqueue(providerId, task, options) {
		const signal = operationSignal(options?.signal);
		const previous = this.chains.get(providerId) ?? Promise.resolve();
		const queued = (async () => {
			await previous.catch(() => {});
			signal.throwIfAborted();
			return task();
		})();
		const tail = queued.catch(() => {});
		this.chains.set(providerId, tail);
		tail.then(() => {
			if (this.chains.get(providerId) === tail) this.chains.delete(providerId);
		});
		return raceWithAbortSignal(queued, signal);
	}
	async read(providerId, options) {
		options?.signal?.throwIfAborted();
		return this.credentials.get(providerId);
	}
	async list(options) {
		options?.signal?.throwIfAborted();
		return [...this.credentials].map(([providerId, credential]) => ({
			providerId,
			type: credential.type
		}));
	}
	modify(providerId, fn, options) {
		return this.enqueue(providerId, async () => {
			const current = this.credentials.get(providerId);
			const next = await fn(current);
			options?.signal?.throwIfAborted();
			if (next !== void 0) this.credentials.set(providerId, next);
			return next ?? current;
		}, options);
	}
	delete(providerId, options) {
		return this.enqueue(providerId, async () => {
			this.credentials.delete(providerId);
		}, options);
	}
};
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/diagnostics.js
function formatThrownValue(value) {
	if (value instanceof Error) return value.message || value.name;
	if (typeof value === "string") return value;
	return String(value);
}
function extractDiagnosticError(error) {
	if (!(error instanceof Error)) return {
		name: "ThrownValue",
		message: formatThrownValue(error)
	};
	const code = error.code;
	return {
		name: error.name || void 0,
		message: error.message || error.name,
		stack: error.stack,
		code: typeof code === "string" || typeof code === "number" ? code : void 0
	};
}
function createAssistantMessageDiagnostic(type, error, details) {
	return {
		type,
		timestamp: Date.now(),
		error: extractDiagnosticError(error),
		details
	};
}
function appendAssistantMessageDiagnostic(message, diagnostic) {
	message.diagnostics = [...message.diagnostics ?? [], diagnostic];
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/models-error.js
var ModelsError = class extends Error {
	code;
	constructor(code, message, options) {
		super(withCauseDetail(message, options?.cause), options);
		this.name = "ModelsError";
		this.code = code;
	}
};
/** Callers surface `error.message` only, so keep the underlying reason in it. */
function withCauseDetail(message, cause) {
	if (cause === void 0 || cause === null) return message;
	const detail = formatThrownValue(cause).trim();
	if (!detail || message.includes(detail)) return message;
	return `${message}: ${detail}`;
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/auth/resolve.js
/**
* Auth resolution shared by all operations in a `Models` collection.
* A stored credential owns the provider: ambient/env is consulted only when
* nothing is stored. No silent env fallback after a failed refresh or for a
* credential type without a matching handler.
*/
function resolveProviderAuth(provider, credentials, authContext, overrides) {
	const signal = operationSignal(overrides?.signal);
	return raceWithAbortSignal(resolveProviderAuthWithSignal(provider, credentials, authContext, overrides, signal), signal);
}
async function resolveProviderAuthWithSignal(provider, credentials, authContext, overrides, signal) {
	signal.throwIfAborted();
	const requestAuthContext = overrides?.env ? overlayEnvAuthContext(authContext, overrides.env) : authContext;
	if (overrides?.apiKey !== void 0 && provider.auth.apiKey) return resolveApiKey(requestAuthContext, provider.auth.apiKey, provider.id, {
		type: "api_key",
		key: overrides.apiKey,
		env: overrides.env
	}, signal);
	const stored = await readCredential(credentials, provider.id, signal);
	if (stored) {
		if (stored.type === "oauth" && provider.auth.oauth) return resolveStoredOAuth(credentials, provider.id, provider.auth.oauth, stored, signal, overrides?.minOAuthValidityMs);
		if (stored.type === "api_key" && provider.auth.apiKey) {
			const credential = overrides?.env ? {
				...stored,
				env: {
					...stored.env,
					...overrides.env
				}
			} : stored;
			return resolveApiKey(requestAuthContext, provider.auth.apiKey, provider.id, credential, signal);
		}
		return;
	}
	return provider.auth.apiKey ? resolveApiKey(requestAuthContext, provider.auth.apiKey, provider.id, void 0, signal) : void 0;
}
function overlayEnvAuthContext(base, env) {
	return {
		env: async (name) => env[name] || await base.env(name),
		fileExists: (path) => base.fileExists(path)
	};
}
const DEFAULT_OAUTH_MINIMUM_VALIDITY_MS = 3e5;
const DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 15e3;
/**
* Refresh a stored OAuth credential under the credential-store lock and persist
* the result before the lock is released. `needsRefresh` is re-checked under
* the lock, so concurrent callers and processes refresh only once.
*
* `signal` cancels only the wait for the lock. Once a refresh starts, the
* provider may already have rotated the refresh token, so the refresh and its
* persistence ignore `signal` and are bounded only by a timeout. Otherwise a
* cancelled caller could discard the only valid refresh token. Callers that
* must return promptly on cancellation race this promise with their signal.
*
* Resolves with the stored OAuth credential after the operation, or undefined
* when the provider no longer has an OAuth credential.
*/
async function refreshStoredOAuthCredential(credentials, providerId, oauth, needsRefresh, signal) {
	let post;
	const lockWait = new AbortController();
	const cancelLockWait = () => lockWait.abort(signal.reason);
	signal.addEventListener("abort", cancelLockWait, { once: true });
	if (signal.aborted) cancelLockWait();
	try {
		post = await credentials.modify(providerId, async (current) => {
			signal.removeEventListener("abort", cancelLockWait);
			signal.throwIfAborted();
			if (current?.type !== "oauth") return void 0;
			if (!needsRefresh(current)) return void 0;
			try {
				return await oauth.refresh(current, AbortSignal.timeout(DEFAULT_OAUTH_REFRESH_TIMEOUT_MS));
			} catch (error) {
				throw new ModelsError("oauth", `OAuth refresh failed for ${providerId}`, { cause: error });
			}
		}, { signal: lockWait.signal });
	} catch (error) {
		if (error instanceof ModelsError) throw error;
		signal.throwIfAborted();
		throw new ModelsError("auth", `Credential store modify failed for ${providerId}`, { cause: error });
	} finally {
		signal.removeEventListener("abort", cancelLockWait);
	}
	return post?.type === "oauth" ? post : void 0;
}
/**
* OAuth resolution with double-checked locking: tokens with less than five
* minutes remaining are refreshed through `refreshStoredOAuthCredential`.
*/
async function resolveStoredOAuth(credentials, providerId, oauth, stored, signal, minOAuthValidityMs) {
	const minimumValidityMs = Math.max(DEFAULT_OAUTH_MINIMUM_VALIDITY_MS, minOAuthValidityMs ?? 0);
	const expiresSoon = (credential) => Date.now() + minimumValidityMs >= credential.expires;
	let credential = stored;
	if (expiresSoon(credential)) {
		const post = await refreshStoredOAuthCredential(credentials, providerId, oauth, expiresSoon, signal);
		if (!post) return void 0;
		credential = post;
		if (minOAuthValidityMs !== void 0 && expiresSoon(credential)) throw new ModelsError("oauth", `OAuth refresh returned a token that expires too soon for ${providerId}`);
	}
	try {
		return {
			auth: await oauth.toAuth(credential),
			source: "OAuth"
		};
	} catch (error) {
		throw new ModelsError("oauth", `OAuth auth derivation failed for ${providerId}`, { cause: error });
	}
}
async function resolveApiKey(authContext, apiKey, providerId, credential, signal) {
	try {
		return await apiKey.resolve({
			ctx: authContext,
			credential,
			signal
		});
	} catch (error) {
		throw new ModelsError("auth", `API key auth failed for provider ${providerId}`, { cause: error });
	}
}
async function readCredential(credentials, providerId, signal) {
	try {
		return await credentials.read(providerId, { signal });
	} catch (error) {
		throw new ModelsError("auth", `Credential store read failed for ${providerId}`, { cause: error });
	}
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/models-store.js
var InMemoryModelsStore = class {
	entries = /* @__PURE__ */ new Map();
	async read(providerId, options) {
		options?.signal?.throwIfAborted();
		const entry = this.entries.get(providerId);
		return entry ? structuredClone(entry) : void 0;
	}
	async write(providerId, entry, options) {
		options?.signal?.throwIfAborted();
		this.entries.set(providerId, structuredClone(entry));
	}
	async delete(providerId, options) {
		options?.signal?.throwIfAborted();
		this.entries.delete(providerId);
	}
};
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/model-operations.js
/** The type of a model. Models without `type` are chat models. */
function getModelType(model) {
	return model.type ?? "chat";
}
/** Runtime-checked model type narrowing, including legacy chat models without `type`. */
function isModelType(model, type) {
	return getModelType(model) === type;
}
function assertChatModel(model) {
	if (!isModelType(model, "chat")) throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not a chat model`);
}
function assertImageModel(model) {
	if (!isModelType(model, "image")) throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not an image model`);
}
function assertClassifierModel(model) {
	if (!isModelType(model, "classifier")) throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not a classifier model`);
}
/** Rejects classifier images for models whose catalog entry does not accept image input. */
function assertClassifierInputSupported(model, context) {
	if (context.images?.length && !model.input.includes("image")) throw new ModelsError("provider", `Model ${model.provider}/${model.id} does not accept image input`);
}
function imageErrorResult(model, error, aborted = false) {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now()
	};
}
function classifierErrorResult(model, error, aborted = false) {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now()
	};
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/text.js
/** Extract and join text from message content. */
function contentText(content, separator = "\n") {
	if (typeof content === "string") return content;
	return content.filter((block) => block.type === "text").map((block) => block.text).join(separator);
}
/** Render a system message as a complete prompt: its content followed by its sections. */
function getSystemMessageText(message) {
	const parts = [contentText(message.content)];
	for (const text of Object.values(message.sections ?? {})) if (text !== null) parts.push(text);
	return parts.filter((part) => part.length > 0).join("\n\n");
}
/**
* Render a later system message for APIs that accept system messages mid-conversation.
* Section changes are framed by name so the model can relate them to the leading prompt.
* This framing is request-time only and may change between versions.
*/
function renderSystemMessageUpdate(message) {
	const parts = [];
	const text = contentText(message.content);
	if (text.length > 0) parts.push(text);
	for (const [name, value] of Object.entries(message.sections ?? {})) parts.push(value === null ? `Removed system prompt section "${name}".` : `Updated system prompt section "${name}":\n\n${value}`);
	return parts.join("\n\n");
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/transcript.js
/**
* Build the leading system message for a prompt and tool set. Returns undefined when
* both are empty, so an empty transcript stays empty.
*/
function createInitialSystemMessage(systemPrompt, tools) {
	const hasSystemPrompt = systemPrompt !== void 0 && systemPrompt.length > 0;
	const hasTools = tools !== void 0 && tools.length > 0;
	if (!hasSystemPrompt && !hasTools) return void 0;
	return {
		role: "system",
		content: systemPrompt ?? "",
		...hasTools ? { toolsAdded: tools } : {},
		timestamp: 0
	};
}
/**
* Fold `Context.systemPrompt` and `Context.tools` into a leading system message.
* This is the only entry point that produces a {@link TranscriptContext}; every
* provider-facing function expects the result.
*/
function normalizeContext(context) {
	const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
	return { messages: initialMessage ? [initialMessage, ...context.messages] : context.messages };
}
function isSystemMessage(message) {
	return message.role === "system";
}
/** Return the leading system message, if the transcript starts with one. */
function getInitialSystemMessage(messages) {
	const first = messages[0];
	return first && isSystemMessage(first) ? first : void 0;
}
/** Resolve the tools available after applying every transcript delta in order. */
function getCurrentTools(messages) {
	const tools = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
		for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
	}
	return [...tools.values()];
}
/**
* Replay every system message into one leading system message holding the current
* prompt and tools. Later `content` is appended to the base prompt, `sections` are
* patched by name, and tools are resolved with {@link getCurrentTools}.
*/
function getCurrentSystemMessage(messages) {
	const content = [];
	const sections = /* @__PURE__ */ new Map();
	let timestamp;
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		timestamp ??= message.timestamp;
		const text = contentText(message.content);
		if (text.length > 0) content.push(text);
		for (const [name, value] of Object.entries(message.sections ?? {})) if (value === null) sections.delete(name);
		else sections.set(name, value);
	}
	const tools = getCurrentTools(messages);
	if (timestamp === void 0 && tools.length === 0) return void 0;
	return {
		role: "system",
		content: content.join("\n\n"),
		...sections.size > 0 ? { sections: Object.fromEntries(sections) } : {},
		...tools.length > 0 ? { toolsAdded: tools } : {},
		timestamp: timestamp ?? 0
	};
}
/** Render the current system prompt text after replaying every system message. */
function getCurrentSystemPrompt(messages) {
	const message = getCurrentSystemMessage(messages);
	return message ? getSystemMessageText(message) : "";
}
/**
* Rebuild the transcript for APIs without mid-conversation system messages: the replayed
* system message leads, and every later system message is dropped.
*/
function collapseSystemMessages(context) {
	const head = getCurrentSystemMessage(context.messages);
	const messages = context.messages.filter((message) => message.role !== "system");
	return { messages: head ? [head, ...messages] : messages };
}
/** Keep later system messages in place when the model accepts them; otherwise collapse them. */
function resolveTranscript(context, supportsMidConvoSystemMessages) {
	return supportsMidConvoSystemMessages ? context : collapseSystemMessages(context);
}
/** Every definition referenced by transcript tool state, in first-declaration order. */
function getDeclaredTools(messages) {
	const definitions = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		for (const tool of message.toolsAdded ?? []) definitions.set(tool.name, tool);
	}
	return [...definitions.values()];
}
/** Whether tool history contains a removal or same-name redeclaration that an addition-only transport cannot replay. */
function hasNonAdditiveToolChanges(messages) {
	const declared = /* @__PURE__ */ new Set();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		if ((message.toolsRemoved?.length ?? 0) > 0) return true;
		for (const tool of message.toolsAdded ?? []) {
			if (declared.has(tool.name)) return true;
			declared.add(tool.name);
		}
	}
	return false;
}
/**
* Split tool declarations between the top-level request field and in-place additions.
* Transports that can anchor additions at a system message keep the initial tools at the
* top and load later ones where they appear; that only works when no tool was removed or
* redeclared, so everything else sends the current tool list.
*/
function resolveTranscriptTools(messages, supportsToolAdditions) {
	const anchorsAdditions = supportsToolAdditions && !hasNonAdditiveToolChanges(messages);
	return {
		requestTools: anchorsAdditions ? getInitialSystemMessage(messages)?.toolsAdded ?? [] : getCurrentTools(messages),
		anchorsAdditions
	};
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/models.js
const KNOWN_MODEL_TYPES = {
	chat: true,
	image: true,
	classifier: true
};
/** Models from stores and remote sources may have types that only newer versions know. */
function hasKnownModelType(model) {
	return Object.hasOwn(KNOWN_MODEL_TYPES, getModelType(model));
}
/** Drops stored models whose type this version does not know. */
function withKnownModelTypes(entry) {
	return {
		...entry,
		models: entry.models.filter(hasKnownModelType)
	};
}
function mergeHeaders(base, override) {
	if (!base && !override) return void 0;
	const merged = { ...base };
	for (const [name, value] of Object.entries(override ?? {})) {
		const lowerName = name.toLowerCase();
		for (const existingName of Object.keys(merged)) if (existingName.toLowerCase() === lowerName) delete merged[existingName];
		merged[name] = value;
	}
	return merged;
}
var ModelsImpl = class {
	providers = /* @__PURE__ */ new Map();
	credentials;
	modelsStore;
	authContext;
	refreshGenerations = /* @__PURE__ */ new Map();
	refreshControllers = /* @__PURE__ */ new Map();
	publicationChains = /* @__PURE__ */ new Map();
	constructor(options) {
		this.credentials = options?.credentials ?? new InMemoryCredentialStore();
		this.modelsStore = options?.modelsStore ?? new InMemoryModelsStore();
		this.authContext = options?.authContext ?? defaultProviderAuthContext();
	}
	setProvider(provider) {
		this.supersedeProviderRefresh(provider.id);
		this.providers.set(provider.id, provider);
	}
	deleteProvider(id) {
		this.supersedeProviderRefresh(id);
		this.providers.delete(id);
	}
	clearProviders() {
		for (const id of /* @__PURE__ */ new Set([...this.providers.keys(), ...this.refreshControllers.keys()])) this.supersedeProviderRefresh(id);
		this.providers.clear();
	}
	getProviders() {
		return Array.from(this.providers.values());
	}
	getProvider(id) {
		return this.providers.get(id);
	}
	getModels(provider) {
		if (provider !== void 0) {
			const entry = this.providers.get(provider);
			if (!entry) return [];
			try {
				return entry.getModels();
			} catch {
				return [];
			}
		}
		const models = [];
		for (const entry of this.providers.values()) try {
			models.push(...entry.getModels());
		} catch {}
		return models;
	}
	getAllModels(provider) {
		if (provider !== void 0) {
			const entry = this.providers.get(provider);
			if (!entry) return [];
			try {
				return entry.getAllModels?.() ?? entry.getModels();
			} catch {
				return [];
			}
		}
		const models = [];
		for (const entry of this.providers.values()) try {
			models.push(...entry.getAllModels?.() ?? entry.getModels());
		} catch {}
		return models;
	}
	getModelsOfType(type, provider) {
		return this.getAllModels(provider).filter((model) => isModelType(model, type));
	}
	getModel(provider, id) {
		return this.getModels(provider).find((model) => model.id === id);
	}
	getModelOfType(type, provider, id) {
		return this.getModelsOfType(type, provider).find((model) => model.id === id);
	}
	supersedeProviderRefresh(providerId) {
		const generation = (this.refreshGenerations.get(providerId) ?? 0) + 1;
		this.refreshGenerations.set(providerId, generation);
		const previous = this.refreshControllers.get(providerId);
		if (previous) {
			this.refreshControllers.delete(providerId);
			previous.abort();
		}
		return generation;
	}
	beginProviderRefresh(providerId) {
		const generation = this.supersedeProviderRefresh(providerId);
		const controller = new AbortController();
		this.refreshControllers.set(providerId, controller);
		return {
			generation,
			controller
		};
	}
	publishProviderModels(providerId, generation, signal, publication) {
		const previous = this.publicationChains.get(providerId) ?? Promise.resolve();
		const queued = (async () => {
			await previous.catch(() => {});
			if (signal.aborted || this.refreshGenerations.get(providerId) !== generation) return false;
			if (publication.persist === null) await this.modelsStore.delete(providerId, { signal });
			else if (publication.persist !== void 0) await this.modelsStore.write(providerId, structuredClone(publication.persist), { signal });
			if (signal.aborted || this.refreshGenerations.get(providerId) !== generation) return false;
			publication.update?.();
			return true;
		})();
		const tail = queued.catch(() => {});
		this.publicationChains.set(providerId, tail);
		tail.then(() => {
			if (this.publicationChains.get(providerId) === tail) this.publicationChains.delete(providerId);
		});
		return raceWithAbortSignal(queued, signal);
	}
	async runProviderRefreshPhase(provider, credential, allowNetwork, force, generation, signal) {
		const stored = await this.modelsStore.read(provider.id, { signal });
		await provider.refreshModels({
			credential,
			stored: stored ? withKnownModelTypes(structuredClone(stored)) : void 0,
			publish: (publication) => this.publishProviderModels(provider.id, generation, signal, publication),
			allowNetwork,
			force: allowNetwork ? force : void 0,
			signal
		});
	}
	async refresh(options = {}) {
		const allowNetwork = options.allowNetwork ?? true;
		const callerSignal = operationSignal(options.signal);
		const errors = /* @__PURE__ */ new Map();
		if (callerSignal.aborted) return {
			aborted: true,
			errors
		};
		const selected = options.providers ? new Set(options.providers) : void 0;
		const refreshable = Array.from(this.providers.values()).filter((provider) => provider.refreshModels !== void 0 && (!selected || selected.has(provider.id)));
		const refresh = Promise.all(refreshable.map(async (provider) => {
			const { generation, controller } = this.beginProviderRefresh(provider.id);
			const signal = AbortSignal.any([callerSignal, controller.signal]);
			const operation = (async () => {
				let storedCredential;
				let credentialError;
				try {
					storedCredential = await this.readCredential(provider.id, signal);
				} catch (error) {
					credentialError = error;
				}
				await this.runProviderRefreshPhase(provider, storedCredential, false, void 0, generation, signal);
				if (credentialError !== void 0) throw credentialError;
				if (!allowNetwork || signal.aborted) return;
				const credential = await this.resolveRefreshCredential(provider, storedCredential, signal);
				if (!credential) return;
				await this.runProviderRefreshPhase(provider, credential, true, options.force, generation, signal);
			})();
			try {
				await raceWithAbortSignal(operation, signal);
			} catch (error) {
				if (!signal.aborted) errors.set(provider.id, error instanceof Error ? error : new ModelsError("model_source", `Model refresh failed for ${provider.id}`, { cause: error }));
			} finally {
				if (this.refreshControllers.get(provider.id) === controller) this.refreshControllers.delete(provider.id);
			}
		}));
		try {
			await raceWithAbortSignal(refresh, callerSignal);
		} catch (error) {
			if (!callerSignal.aborted) throw error;
		}
		return {
			aborted: callerSignal.aborted,
			errors: new Map(errors)
		};
	}
	async resolveRefreshCredential(provider, stored, signal) {
		if (stored?.type === "oauth") {
			const oauth = provider.auth.oauth;
			if (!oauth) return void 0;
			if (Date.now() < stored.expires) return stored;
			if (signal.aborted) return void 0;
			return refreshStoredOAuthCredential(this.credentials, provider.id, oauth, (current) => Date.now() >= current.expires, signal);
		}
		const apiKey = provider.auth.apiKey;
		if (!apiKey) return void 0;
		const credential = stored?.type === "api_key" ? stored : void 0;
		const result = await apiKey.resolve({
			ctx: this.authContext,
			credential,
			signal
		});
		if (!result) return void 0;
		return {
			type: "api_key",
			key: result.auth.apiKey,
			env: result.env
		};
	}
	async readCredential(providerId, signal) {
		try {
			return await this.credentials.read(providerId, { signal });
		} catch (error) {
			throw new ModelsError("auth", `Credential store read failed for ${providerId}`, { cause: error });
		}
	}
	async checkProviderAuth(provider, credential, signal) {
		if (credential?.type === "oauth") return provider.auth.oauth ? {
			source: "OAuth",
			type: "oauth"
		} : void 0;
		const apiKey = provider.auth.apiKey;
		if (!apiKey) return void 0;
		if (apiKey.check) try {
			return await apiKey.check({
				ctx: this.authContext,
				credential: credential?.type === "api_key" ? credential : void 0,
				signal
			});
		} catch (error) {
			throw new ModelsError("auth", `API key auth check failed for provider ${provider.id}`, { cause: error });
		}
		const resolution = await resolveProviderAuth(provider, this.credentials, this.authContext, { signal });
		return resolution ? {
			source: resolution.source,
			type: "api_key"
		} : void 0;
	}
	checkAuth(providerId, options) {
		const signal = operationSignal(options?.signal);
		return raceWithAbortSignal((async () => {
			signal.throwIfAborted();
			const provider = this.providers.get(providerId);
			if (!provider) return void 0;
			return this.checkProviderAuth(provider, await this.readCredential(providerId, signal), signal);
		})(), signal);
	}
	async getAuthenticatedProviders(providerId, signal) {
		signal.throwIfAborted();
		const providers = providerId ? [this.providers.get(providerId)].filter((entry) => entry !== void 0) : this.getProviders();
		return (await Promise.all(providers.map(async (provider) => {
			const credential = await this.readCredential(provider.id, signal);
			return {
				provider,
				credential,
				auth: await this.checkProviderAuth(provider, credential, signal)
			};
		}))).filter((entry) => entry.auth !== void 0);
	}
	getAvailable(providerId, options) {
		const signal = operationSignal(options?.signal);
		return raceWithAbortSignal((async () => {
			return (await this.getAuthenticatedProviders(providerId, signal)).flatMap(({ provider, credential }) => {
				const models = provider.getModels();
				return provider.filterModels?.(models, credential) ?? models;
			});
		})(), signal);
	}
	async getAvailableOfType(type, providerId, options) {
		return (await this.getAllAvailable(providerId, options)).filter((model) => isModelType(model, type));
	}
	getAllAvailable(providerId, options) {
		const signal = operationSignal(options?.signal);
		return raceWithAbortSignal((async () => {
			return (await this.getAuthenticatedProviders(providerId, signal)).flatMap(({ provider, credential }) => {
				const models = provider.getAllModels?.() ?? provider.getModels();
				if (provider.filterAllModels) return provider.filterAllModels(models, credential);
				if (!provider.filterModels) return models;
				const availableChatIds = new Set(provider.filterModels(provider.getModels(), credential).map((model) => model.id));
				return models.filter((model) => !isModelType(model, "chat") || availableChatIds.has(model.id));
			});
		})(), signal);
	}
	async getAuth(providerOrModel, overrides) {
		const signal = operationSignal(overrides?.signal);
		const providerId = typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
		const provider = this.providers.get(providerId);
		if (!provider) return void 0;
		const result = await resolveProviderAuth(provider, this.credentials, this.authContext, {
			...overrides,
			signal
		});
		if (!result || typeof providerOrModel === "string" || !providerOrModel.headers) return result;
		return {
			...result,
			auth: {
				...result.auth,
				headers: mergeHeaders(result.auth.headers, providerOrModel.headers)
			}
		};
	}
	async login(providerId, type, interaction, options) {
		const signal = operationSignal(interaction.signal);
		signal.throwIfAborted();
		const provider = this.providers.get(providerId);
		if (!provider) throw new ModelsError("provider", `Unknown provider: ${providerId}`);
		const method = type === "oauth" ? provider.auth.oauth : provider.auth.apiKey;
		if (!method?.login) throw new ModelsError("auth", `${provider.name} does not support ${type} login`);
		const credential = await raceWithAbortSignal(method.login({
			...interaction,
			signal
		}, options), signal);
		let mutationStarted = false;
		let markMutationStarted;
		const started = new Promise((resolve) => {
			markMutationStarted = resolve;
		});
		const mutation = this.credentials.modify(providerId, async () => {
			mutationStarted = true;
			markMutationStarted?.();
			return credential;
		}, { signal });
		mutation.catch(() => {});
		try {
			await new Promise((resolve, reject) => {
				const onAbort = () => {
					if (!mutationStarted) reject(signal.reason);
				};
				signal.addEventListener("abort", onAbort, { once: true });
				Promise.race([started, mutation]).then(() => {
					signal.removeEventListener("abort", onAbort);
					resolve();
				}, (error) => {
					signal.removeEventListener("abort", onAbort);
					reject(error);
				});
				if (signal.aborted) onAbort();
			});
			await mutation;
		} catch (error) {
			signal.throwIfAborted();
			throw new ModelsError("auth", `Credential store modify failed for ${providerId}`, { cause: error });
		}
		return credential;
	}
	async logout(providerId, options) {
		const signal = operationSignal(options?.signal);
		signal.throwIfAborted();
		try {
			await this.credentials.delete(providerId, { signal });
		} catch (error) {
			signal.throwIfAborted();
			throw new ModelsError("auth", `Credential store delete failed for ${providerId}`, { cause: error });
		}
	}
	requireProvider(model) {
		const provider = this.providers.get(model.provider);
		if (!provider) throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
		return provider;
	}
	requireChatProvider(model) {
		assertChatModel(model);
		return this.requireProvider(model);
	}
	async applyAuth(model, options) {
		this.requireProvider(model);
		const resolution = await this.getAuth(model, {
			apiKey: options?.apiKey,
			env: options?.env,
			signal: options?.signal
		});
		if (!resolution) throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);
		const auth = resolution.auth;
		const apiKey = options?.apiKey ?? auth.apiKey;
		let headers = mergeHeaders(auth.headers, options?.headers);
		if (options?.transformHeaders) headers = await options.transformHeaders(headers ?? {});
		const env = resolution.env || options?.env ? {
			...resolution.env ?? {},
			...options?.env ?? {}
		} : void 0;
		const requestModel = auth.baseUrl ? {
			...model,
			baseUrl: auth.baseUrl
		} : model;
		const { transformHeaders: _transformHeaders, ...providerOptions } = options ?? {};
		return {
			requestModel,
			requestOptions: {
				...providerOptions,
				apiKey,
				headers,
				env
			}
		};
	}
	stream(model, context, options) {
		const transcript = normalizeContext(context);
		return lazyStream(model, async () => {
			const provider = this.requireChatProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.stream(requestModel, transcript, requestOptions);
		});
	}
	async complete(model, context, options) {
		return this.stream(model, context, options).result();
	}
	streamSimple(model, context, options) {
		const transcript = normalizeContext(context);
		return lazyStream(model, async () => {
			const provider = this.requireChatProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.streamSimple(requestModel, transcript, requestOptions);
		});
	}
	async completeSimple(model, context, options) {
		return this.streamSimple(model, context, options).result();
	}
	streamDeferred(model, handle, options) {
		return lazyStream(model, async () => {
			const provider = this.requireChatProvider(model);
			if (!provider.fetchDeferred) throw new ModelsError("provider", `Provider ${model.provider} does not support deferred responses`);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.fetchDeferred(requestModel, handle, requestOptions);
		});
	}
	async fetchDeferred(model, handle, options) {
		return this.streamDeferred(model, handle, options).result();
	}
	async cancelDeferred(model, handle, options) {
		const provider = this.requireChatProvider(model);
		if (!provider.cancelDeferred) throw new ModelsError("provider", `Provider ${model.provider} does not support deferred responses`);
		const { requestModel, requestOptions } = await this.applyAuth(model, options);
		await provider.cancelDeferred(requestModel, handle, requestOptions);
	}
	async generateImages(model, context, options) {
		try {
			assertImageModel(model);
			const provider = this.requireProvider(model);
			if (!provider.generateImages) throw new ModelsError("provider", `Provider ${model.provider} does not support image generation`);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return await provider.generateImages(requestModel, context, requestOptions);
		} catch (error) {
			return imageErrorResult(model, error, options?.signal?.aborted);
		}
	}
	async classify(model, context, options) {
		try {
			assertClassifierModel(model);
			assertClassifierInputSupported(model, context);
			const provider = this.requireProvider(model);
			if (!provider.classify) throw new ModelsError("provider", `Provider ${model.provider} does not support classification`);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return await provider.classify(requestModel, context, requestOptions);
		} catch (error) {
			return classifierErrorResult(model, error, options?.signal?.aborted);
		}
	}
};
function createModels(options) {
	return new ModelsImpl(options);
}
/**
* Builds a provider from parts. Built-in provider factories and models.json
* custom providers both go through this. A single `api` streams all chat
* models; an `api` map dispatches on `model.api`, and a model whose api has
* no entry produces a stream error. One-shot operation maps dispatch on
* `model.api` the same way. At least one concrete implementation across
* `api`/`images`/`classifiers` is required; empty maps are rejected.
*/
function createProvider(input) {
	const single = input.api && typeof input.api.stream === "function" ? input.api : void 0;
	const byApi = single || !input.api ? void 0 : input.api;
	const images = input.images;
	const classifiers = input.classifiers;
	const streams = single ? [single] : Object.values(byApi ?? {}).filter((entry) => entry !== void 0);
	const imageImplementations = Object.values(images ?? {}).filter((entry) => entry !== void 0);
	const classifierImplementations = Object.values(classifiers ?? {}).filter((entry) => entry !== void 0);
	if (streams.length === 0 && imageImplementations.length === 0 && classifierImplementations.length === 0) throw new Error(`Provider ${input.id}: at least one of "api", "images", or "classifiers" is required.`);
	const baselineModels = input.models;
	let dynamicModels = [];
	const fetchModels = input.fetchModels;
	const currentModels = () => {
		const merged = [...baselineModels];
		for (const model of dynamicModels) {
			const index = merged.findIndex((entry) => getModelType(entry) === getModelType(model) && entry.id === model.id);
			if (index >= 0) merged[index] = model;
			else merged.push(model);
		}
		return merged;
	};
	const apiFor = (model) => single ?? byApi?.[model.api];
	const dispatch = (model, run) => {
		const streams = apiFor(model);
		if (!streams) return lazyStream(model, async () => {
			throw new ModelsError("stream", `Provider ${input.id} has no API implementation for "${model.api}"`);
		});
		return run(streams);
	};
	const provider = {
		id: input.id,
		name: input.name ?? input.id,
		baseUrl: input.baseUrl,
		headers: input.headers,
		auth: input.auth,
		getModels: () => currentModels().filter((model) => isModelType(model, "chat")),
		getAllModels: currentModels,
		refreshModels: fetchModels ? async (context) => {
			if (context.stored) {
				const restored = context.stored.models.filter((model) => model.provider === input.id).map((model) => model);
				if (!await context.publish({ update: () => {
					dynamicModels = restored;
				} })) return;
			}
			if (!context.allowNetwork || context.signal.aborted) return;
			const fetched = await fetchModels(context);
			if (context.signal.aborted) return;
			const refreshed = fetched.filter(hasKnownModelType);
			await context.publish({
				persist: {
					models: refreshed,
					checkedAt: Date.now()
				},
				update: () => {
					dynamicModels = refreshed;
				}
			});
		} : void 0,
		filterModels: input.filterModels,
		filterAllModels: input.filterAllModels,
		stream: (model, context, options) => dispatch(model, (streams) => streams.stream(model, context, options)),
		streamSimple: (model, context, options) => dispatch(model, (streams) => streams.streamSimple(model, context, options))
	};
	if (streams.some((entry) => entry.fetchDeferred !== void 0)) provider.fetchDeferred = (model, handle, options) => lazyStream(model, async () => {
		const implementation = apiFor(model);
		if (!implementation?.fetchDeferred) throw new ModelsError("provider", `Provider ${input.id} does not support deferred responses for "${model.api}"`);
		return implementation.fetchDeferred(model, handle, options);
	});
	if (streams.some((entry) => entry.cancelDeferred !== void 0)) provider.cancelDeferred = async (model, handle, options) => {
		const implementation = apiFor(model);
		if (!implementation?.cancelDeferred) throw new ModelsError("provider", `Provider ${input.id} cannot cancel deferred responses for "${model.api}"`);
		await implementation.cancelDeferred(model, handle, options);
	};
	if (images && imageImplementations.length > 0) provider.generateImages = async (model, context, options) => {
		const implementation = images[model.api];
		if (!implementation) return imageErrorResult(model, new ModelsError("provider", `Provider ${input.id} has no image generation implementation for "${model.api}"`));
		return implementation.generateImages(model, context, options);
	};
	if (classifiers && classifierImplementations.length > 0) provider.classify = async (model, context, options) => {
		const implementation = classifiers[model.api];
		if (!implementation) return classifierErrorResult(model, new ModelsError("provider", `Provider ${input.id} has no classifier implementation for "${model.api}"`));
		return implementation.classify(model, context, options);
	};
	return provider;
}
function calculateCost(model, usage) {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let rates = model.cost;
	let matchedThreshold = -1;
	for (const tier of model.cost.tiers ?? []) if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
		rates = tier;
		matchedThreshold = tier.inputTokensAbove;
	}
	const longWrite = usage.cacheWrite1h ?? 0;
	const shortWrite = usage.cacheWrite - longWrite;
	usage.cost.input = rates.input / 1e6 * usage.input;
	usage.cost.output = rates.output / 1e6 * usage.output;
	usage.cost.cacheRead = rates.cacheRead / 1e6 * usage.cacheRead;
	usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1e6;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}
const EXTENDED_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function getSupportedThinkingLevels(model) {
	if (!model.reasoning) return ["off"];
	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== void 0;
		return true;
	});
}
function clampThinkingLevel(model, level) {
	const availableLevels = getSupportedThinkingLevels(model);
	if (availableLevels.includes(level)) return level;
	const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
	if (requestedIndex === -1) return availableLevels[0] ?? "off";
	for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	return availableLevels[0] ?? "off";
}
//#endregion
//#region node_modules/.pnpm/partial-json@0.1.7/node_modules/partial-json/dist/options.js
var require_options = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Sometimes you don't allow every type to be partially parsed.
	* For example, you may not want a partial number because it may increase its size gradually before it's complete.
	* In this case, you can use the `Allow` object to control what types you allow to be partially parsed.
	* @module
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Allow = exports.ALL = exports.COLLECTION = exports.ATOM = exports.SPECIAL = exports.INF = exports._INFINITY = exports.INFINITY = exports.NAN = exports.BOOL = exports.NULL = exports.OBJ = exports.ARR = exports.NUM = exports.STR = void 0;
	/**
	* allow partial strings like `"hello \u12` to be parsed as `"hello "`
	*/
	exports.STR = 1;
	/**
	* allow partial numbers like `123.` to be parsed as `123`
	*/
	exports.NUM = 2;
	/**
	* allow partial arrays like `[1, 2,` to be parsed as `[1, 2]`
	*/
	exports.ARR = 4;
	/**
	* allow partial objects like `{"a": 1, "b":` to be parsed as `{"a": 1}`
	*/
	exports.OBJ = 8;
	/**
	* allow `nu` to be parsed as `null`
	*/
	exports.NULL = 16;
	/**
	* allow `tr` to be parsed as `true`, and `fa` to be parsed as `false`
	*/
	exports.BOOL = 32;
	/**
	* allow `Na` to be parsed as `NaN`
	*/
	exports.NAN = 64;
	/**
	* allow `Inf` to be parsed as `Infinity`
	*/
	exports.INFINITY = 128;
	/**
	* allow `-Inf` to be parsed as `-Infinity`
	*/
	exports._INFINITY = 256;
	exports.INF = exports.INFINITY | exports._INFINITY;
	exports.SPECIAL = exports.NULL | exports.BOOL | exports.INF | exports.NAN;
	exports.ATOM = exports.STR | exports.NUM | exports.SPECIAL;
	exports.COLLECTION = exports.ARR | exports.OBJ;
	exports.ALL = exports.ATOM | exports.COLLECTION;
	/**
	* Control what types you allow to be partially parsed.
	* The default is to allow all types to be partially parsed, which in most casees is the best option.
	* @example
	* If you don't want to allow partial objects, you can use the following code:
	* ```ts
	* import { Allow, parse } from "partial-json";
	* parse(`[{"a": 1, "b": 2}, {"a": 3,`, Allow.ARR); // [ { a: 1, b: 2 } ]
	* ```
	* Or you can use `~` to disallow a type:
	* ```ts
	* parse(`[{"a": 1, "b": 2}, {"a": 3,`, ~Allow.OBJ); // [ { a: 1, b: 2 } ]
	* ```
	* @example
	* If you don't want to allow partial strings, you can use the following code:
	* ```ts
	* import { Allow, parse } from "partial-json";
	* parse(`["complete string", "incompl`, ~Allow.STR); // [ 'complete string' ]
	* ```
	*/
	exports.Allow = {
		STR: exports.STR,
		NUM: exports.NUM,
		ARR: exports.ARR,
		OBJ: exports.OBJ,
		NULL: exports.NULL,
		BOOL: exports.BOOL,
		NAN: exports.NAN,
		INFINITY: exports.INFINITY,
		_INFINITY: exports._INFINITY,
		INF: exports.INF,
		SPECIAL: exports.SPECIAL,
		ATOM: exports.ATOM,
		COLLECTION: exports.COLLECTION,
		ALL: exports.ALL
	};
	exports.default = exports.Allow;
}));
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/json-parse.js
var import_dist = (/* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __exportStar = exports && exports.__exportStar || function(m, exports$1) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$1, p)) __createBinding(exports$1, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Allow = exports.MalformedJSON = exports.PartialJSON = exports.parseJSON = exports.parse = void 0;
	const options_1 = require_options();
	Object.defineProperty(exports, "Allow", {
		enumerable: true,
		get: function() {
			return options_1.Allow;
		}
	});
	__exportStar(require_options(), exports);
	var PartialJSON = class extends Error {};
	exports.PartialJSON = PartialJSON;
	var MalformedJSON = class extends Error {};
	exports.MalformedJSON = MalformedJSON;
	/**
	* Parse incomplete JSON
	* @param {string} jsonString Partial JSON to be parsed
	* @param {number} allowPartial Specify what types are allowed to be partial, see {@link Allow} for details
	* @returns The parsed JSON
	* @throws {PartialJSON} If the JSON is incomplete (related to the `allow` parameter)
	* @throws {MalformedJSON} If the JSON is malformed
	*/
	function parseJSON(jsonString, allowPartial = options_1.Allow.ALL) {
		if (typeof jsonString !== "string") throw new TypeError(`expecting str, got ${typeof jsonString}`);
		if (!jsonString.trim()) throw new Error(`${jsonString} is empty`);
		return _parseJSON(jsonString.trim(), allowPartial);
	}
	exports.parseJSON = parseJSON;
	const _parseJSON = (jsonString, allow) => {
		const length = jsonString.length;
		let index = 0;
		const markPartialJSON = (msg) => {
			throw new PartialJSON(`${msg} at position ${index}`);
		};
		const throwMalformedError = (msg) => {
			throw new MalformedJSON(`${msg} at position ${index}`);
		};
		const parseAny = () => {
			skipBlank();
			if (index >= length) markPartialJSON("Unexpected end of input");
			if (jsonString[index] === "\"") return parseStr();
			if (jsonString[index] === "{") return parseObj();
			if (jsonString[index] === "[") return parseArr();
			if (jsonString.substring(index, index + 4) === "null" || options_1.Allow.NULL & allow && length - index < 4 && "null".startsWith(jsonString.substring(index))) {
				index += 4;
				return null;
			}
			if (jsonString.substring(index, index + 4) === "true" || options_1.Allow.BOOL & allow && length - index < 4 && "true".startsWith(jsonString.substring(index))) {
				index += 4;
				return true;
			}
			if (jsonString.substring(index, index + 5) === "false" || options_1.Allow.BOOL & allow && length - index < 5 && "false".startsWith(jsonString.substring(index))) {
				index += 5;
				return false;
			}
			if (jsonString.substring(index, index + 8) === "Infinity" || options_1.Allow.INFINITY & allow && length - index < 8 && "Infinity".startsWith(jsonString.substring(index))) {
				index += 8;
				return Infinity;
			}
			if (jsonString.substring(index, index + 9) === "-Infinity" || options_1.Allow._INFINITY & allow && 1 < length - index && length - index < 9 && "-Infinity".startsWith(jsonString.substring(index))) {
				index += 9;
				return -Infinity;
			}
			if (jsonString.substring(index, index + 3) === "NaN" || options_1.Allow.NAN & allow && length - index < 3 && "NaN".startsWith(jsonString.substring(index))) {
				index += 3;
				return NaN;
			}
			return parseNum();
		};
		const parseStr = () => {
			const start = index;
			let escape = false;
			index++;
			while (index < length && (jsonString[index] !== "\"" || escape && jsonString[index - 1] === "\\")) {
				escape = jsonString[index] === "\\" ? !escape : false;
				index++;
			}
			if (jsonString.charAt(index) == "\"") try {
				return JSON.parse(jsonString.substring(start, ++index - Number(escape)));
			} catch (e) {
				throwMalformedError(String(e));
			}
			else if (options_1.Allow.STR & allow) try {
				return JSON.parse(jsonString.substring(start, index - Number(escape)) + "\"");
			} catch (e) {
				return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("\\")) + "\"");
			}
			markPartialJSON("Unterminated string literal");
		};
		const parseObj = () => {
			index++;
			skipBlank();
			const obj = {};
			try {
				while (jsonString[index] !== "}") {
					skipBlank();
					if (index >= length && options_1.Allow.OBJ & allow) return obj;
					const key = parseStr();
					skipBlank();
					index++;
					try {
						obj[key] = parseAny();
					} catch (e) {
						if (options_1.Allow.OBJ & allow) return obj;
						else throw e;
					}
					skipBlank();
					if (jsonString[index] === ",") index++;
				}
			} catch (e) {
				if (options_1.Allow.OBJ & allow) return obj;
				else markPartialJSON("Expected '}' at end of object");
			}
			index++;
			return obj;
		};
		const parseArr = () => {
			index++;
			const arr = [];
			try {
				while (jsonString[index] !== "]") {
					arr.push(parseAny());
					skipBlank();
					if (jsonString[index] === ",") index++;
				}
			} catch (e) {
				if (options_1.Allow.ARR & allow) return arr;
				markPartialJSON("Expected ']' at end of array");
			}
			index++;
			return arr;
		};
		const parseNum = () => {
			if (index === 0) {
				if (jsonString === "-") throwMalformedError("Not sure what '-' is");
				try {
					return JSON.parse(jsonString);
				} catch (e) {
					if (options_1.Allow.NUM & allow) try {
						return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf("e")));
					} catch (e) {}
					throwMalformedError(String(e));
				}
			}
			const start = index;
			if (jsonString[index] === "-") index++;
			while (jsonString[index] && ",]}".indexOf(jsonString[index]) === -1) index++;
			if (index == length && !(options_1.Allow.NUM & allow)) markPartialJSON("Unterminated number literal");
			try {
				return JSON.parse(jsonString.substring(start, index));
			} catch (e) {
				if (jsonString.substring(start, index) === "-") markPartialJSON("Not sure what '-' is");
				try {
					return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("e")));
				} catch (e) {
					throwMalformedError(String(e));
				}
			}
		};
		const skipBlank = () => {
			while (index < length && " \n\r	".includes(jsonString[index])) index++;
		};
		return parseAny();
	};
	exports.parse = parseJSON;
})))();
const VALID_JSON_ESCAPES = /* @__PURE__ */ new Set([
	"\"",
	"\\",
	"/",
	"b",
	"f",
	"n",
	"r",
	"t",
	"u"
]);
function isControlCharacter(char) {
	const codePoint = char.codePointAt(0);
	return codePoint !== void 0 && codePoint >= 0 && codePoint <= 31;
}
function escapeControlCharacter(char) {
	switch (char) {
		case "\b": return "\\b";
		case "\f": return "\\f";
		case "\n": return "\\n";
		case "\r": return "\\r";
		case "	": return "\\t";
		default: return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
	}
}
/**
* Repairs malformed JSON string literals by:
* - escaping raw control characters inside strings
* - doubling backslashes before invalid escape characters
*/
function repairJson(json) {
	let repaired = "";
	let inString = false;
	for (let index = 0; index < json.length; index++) {
		const char = json[index];
		if (!inString) {
			repaired += char;
			if (char === "\"") inString = true;
			continue;
		}
		if (char === "\"") {
			repaired += char;
			inString = false;
			continue;
		}
		if (char === "\\") {
			const nextChar = json[index + 1];
			if (nextChar === void 0) {
				repaired += "\\\\";
				continue;
			}
			if (nextChar === "u") {
				const unicodeDigits = json.slice(index + 2, index + 6);
				if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
					repaired += `\\u${unicodeDigits}`;
					index += 5;
					continue;
				}
			}
			if (VALID_JSON_ESCAPES.has(nextChar)) {
				repaired += `\\${nextChar}`;
				index += 1;
				continue;
			}
			repaired += "\\\\";
			continue;
		}
		repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
	}
	return repaired;
}
function parseJsonWithRepair(json) {
	try {
		return JSON.parse(json);
	} catch (error) {
		const repairedJson = repairJson(json);
		if (repairedJson !== json) return JSON.parse(repairedJson);
		throw error;
	}
}
/**
* Attempts to parse potentially incomplete JSON during streaming.
* Always returns a valid object, even if the JSON is incomplete.
*
* @param partialJson The partial JSON string from streaming
* @returns Parsed object or empty object if parsing fails
*/
function parseStreamingJson(partialJson) {
	if (!partialJson || partialJson.trim() === "") return {};
	try {
		return parseJsonWithRepair(partialJson);
	} catch {
		try {
			return (0, import_dist.parse)(partialJson) ?? {};
		} catch {
			try {
				return (0, import_dist.parse)(repairJson(partialJson)) ?? {};
			} catch {
				return {};
			}
		}
	}
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/hash.js
/** Fast deterministic hash to shorten long strings */
function shortHash(str) {
	let h1 = 3735928559;
	let h2 = 1103547991;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
	h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/utils/sanitize-unicode.js
/**
* Removes unpaired Unicode surrogate characters from a string.
*
* Unpaired surrogates (high surrogates 0xD800-0xDBFF without matching low surrogates 0xDC00-0xDFFF,
* or vice versa) cause JSON serialization errors in many API providers.
*
* Valid emoji and other characters outside the Basic Multilingual Plane use properly paired
* surrogates and will NOT be affected by this function.
*
* @param text - The text to sanitize
* @returns The sanitized text with unpaired surrogates removed
*
* @example
* // Valid emoji (properly paired surrogates) are preserved
* sanitizeSurrogates("Hello 🙈 World") // => "Hello 🙈 World"
*
* // Unpaired high surrogate is removed
* const unpaired = String.fromCharCode(0xD83D); // high surrogate without low
* sanitizeSurrogates(`Text ${unpaired} here`) // => "Text  here"
*/
function sanitizeSurrogates(text) {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.js
var UnsupportedStrictJsonSchemaError = class extends Error {};
const UNSUPPORTED_STRICT_SCHEMA_KEYS = [
	"$ref",
	"$defs",
	"definitions",
	"allOf",
	"oneOf",
	"patternProperties",
	"dependentSchemas",
	"dependencies",
	"unevaluatedProperties",
	"propertyNames",
	"contains",
	"prefixItems",
	"not",
	"if",
	"then",
	"else"
];
function isJsonSchemaObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStructuredSchema(schema) {
	if (!isJsonSchemaObject(schema)) return false;
	const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
	return types.includes("object") || types.includes("array") || schema.properties !== void 0 || schema.items !== void 0;
}
function schemaAllowsNull(schema) {
	if (!isJsonSchemaObject(schema)) return false;
	if (schema.type === "null" || Array.isArray(schema.type) && schema.type.includes("null")) return true;
	if (schema.const === null || Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
	return Array.isArray(schema.anyOf) && schema.anyOf.some((variant) => schemaAllowsNull(variant));
}
function makeJsonSchemaNodeStrict(schema, isUnsupportedKeyword) {
	if (!isJsonSchemaObject(schema)) throw new UnsupportedStrictJsonSchemaError("boolean schemas are unsupported");
	for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) if (schema[key] !== void 0) throw new UnsupportedStrictJsonSchemaError(`${key} schemas are unsupported`);
	if (isUnsupportedKeyword) {
		for (const [key, value] of Object.entries(schema)) if (isUnsupportedKeyword(key, value)) throw new UnsupportedStrictJsonSchemaError(`${key}: ${JSON.stringify(value)} is unsupported`);
	}
	if (schema.anyOf !== void 0) {
		if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) throw new UnsupportedStrictJsonSchemaError("anyOf must contain at least one schema");
		for (const variant of schema.anyOf) {
			if (isStructuredSchema(variant)) throw new UnsupportedStrictJsonSchemaError("object and array unions are unsupported");
			makeJsonSchemaNodeStrict(variant, isUnsupportedKeyword);
		}
	}
	if (schema.items !== void 0) {
		if (Array.isArray(schema.items)) throw new UnsupportedStrictJsonSchemaError("tuple schemas are unsupported");
		makeJsonSchemaNodeStrict(schema.items, isUnsupportedKeyword);
	}
	const isObjectSchema = schema.type === "object";
	if (schema.properties !== void 0 && !isObjectSchema) throw new UnsupportedStrictJsonSchemaError("properties require type object");
	if (!isObjectSchema) return;
	if (schema.additionalProperties !== void 0 && schema.additionalProperties !== false) throw new UnsupportedStrictJsonSchemaError("schema-valued or true additionalProperties is unsupported");
	if (schema.properties !== void 0 && !isJsonSchemaObject(schema.properties)) throw new UnsupportedStrictJsonSchemaError("object properties must be a schema map");
	if (schema.required !== void 0 && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))) throw new UnsupportedStrictJsonSchemaError("object required must be a string array");
	const properties = schema.properties ?? {};
	const propertyNames = Object.keys(properties);
	const required = new Set(Array.isArray(schema.required) ? schema.required : []);
	if ([...required].some((key) => !propertyNames.includes(key))) throw new UnsupportedStrictJsonSchemaError("required contains an unknown property");
	for (const [key, property] of Object.entries(properties)) {
		makeJsonSchemaNodeStrict(property, isUnsupportedKeyword);
		if (!required.has(key) && !schemaAllowsNull(property)) properties[key] = { anyOf: [property, { type: "null" }] };
	}
	schema.required = propertyNames;
	schema.additionalProperties = false;
}
/** Convert a tool schema to the strict subset expected by provider constrained sampling. */
function makeStrictJsonSchema(schema, isUnsupportedKeyword) {
	const cloned = structuredClone(schema);
	if (!isJsonSchemaObject(cloned)) throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
	makeJsonSchemaNodeStrict(cloned, isUnsupportedKeyword);
	if (cloned.type !== "object") throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
	return cloned;
}
function getJsonSchemaToolParameters(tool, strict) {
	return strict === true ? makeStrictJsonSchema(tool.parameters) : tool.parameters;
}
function getGrammarToolInput(toolName, arguments_, inputProperty) {
	const input = arguments_[inputProperty];
	if (typeof input !== "string") throw new Error(`Grammar tool call "${toolName}" requires argument "${inputProperty}" to be a string.`);
	return input;
}
function appendGrammarToolInputJsonDelta(buffer, inputProperty, nextInput, close) {
	if (buffer.closed) {
		if (close && nextInput === buffer.input) return void 0;
		throw new Error(`grammar tool input for property "${inputProperty}" changed after it was closed`);
	}
	if (!nextInput.startsWith(buffer.input)) throw new Error(`grammar tool input for property "${inputProperty}" changed non-monotonically`);
	const inputDelta = nextInput.slice(buffer.input.length);
	if (!close && inputDelta.length === 0) return void 0;
	let delta = "";
	if (!buffer.started) {
		delta += `{${JSON.stringify(inputProperty)}:"`;
		buffer.started = true;
	}
	delta += JSON.stringify(inputDelta).slice(1, -1);
	buffer.input = nextInput;
	if (close) {
		delta += "\"}";
		buffer.closed = true;
	}
	return delta;
}
function inferGrammarInputProperty(tool) {
	const schema = tool.parameters;
	if (schema.type !== "object") throw new Error("grammar constrained sampling requires an object parameter schema");
	if (!Array.isArray(schema.required) || schema.required.length !== 1 || typeof schema.required[0] !== "string") throw new Error("grammar constrained sampling requires exactly one required string property");
	const inputProperty = schema.required[0];
	if (!schema.properties?.[inputProperty]) throw new Error(`grammar constrained sampling requires a properties entry for ${inputProperty}`);
	if (schema.properties[inputProperty]?.type !== "string") throw new Error(`grammar constrained sampling property ${inputProperty} must have type string`);
	return inputProperty;
}
/**
* Decide whether a JSON-schema tool is sent in strict mode. `isUnsupportedKeyword` lets a provider
* reject extra keywords its strict mode does not accept, so "prefer" tools fall back to non-strict.
*/
function resolveJsonSchemaStrictSampling(tool, supportsStrictMode, isUnsupportedKeyword) {
	const config = tool.constrainedSampling;
	if (!config || config.type !== "json_schema") return void 0;
	if (supportsStrictMode) try {
		makeStrictJsonSchema(tool.parameters, isUnsupportedKeyword);
		return true;
	} catch (error) {
		if (!(error instanceof UnsupportedStrictJsonSchemaError)) throw error;
		if (config.strict !== "require") return void 0;
		throw new Error(`Tool "${tool.name}" requires JSON-schema constrained sampling, but ${error.message}.`);
	}
	if (config.strict === "require") throw new Error(`Tool "${tool.name}" requires JSON-schema constrained sampling, but strict tools are unsupported.`);
}
function resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools) {
	const config = tool.constrainedSampling;
	if (!config || config.type !== "grammar") return;
	if (!supportsOpenAIGrammarTools) return;
	const larkDefinition = config.variants.openai_lark;
	const regexDefinition = config.variants.openai_regex;
	const hasLarkDefinition = typeof larkDefinition === "string" && larkDefinition.trim().length > 0;
	const hasRegexDefinition = typeof regexDefinition === "string" && regexDefinition.trim().length > 0;
	if (!hasLarkDefinition && !hasRegexDefinition) throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: no supported grammar variant was provided.`);
	try {
		return {
			format: hasLarkDefinition ? "lark" : "regex",
			definition: hasLarkDefinition ? larkDefinition : regexDefinition,
			inputProperty: inferGrammarInputProperty(tool)
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: ${message}.`);
	}
}
function createGrammarToolInputProperties(tools, supportsOpenAIGrammarTools) {
	const properties = /* @__PURE__ */ new Map();
	for (const tool of tools ?? []) {
		const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
		if (grammar) properties.set(tool.name, grammar.inputProperty);
	}
	return properties;
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js
const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";
function replaceImagesWithPlaceholder(content, placeholder) {
	const result = [];
	let previousWasPlaceholder = false;
	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) result.push({
				type: "text",
				text: placeholder
			});
			previousWasPlaceholder = true;
			continue;
		}
		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}
	return result;
}
function downgradeUnsupportedImages(messages, model) {
	if (model.input.includes("image")) return messages;
	return messages.map((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) return {
			...msg,
			content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER)
		};
		if (msg.role === "toolResult") return {
			...msg,
			content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER)
		};
		return msg;
	});
}
/**
* Normalize tool call ID for cross-provider compatibility.
* OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
* Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
*/
function transformMessages(messages, model, normalizeToolCallId) {
	const toolCallIdMap = /* @__PURE__ */ new Map();
	const transformed = downgradeUnsupportedImages(messages.map((msg) => msg.content == null ? {
		...msg,
		content: []
	} : msg), model).map((msg) => {
		if (msg.role === "system" || msg.role === "user") return msg;
		if (msg.role === "toolResult") {
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) return {
				...msg,
				toolCallId: normalizedId
			};
			return msg;
		}
		if (msg.role === "assistant") {
			const assistantMsg = msg;
			const isSameModel = assistantMsg.provider === model.provider && assistantMsg.api === model.api && assistantMsg.model === model.id;
			const transformedContent = assistantMsg.content.flatMap((block) => {
				if (block.type === "thinking") {
					if (block.redacted) return isSameModel ? block : [];
					if (isSameModel && block.thinkingSignature) return block;
					if (!block.thinking || block.thinking.trim() === "") return [];
					if (isSameModel) return block;
					return {
						type: "text",
						text: block.thinking
					};
				}
				if (block.type === "text") {
					if (isSameModel) return block;
					return {
						type: "text",
						text: block.text
					};
				}
				if (block.type === "toolCall") {
					const toolCall = block;
					let normalizedToolCall = toolCall;
					if (!isSameModel && toolCall.thoughtSignature) {
						normalizedToolCall = { ...toolCall };
						delete normalizedToolCall.thoughtSignature;
					}
					if (!isSameModel && normalizeToolCallId) {
						const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
						if (normalizedId !== toolCall.id) {
							toolCallIdMap.set(toolCall.id, normalizedId);
							normalizedToolCall = {
								...normalizedToolCall,
								id: normalizedId
							};
						}
					}
					return normalizedToolCall;
				}
				return block;
			});
			return {
				...assistantMsg,
				content: transformedContent
			};
		}
		return msg;
	});
	const result = [];
	let pendingToolCalls = [];
	let existingToolResultIds = /* @__PURE__ */ new Set();
	const heldSystemMessages = [];
	const closePendingToolCalls = () => {
		if (pendingToolCalls.length > 0) {
			for (const tc of pendingToolCalls) if (!existingToolResultIds.has(tc.id)) result.push({
				role: "toolResult",
				toolCallId: tc.id,
				toolName: tc.name,
				content: [{
					type: "text",
					text: "No result provided"
				}],
				isError: true,
				timestamp: Date.now()
			});
			pendingToolCalls = [];
			existingToolResultIds = /* @__PURE__ */ new Set();
		}
		result.push(...heldSystemMessages);
		heldSystemMessages.length = 0;
	};
	for (let i = 0; i < transformed.length; i++) {
		const msg = transformed[i];
		if (msg.role === "assistant") {
			closePendingToolCalls();
			const assistantMsg = msg;
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") continue;
			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = /* @__PURE__ */ new Set();
			}
			result.push(msg);
		} else if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === "system") {
			if (pendingToolCalls.length > 0) heldSystemMessages.push(msg);
			else result.push(msg);
		} else if (msg.role === "user") {
			closePendingToolCalls();
			result.push(msg);
		} else result.push(msg);
	}
	closePendingToolCalls();
	return result;
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_ebe77346f275513ef308ff2607b62b41/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js
function encodeTextSignatureV1(id, phase) {
	const payload = {
		v: 1,
		id
	};
	if (phase) payload.phase = phase;
	return JSON.stringify(payload);
}
function parseTextSignature(signature) {
	if (!signature) return void 0;
	if (signature.startsWith("{")) try {
		const parsed = JSON.parse(signature);
		if (parsed.v === 1 && typeof parsed.id === "string") {
			if (parsed.phase === "commentary" || parsed.phase === "final_answer") return {
				id: parsed.id,
				phase: parsed.phase
			};
			return { id: parsed.id };
		}
	} catch {}
	return { id: signature };
}
function convertToolResultOutput(model, content) {
	const textResult = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
	const images = content.filter((c) => c.type === "image");
	const hasText = textResult.length > 0;
	if (images.length === 0 || !model.input.includes("image")) return sanitizeSurrogates(hasText ? textResult : images.length > 0 ? "(see attached image)" : "(no tool output)");
	const output = [];
	if (hasText) output.push({
		type: "input_text",
		text: sanitizeSurrogates(textResult)
	});
	for (const image of images) output.push({
		type: "input_image",
		detail: "auto",
		image_url: `data:${image.mimeType};base64,${image.data}`
	});
	return output;
}
function convertResponsesMessages(model, context, allowedToolCallProviders, options) {
	const normalizedContext = resolveTranscript(context, options?.supportsMidConvoSystemMessages);
	const messages = [];
	const normalizeIdPart = (part) => {
		const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
		return (sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized).replace(/_+$/, "");
	};
	const buildForeignResponsesItemId = (itemId) => {
		const normalized = `fc_${shortHash(itemId)}`;
		return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
	};
	const normalizeToolCallId = (id, _targetModel, source) => {
		if (!allowedToolCallProviders.has(model.provider)) return normalizeIdPart(id);
		if (!id.includes("|")) return normalizeIdPart(id);
		const [callId, itemId] = id.split("|");
		const normalizedCallId = normalizeIdPart(callId);
		let normalizedItemId = source.provider !== model.provider || source.api !== model.api ? buildForeignResponsesItemId(itemId) : normalizeIdPart(itemId);
		if (!normalizedItemId.startsWith("fc_")) normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
		return `${normalizedCallId}|${normalizedItemId}`;
	};
	const transformedMessages = transformMessages(normalizedContext.messages, model, normalizeToolCallId);
	const transcriptTools = resolveTranscriptTools(normalizedContext.messages, (options?.supportsAdditionalTools ?? false) || (options?.supportsToolSearch ?? false));
	const appendSystemToolAdditions = (message, seed) => {
		const tools = transcriptTools.anchorsAdditions ? message.toolsAdded ?? [] : [];
		if (tools.length === 0) return;
		if (options?.supportsAdditionalTools) {
			messages.push({
				type: "additional_tools",
				role: "developer",
				tools: convertResponsesTools(tools, options.toolOptions)
			});
			return;
		}
		if (!options?.supportsToolSearch) return;
		const names = tools.map((tool) => tool.name);
		const callId = `pi_tool_load_${shortHash(`${seed}:${names.join(",")}`)}`;
		messages.push({
			type: "tool_search_call",
			call_id: callId,
			execution: "client",
			status: "completed",
			arguments: {
				query: names.join(" "),
				limit: names.length
			}
		});
		messages.push({
			type: "tool_search_output",
			call_id: callId,
			execution: "client",
			status: "completed",
			tools: convertResponsesTools(tools, {
				...options.toolOptions,
				toolSearchResult: true
			})
		});
	};
	const includeInitialSystemMessage = options?.includeSystemPrompt ?? true;
	const compat = model.compat;
	const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";
	let msgIndex = 0;
	let sourceIndex = 0;
	for (const msg of transformedMessages) {
		const isLeadingSystemMessage = sourceIndex++ === 0 && msg.role === "system";
		if (msg.role === "system") {
			if (!isLeadingSystemMessage) appendSystemToolAdditions(msg, `system:${msgIndex}`);
			if (!isLeadingSystemMessage || includeInitialSystemMessage) {
				const text = isLeadingSystemMessage ? getSystemMessageText(msg) : renderSystemMessageUpdate(msg);
				if (text.length > 0) messages.push({
					role: instructionRole,
					content: sanitizeSurrogates(text)
				});
			}
		} else if (msg.role === "user") {
			if (typeof msg.content === "string") messages.push({
				role: "user",
				content: [{
					type: "input_text",
					text: sanitizeSurrogates(msg.content)
				}]
			});
			else {
				const content = msg.content.map((item) => {
					if (item.type === "text") return {
						type: "input_text",
						text: sanitizeSurrogates(item.text)
					};
					return {
						type: "input_image",
						detail: "auto",
						image_url: `data:${item.mimeType};base64,${item.data}`
					};
				});
				if (content.length === 0) continue;
				messages.push({
					role: "user",
					content
				});
			}
		} else if (msg.role === "assistant") {
			const output = [];
			const assistantMsg = msg;
			const isSameProviderAndApi = assistantMsg.provider === model.provider && assistantMsg.api === model.api;
			const isSameModel = isSameProviderAndApi && assistantMsg.model === model.id;
			const isDifferentModel = isSameProviderAndApi && assistantMsg.model !== model.id;
			let textBlockIndex = 0;
			for (const block of msg.content) if (block.type === "thinking") {
				if (block.thinkingSignature) {
					const reasoningItem = JSON.parse(block.thinkingSignature);
					output.push(reasoningItem);
				}
			} else if (block.type === "text") {
				const textBlock = block;
				const parsedSignature = parseTextSignature(textBlock.textSignature);
				const fallbackMessageId = textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;
				textBlockIndex++;
				let msgId = parsedSignature?.id;
				if (!msgId) msgId = fallbackMessageId;
				else if (msgId.length > 64) msgId = `msg_${shortHash(msgId)}`;
				output.push({
					type: "message",
					role: "assistant",
					content: [{
						type: "output_text",
						text: sanitizeSurrogates(textBlock.text),
						annotations: []
					}],
					status: "completed",
					id: msgId,
					phase: parsedSignature?.phase
				});
			} else if (block.type === "toolCall") {
				const toolCall = block;
				const [callId, itemIdRaw] = toolCall.id.split("|");
				const customInputProperty = options?.grammarToolInputProperties?.get(toolCall.name);
				let itemId = itemIdRaw;
				const itemIdPrefix = customInputProperty === void 0 ? "fc_" : "ctc_";
				if (isDifferentModel || !itemId?.startsWith(itemIdPrefix)) itemId = void 0;
				if (customInputProperty !== void 0) output.push({
					type: "custom_tool_call",
					id: itemId,
					call_id: callId,
					name: toolCall.name,
					input: sanitizeSurrogates(getGrammarToolInput(toolCall.name, toolCall.arguments, customInputProperty)),
					...isSameModel && toolCall.namespace !== void 0 ? { namespace: toolCall.namespace } : {}
				});
				else output.push({
					type: "function_call",
					id: itemId,
					call_id: callId,
					name: toolCall.name,
					arguments: JSON.stringify(toolCall.arguments),
					...isSameModel && toolCall.namespace !== void 0 ? { namespace: toolCall.namespace } : {}
				});
			}
			if (output.length === 0) continue;
			messages.push(...output);
		} else if (msg.role === "toolResult") {
			const [callId] = msg.toolCallId.split("|");
			const output = convertToolResultOutput(model, msg.content);
			if (options?.grammarToolInputProperties?.has(msg.toolName)) messages.push({
				type: "custom_tool_call_output",
				call_id: callId,
				output
			});
			else messages.push({
				type: "function_call_output",
				call_id: callId,
				output
			});
		}
		if (!isLeadingSystemMessage) msgIndex++;
	}
	return messages;
}
function convertResponsesTools(tools, options) {
	const defaultStrict = options?.strict === void 0 ? false : options.strict;
	const supportsStrictMode = options?.supportsStrictMode ?? true;
	const supportsOpenAIGrammarTools = options?.supportsOpenAIGrammarTools ?? false;
	return tools.map((tool) => {
		const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
		if (grammar) return {
			type: "custom",
			name: tool.name,
			description: tool.description,
			format: {
				type: "grammar",
				syntax: grammar.format,
				definition: grammar.definition
			},
			...options?.toolSearchResult ? { defer_loading: true } : {}
		};
		const strict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode) ?? defaultStrict;
		const functionTool = {
			type: "function",
			name: tool.name,
			description: tool.description,
			parameters: getJsonSchemaToolParameters(tool, strict === true),
			...options?.toolSearchResult ? { defer_loading: true } : {}
		};
		if (supportsStrictMode) functionTool.strict = strict;
		return functionTool;
	});
}
function getCustomToolCallInput(block) {
	const property = block.customInput?.property;
	if (property === void 0) return "";
	const value = block.arguments[property];
	return typeof value === "string" ? value : "";
}
function appendCustomToolCallInput(block, nextInput, close) {
	const customInput = block.customInput;
	if (!customInput) return void 0;
	const delta = appendGrammarToolInputJsonDelta(customInput.jsonBuffer, customInput.property, nextInput, close);
	block.arguments = { [customInput.property]: nextInput };
	return delta;
}
async function processResponsesStream(openaiStream, output, stream, model, options) {
	let sawTerminalResponseEvent = false;
	const outputSlots = /* @__PURE__ */ new Map();
	const reasoningBlocksById = /* @__PURE__ */ new Map();
	const applyMessagePhaseStopReason = (item) => {
		if (item.type === "message" && item.phase === "final_answer") output.stopReason = "stop";
	};
	const getSlot = (outputIndex, type) => {
		const slot = outputSlots.get(outputIndex);
		return slot?.type === type ? slot : void 0;
	};
	const pushToolCallDelta = (slot, delta) => {
		if (delta === void 0) return;
		stream.push({
			type: "toolcall_delta",
			contentIndex: slot.contentIndex,
			delta,
			partial: output
		});
	};
	const createSlot = (outputIndex, item) => {
		if (item.type === "reasoning") {
			const block = {
				type: "thinking",
				thinking: ""
			};
			output.content.push(block);
			const slot = {
				type: "thinking",
				block,
				contentIndex: output.content.length - 1
			};
			outputSlots.set(outputIndex, slot);
			stream.push({
				type: "thinking_start",
				contentIndex: slot.contentIndex,
				partial: output
			});
			return slot;
		}
		if (item.type === "message") {
			applyMessagePhaseStopReason(item);
			const block = {
				type: "text",
				text: ""
			};
			output.content.push(block);
			const slot = {
				type: "text",
				block,
				contentIndex: output.content.length - 1
			};
			outputSlots.set(outputIndex, slot);
			stream.push({
				type: "text_start",
				contentIndex: slot.contentIndex,
				partial: output
			});
			return slot;
		}
		if (item.type === "function_call") {
			const block = {
				type: "toolCall",
				id: `${item.call_id}|${item.id}`,
				name: item.name,
				arguments: {},
				...item.namespace !== void 0 ? { namespace: item.namespace } : {},
				partialJson: item.arguments || ""
			};
			output.content.push(block);
			const slot = {
				type: "toolCall",
				block,
				contentIndex: output.content.length - 1
			};
			outputSlots.set(outputIndex, slot);
			stream.push({
				type: "toolcall_start",
				contentIndex: slot.contentIndex,
				partial: output
			});
			return slot;
		}
		if (item.type === "custom_tool_call") {
			const inputProperty = options?.grammarToolInputProperties?.get(item.name) ?? "input";
			const input = item.input || "";
			const block = {
				type: "toolCall",
				id: `${item.call_id}|${item.id}`,
				name: item.name,
				arguments: { [inputProperty]: input },
				...item.namespace !== void 0 ? { namespace: item.namespace } : {},
				customInput: {
					property: inputProperty,
					jsonBuffer: {
						input: "",
						started: false,
						closed: false
					}
				}
			};
			output.content.push(block);
			const slot = {
				type: "toolCall",
				block,
				contentIndex: output.content.length - 1
			};
			outputSlots.set(outputIndex, slot);
			stream.push({
				type: "toolcall_start",
				contentIndex: slot.contentIndex,
				partial: output
			});
			return slot;
		}
	};
	const getOrCreateSlot = (outputIndex, item) => {
		return outputSlots.get(outputIndex) ?? createSlot(outputIndex, item);
	};
	const backfillReasoningSignatures = (responseOutput) => {
		for (const item of responseOutput) {
			if (item.type !== "reasoning" || !item.encrypted_content) continue;
			const block = reasoningBlocksById.get(item.id);
			if (!block?.thinkingSignature) continue;
			const storedItem = JSON.parse(block.thinkingSignature);
			if (storedItem.encrypted_content) continue;
			block.thinkingSignature = JSON.stringify({
				...storedItem,
				encrypted_content: item.encrypted_content
			});
		}
	};
	const finalizeResponse = (response) => {
		sawTerminalResponseEvent = true;
		backfillReasoningSignatures(response.output ?? []);
		if (response?.id) output.responseId = response.id;
		if (response?.usage) {
			const inputDetails = response.usage.input_tokens_details;
			const cachedTokens = inputDetails?.cached_tokens || 0;
			const cacheWriteTokens = inputDetails?.cache_write_tokens || 0;
			output.usage = {
				input: Math.max(0, (response.usage.input_tokens || 0) - cachedTokens - cacheWriteTokens),
				output: response.usage.output_tokens || 0,
				cacheRead: cachedTokens,
				cacheWrite: cacheWriteTokens,
				reasoning: response.usage.output_tokens_details?.reasoning_tokens || 0,
				totalTokens: response.usage.total_tokens || 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0
				}
			};
		}
		calculateCost(model, output.usage);
		if (options?.applyServiceTierPricing) {
			const serviceTier = options.resolveServiceTier ? options.resolveServiceTier(response?.service_tier, options.serviceTier) : response?.service_tier ?? options.serviceTier;
			options.applyServiceTierPricing(output.usage, serviceTier);
		}
		const status = response?.status;
		const incompleteDetails = response?.incomplete_details;
		const incompleteReason = typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : void 0;
		output.rawStopReason = incompleteReason ? `${status}.${incompleteReason}` : status;
		const mappedStop = mapStopReason(status, incompleteReason);
		output.stopReason = mappedStop.stopReason;
		if (mappedStop.errorMessage === void 0) delete output.errorMessage;
		else output.errorMessage = mappedStop.errorMessage;
		if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") output.stopReason = "toolUse";
	};
	for await (const event of openaiStream) {
		await options?.onProviderStreamEvent?.(event, model);
		if (event.type === "response.created") output.responseId = event.response.id;
		else if (event.type === "response.output_item.added") createSlot(event.output_index, event.item);
		else if (event.type === "response.reasoning_summary_text.delta") {
			const slot = getSlot(event.output_index, "thinking");
			if (!slot) continue;
			slot.block.thinking += event.delta;
			stream.push({
				type: "thinking_delta",
				contentIndex: slot.contentIndex,
				delta: event.delta,
				partial: output
			});
		} else if (event.type === "response.reasoning_summary_part.done") {
			const slot = getSlot(event.output_index, "thinking");
			if (!slot) continue;
			slot.block.thinking += "\n\n";
			stream.push({
				type: "thinking_delta",
				contentIndex: slot.contentIndex,
				delta: "\n\n",
				partial: output
			});
		} else if (event.type === "response.reasoning_text.delta") {
			const slot = getSlot(event.output_index, "thinking");
			if (!slot) continue;
			slot.block.thinking += event.delta;
			stream.push({
				type: "thinking_delta",
				contentIndex: slot.contentIndex,
				delta: event.delta,
				partial: output
			});
		} else if (event.type === "response.output_text.delta") {
			const slot = getSlot(event.output_index, "text");
			if (!slot) continue;
			slot.block.text += event.delta;
			stream.push({
				type: "text_delta",
				contentIndex: slot.contentIndex,
				delta: event.delta,
				partial: output
			});
		} else if (event.type === "response.refusal.delta") {
			const slot = getSlot(event.output_index, "text");
			if (!slot) continue;
			slot.block.text += event.delta;
			stream.push({
				type: "text_delta",
				contentIndex: slot.contentIndex,
				delta: event.delta,
				partial: output
			});
		} else if (event.type === "response.function_call_arguments.delta") {
			const slot = getSlot(event.output_index, "toolCall");
			if (!slot || slot.block.partialJson === void 0) continue;
			slot.block.partialJson += event.delta;
			slot.block.arguments = parseStreamingJson(slot.block.partialJson);
			pushToolCallDelta(slot, event.delta);
		} else if (event.type === "response.function_call_arguments.done") {
			const slot = getSlot(event.output_index, "toolCall");
			if (!slot || slot.block.partialJson === void 0) continue;
			const previousPartialJson = slot.block.partialJson;
			slot.block.partialJson = event.arguments;
			slot.block.arguments = parseStreamingJson(slot.block.partialJson);
			if (event.arguments.startsWith(previousPartialJson)) {
				const delta = event.arguments.slice(previousPartialJson.length);
				if (delta.length > 0) pushToolCallDelta(slot, delta);
			}
		} else if (event.type === "response.custom_tool_call_input.delta") {
			const slot = getSlot(event.output_index, "toolCall");
			if (!slot || !slot.block.customInput) continue;
			pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, getCustomToolCallInput(slot.block) + event.delta, false));
		} else if (event.type === "response.custom_tool_call_input.done") {
			const slot = getSlot(event.output_index, "toolCall");
			if (!slot || !slot.block.customInput) continue;
			pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, event.input, true));
		} else if (event.type === "response.output_item.done") {
			const item = event.item;
			applyMessagePhaseStopReason(item);
			const slot = getOrCreateSlot(event.output_index, item);
			if (item.type === "reasoning" && slot?.type === "thinking") {
				const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
				const contentText = item.content?.map((c) => c.text).join("\n\n") || "";
				slot.block.thinking = summaryText || contentText || slot.block.thinking;
				slot.block.thinkingSignature = JSON.stringify(item);
				reasoningBlocksById.set(item.id, slot.block);
				stream.push({
					type: "thinking_end",
					contentIndex: slot.contentIndex,
					content: slot.block.thinking,
					partial: output
				});
				outputSlots.delete(event.output_index);
			} else if (item.type === "message" && slot?.type === "text") {
				slot.block.text = item.content?.map((c) => c.type === "output_text" ? c.text : c.refusal).join("") || "";
				slot.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? void 0);
				stream.push({
					type: "text_end",
					contentIndex: slot.contentIndex,
					content: slot.block.text,
					partial: output
				});
				outputSlots.delete(event.output_index);
			} else if (item.type === "function_call" && slot?.type === "toolCall" && slot.block.partialJson !== void 0) {
				slot.block.arguments = parseStreamingJson(item.arguments || slot.block.partialJson || "{}");
				if (item.namespace !== void 0) slot.block.namespace = item.namespace;
				delete slot.block.partialJson;
				stream.push({
					type: "toolcall_end",
					contentIndex: slot.contentIndex,
					toolCall: slot.block,
					partial: output
				});
				outputSlots.delete(event.output_index);
			} else if (item.type === "custom_tool_call" && slot?.type === "toolCall" && slot.block.customInput) {
				pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, item.input ?? getCustomToolCallInput(slot.block), true));
				if (item.namespace !== void 0) slot.block.namespace = item.namespace;
				delete slot.block.customInput;
				stream.push({
					type: "toolcall_end",
					contentIndex: slot.contentIndex,
					toolCall: slot.block,
					partial: output
				});
				outputSlots.delete(event.output_index);
			}
		} else if (event.type === "response.completed" || event.type === "response.incomplete") finalizeResponse(event.response);
		else if (event.type === "error") throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
		else if (event.type === "response.failed") {
			sawTerminalResponseEvent = true;
			output.rawStopReason = event.response?.status;
			const error = event.response?.error;
			const details = event.response?.incomplete_details;
			const msg = error ? `${error.code || "unknown"}: ${error.message || "no message"}` : details?.reason ? `incomplete: ${details.reason}` : "Unknown error (no error details in response)";
			throw new Error(msg);
		}
	}
	if (!sawTerminalResponseEvent) throw new Error("OpenAI Responses stream ended before a terminal response event");
	if (output.stopReason === "toolUse") for (const block of output.content) {
		if (block.type !== "toolCall") continue;
		const toolCall = block;
		if (toolCall.partialJson !== void 0 || toolCall.customInput !== void 0) throw new Error(`OpenAI Responses stream completed with an unfinished tool call: ${toolCall.name} (${toolCall.id})`);
	}
}
function mapStopReason(status, incompleteReason) {
	if (!status) return { stopReason: "stop" };
	switch (status) {
		case "completed": return { stopReason: "stop" };
		case "incomplete":
			if (incompleteReason === "max_output_tokens") return { stopReason: "length" };
			return {
				stopReason: "error",
				errorMessage: incompleteReason ? `Response incomplete: ${incompleteReason}` : "Response incomplete without a provider reason"
			};
		case "failed":
		case "cancelled": return { stopReason: "error" };
		case "in_progress":
		case "queued": return { stopReason: "stop" };
		default: throw new Error(`Unhandled stop reason: ${status}`);
	}
}
//#endregion
export { AssistantMessageEventStream as C, lazyApi as S, __require as T, appendAssistantMessageDiagnostic as _, clampThinkingLevel as a, InMemoryCredentialStore as b, getCurrentSystemPrompt as c, getInitialSystemMessage as d, normalizeContext as f, ModelsError as g, getSystemMessageText as h, createGrammarToolInputProperties as i, getCurrentTools as l, resolveTranscriptTools as m, convertResponsesTools as n, createModels as o, resolveTranscript as p, processResponsesStream as r, createProvider as s, convertResponsesMessages as t, getDeclaredTools as u, createAssistantMessageDiagnostic as v, createAssistantMessageEventStream as w, defaultProviderAuthContext as x, formatThrownValue as y };
