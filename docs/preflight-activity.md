# Bounded bili preflight activity

English | [中文](preflight-activity.zh.md)

This source change addresses [#340](https://github.com/franksong2702/dsh-codex-connect/issues/340): a bili proxy may spend longer than the ordinary five-minute stream idle interval compressing a request while sending `: bili-preflight` SSE comments. Comments are not model output. The integration remains disabled unless the operator explicitly trusts one proxy origin and supplies a finite total budget. Published Alpha 5 is immutable and does not contain this change.

## Configuration

Add startup configuration to the existing plugin entry in the effective profile. Replace the example origin with the credential-free HTTP(S) proxy actually used by this plugin. `preflightActivity` is not a browser setting; it is validated when the plugin loads.

```yaml
- id: llm-openai-codex
  config:
    enableProxy: true
    proxyUrl: http://127.0.0.1:7890
    preflightActivity:
      protocol: bili-v1
      trustedProxyOrigin: http://127.0.0.1:7890
      maxDurationMs: 450000
```

`maxDurationMs` is required: a positive safe integer no greater than `2147183647`. The upper bound reserves 300000 milliseconds for the Host's finite inner safety timer; it is not a recommended wait duration. Omit `preflightActivity` to retain the original behavior. Changes take effect on a subsequent operator-controlled plugin load; installing this patch does not change or restart any service automatically.

## Timing and trust

Activity counts only when all of these conditions hold: this invocation acquired the configured proxy origin, the response is successful SSE with `x-bili-preflight: compressing`, and a complete frame contains exactly `: bili-preflight` followed by an empty line. Fragmented LF, CRLF and CR line endings are accepted. Direct routes, another acquired proxy, a header alone, ordinary comments, partial frames and comments with extra fields do not renew idle time. Proxy trust does not change endpoint validation, redirect policy, TLS validation, credentials or direct-fallback policy; these headers are not proof of proxy identity on an untrusted route.

The ordinary idle interval remains 300000 milliseconds while an output read is outstanding. An accepted heartbeat renews only that idle interval. A separate absolute preflight budget starts at the first eligible response header and cannot be reset by retries or further heartbeats. A `data:` line or an oversized frame stops heartbeat recognition but does not erase the budget. The first converted Host chunk, EOF or iterator cleanup ends preflight timing. Consumer pauses between chunks are not provider idle time.

The plugin uses existing public provider authentication and stream-profile APIs, together with `dsh-timeout`; no Host fork or new upstream interface is required. Its timer starts after Host credential and attachment preparation. Only an opted-in profile gets an inner safety interval of `300000 + maxDurationMs`; the plugin wrapper still enforces the ordinary five-minute idle limit, including direct and noneligible responses. Each iterator has independent authority and timers, including repeated invocations of a prepared call.

Caller cancellation retains already-produced Host usage and aborted-finish chunks. A read that does not settle after cancellation is abandoned after one event-loop turn. Plugin-owned expiry remains `TIMEOUT`, even if the underlying provider later reports an aborted finish. Cleanup aborts the request, clears owned timers and detaches a nonsettling inner return. It cannot force arbitrary third-party callbacks to terminate. Response bytes and stream demand are preserved; no synthetic heartbeat is added to model output or conversation history.

## Verification and limits

`tests/preflight-*.spec.ts` exercises the unchanged oldest development Host with synthetic credentials, real SDK parsing, virtual time, fragmented frames, slow preparation, cancellation, total/idle limits and response demand. `pnpm run check:dsh-matrix` installs the same packed plugin against every exact declared Host and runs six enabled/default-off cases per Host, including a response header at 299 seconds followed by the full 450-second budget and an enabled/disabled cancellation comparison. Only HTTP and proxy transport are replaced in those installed fixtures; no real provider request occurs.

These checks do not establish real bili, HTTPS CONNECT/TLS topology, Windows Desktop or account/model acceptance. The issue's separate post-cancellation HTTP 413 is not changed by this patch. Keep #340 open until the intended real setup is independently accepted; source merge and green CI are not a publication or a successful live conversation.
