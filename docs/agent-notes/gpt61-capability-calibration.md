# GPT-6.1 Sol capability calibration — 2026-10-16

Historical Alpha 5 checkpoint. The later [Sol61 default-alignment note](sol61-context-default.md) records the separately authorized 500k source change; the observations and then-current decision below remain dated evidence.

Development follow-up, not a published version or live-account acceptance. This review changes only Sol61's pinned configuration-policy provenance, not model defaults, budgets, routing, credentials, entitlements, Task or compaction policy.

## Four different facts, not four interchangeable limits

| Evidence | Value | What it establishes |
| --- | --- | --- |
| Immutable official Codex bundled catalog | default **272,000** | The pinned client's fallback metadata, not every account's current remote catalog |
| Same catalog `max_context_window` | **872,000** | A local configuration-override ceiling, not a measured endpoint maximum |
| Official ChatGPT Work/Codex Help article | advertised default **500,000** | Official OpenAI page text surfaced in third-party web-search results; full page not retrieved |
| Official API model documentation | **1,050,000** context / **128,000** output | Separate API product documentation, also search-index evidence in this observation, not a ChatGPT OAuth route contract |

The first two values were independently read from the [official immutable catalog](https://github.com/openai/codex/blob/d63a9b8344cfe58bc78bbe319b560378fc8756ef/codex-rs/models-manager/models.json#L177-L349). Full downloaded catalog: **472,072 bytes**, SHA-256 **943ca7fe1d19ed019054158303f0dbbd80b3bef43b3aa425a71aa7cb3fb52c2b**, Git blob **72a78e0eacf94103f4babda2a5245aba4ce848c1**. The catalog revision `d63a9b8344cfe58bc78bbe319b560378fc8756ef` was committed 2026-10-06T01:46:33Z. Research observed main at `e790ce271749ce431e446a9e2cc66485fe60f931` (2026-10-16T02:39:49Z) with the identical catalog blob; this is an observation, not a claim of latest-ever state. The relevant Sol61 fields match the previous `a5cce8895a1400f94eb0a71771275284027fff17` pin (2026-09-30T11:05:59Z); this is a provenance refresh, not catalog drift that warrants a bigger default.

The [official localized Help article](https://help.openai.com/zh-hans-cn/articles/20001275-chatgpt-work-and-codex), labeled machine-translated, supplies credible product-document support for 500k; do not call that claim baseless. This is a third-party search-index observation of an official page, not OpenAI's own index or a successful full-page fetch. The [API model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) has the same retrieval limitation here. Full-page retrieval was unavailable: the page-fetch tool rejected hostname/address resolution, and no successful full-page retrieval was obtained in the research. These remain search-result evidence, not archived page captures or observations of this plugin's account/route. Their differing scope must stay visible.

Official `max_context_window` is explicitly the [configuration override maximum](https://github.com/openai/codex/blob/e790ce271749ce431e446a9e2cc66485fe60f931/codex-rs/protocol/src/openai_models.rs#L455-L471). The [official model manager's remote-catalog application](https://github.com/openai/codex/blob/e790ce271749ce431e446a9e2cc66485fe60f931/codex-rs/models-manager/src/manager.rs#L681-L705) can supplement bundled metadata with account/provider-scoped remote metadata. Product and bundled defaults can therefore diverge without proving that an OAuth endpoint was measured at either capacity. No live account-scoped catalog query, token-length probe, OAuth or model request was made here.

## Decision

- Keep the missing-Sol61 fallback at 272,000, output at 128,000 and local override ceiling at 872,000. Do not enlarge the shared Astra fallback or overwrite native provider metadata.
- Refresh only Sol61's configuration-policy link to `d63a9b8`; preserve the older models' historical source. Existing explicit user override/reset behavior is unchanged. An override changes local budgeting, not server capacity, prices or Host compaction policy.
- Reconsider a globally shipped missing-Sol61 500k fallback only when the full official product-default policy is verified and accepted as authority. A verified account catalog may instead justify only an account/provider-scoped default, not a global fallback. Label that provenance separately; never pretend the bundled catalog said 500k. Native metadata still takes precedence. No 1M/1.05M ceiling, output increase or account-entitlement claim follows from this observation.

## Effort, speed and orchestration

Direct supported efforts remain **Low, Medium, High, Xhigh, Max**. For this plugin, Default leaves `reasoning.effort` unset. The pinned Codex client catalog advertises Low while separate API product docs advertise Medium; neither is forced into an omitted plugin request, whose effective default is selected by the route. Fast requests priority through `service_tier=priority` independently and must preserve explicit effort; it guarantees neither the actual processing tier nor speed/entitlement.

Ultra is client orchestration, not a sixth direct wire effort. The [official normalization](https://github.com/openai/codex/blob/e790ce271749ce431e446a9e2cc66485fe60f931/codex-rs/protocol/src/openai_models/reasoning_effort.rs#L8-L38) first uses a supported `multi_agent_reasoning_effort`; Sol61's pinned value is **xhigh**. It is incorrect to describe Ultra as always sending Max. The plugin continues rejecting unsupported Off/Minimal/None/Ultra before authentication/dispatch.

Host Workflow `agent()` option availability is Host-interface scope, separate from the adapter's support for explicit Sol61 effort. The plugin's `/plugins/dsh-codex-connect/models` configuration-catalog output is not Host automation/reasoning-option discovery. No plugin-global effort default, Workflow scheduler, automatic model selection, Fast/effort coupling, API reroute or Ultra delegation is added.

## 中文摘要

本轮先校准证据与来源，不扩容冒充能力提升。不可变 Codex 内置目录仍为默认 272k、配置上限 872k；搜索结果收录的官方 Help 页面文字已宣称 Work/Codex 默认 500k，不能说完全没有官方依据；这是第三方索引对机器翻译版官方页面的观察，不是 OpenAI 自有索引。本轮未成功取得该全文，也未验证账户远程目录。API 的 1.05M 属于另一产品/路由，不能直接移植。

仅更新 Sol61 配置上限的锁定来源链接，保留默认值、输出值、原生元数据优先、用户覆盖/重置和其他模型来源。未来若确认并采用官方产品默认策略，应仅调整缺失 Sol61 的全局回退值，独立标明依据，不改共享 Astra 或伪称内置目录已经是 500k。单一账户目录至多支持对应账户/提供方范围的默认值，不能外推所有账户。

五档直接推理选项与 Default 不变；Fast/priority 独立于 effort。Ultra 是客户端编排，官方会先取 Sol61 的 multi-agent xhigh，不是恒等于 Max。本轮不新增全局 effort、自动委派、额度/价格承诺或真实模型验收。
