# Codex Connect 全面代码审查与官方源码对比

日期：2026-10-13（Asia/Hong_Kong）。性质：只读审查；未实施修复、安装、发布或重启。

## 结论

发现 **5 项 P2 缺陷、1 项 P3 文案/契约问题**。建议先修复自动审查输出验证与两个取消/资源生命周期问题，再修客户端恢复状态。没有证据要求整体重写、回退本地功能，或重新开放被冻结的实验。

本报告是关键链路的跨模块审查，不是“所有文件和所有场景已穷尽”或安全认证。三项服务端问题使用纯内存合成输入复现；客户端问题为可沿代码完整追踪的静态状态机证据，未执行浏览器复现。未运行本次完整测试矩阵或真实账户验收。

## 版本与审查范围

| 对象 | 本次核验身份 |
|---|---|
| 当前项目 | `feat/personal`，HEAD `cfecc9e9269192997e4961195c625b6211804b0b`，加当前 17 项 tracked 未提交改动 |
| 插件官方上游 | 本次授权浅克隆，`main@f1d1745e3705c7ecef30675d6857a01c1bde93ea`，提交时间 2026-10-10 16:31:14 +08:00 |
| OpenAI Codex | 本次授权浅克隆，`main@f82e36592278a0a782fb0d0fc97e5fa10e832ac2`，提交时间 2026-10-13 04:42:04Z |
| 本地目录镜像标记 | `47bcb3a3f9e0904aed485389aaf410282b6b23fa` |
| 合成复现执行环境 | Node v24.13.0，直接运行 TypeScript，未调用模型或读取真实凭据 |

官方仓库位置：`D:/codex-official-review`、`D:/codex-connect-upstream-review`。先前 GitHub API 限流 403 后停止请求；在用户明确授权 D 盘 clone 后获取这两个独立工作目录，没有在当前项目执行 fetch、checkout、merge 或提交。

分工：主代理负责版本取证、官方实现对比、结果复核；两个 `openai-codex/gpt-6.1-sol/high` 子代理分别负责服务端和客户端。没有再委派。

覆盖重点：请求适配与模型配置、OAuth 认证边界、并发 governor、取消/dispose、代理生命周期、quota 缓存与浏览器展示、设置 Save/Discard、会话开关、Auto-review、既有 compaction/恢复安全、相关测试和全部未提交 diff。主代理补查原图存储、公共图片 HTTP 边界、更新路由与实际服务模型记录。图片界面、更新展示及部分历史实验模块为定向审查，未逐行穷举。

## 缺陷清单

### R1 / P2：畸形 Auto-review 枚举被当作有效授权结果

- 位置：[auto-review-backend.ts:76–86](<../../src/auto-review-backend.ts#L76-L86>)、[auto-review.ts:72–75](<../../src/auto-review.ts#L72-L75>)。
- 触发：返回 `risk_level:["low"]`、`user_authorization:["high"]`，同时 `outcome:"allow"`。
- 根因：验证使用 `String(value)`，数组被强制转换成合法枚举文本；实际返回对象仍保留数组。SSE terminal 接受该结果，下游允许一次动作，没有走 malformed/unavailable 的人工回退。
- 主代理独立纯内存复现输出：`invalidArraysAccepted=true, successfulTerminalAccepted=true, riskType="object"`。
- 影响：启用 Auto-review 时，结构验证的安全边界失效；不是证明任意远程调用者均能控制 reviewer，也不是证明默认关闭时会自动授权。
- 最小建议：先判断字段 `typeof === 'string'` 再验证枚举；数组、对象、null、缺字段必须拒绝。保持现有人工回退，不新增授权策略。
- 官方对照：[assessment.rs:24–35](<D:/codex-official-review/codex-rs/ext/guardian-reviewer/src/assessment.rs#L24-L35>)、[64–69](<D:/codex-official-review/codex-rs/ext/guardian-reviewer/src/assessment.rs#L64-L69>)采用 typed enum 反序列化。官方还允许部分字段缺省和外层说明文字，但无需复制其宽松政策；应借鉴类型边界而非弱化本项目更严格的合同。

### R2 / P2：普通模型认证阶段脱离请求取消信号

- 位置：[adapter.ts:357–359](<../../src/adapter.ts#L357-L359>)；现有可复用信号入口：[auth.ts:73–93](<../../src/auth.ts#L73-L93>)。
- 触发：access token 到期，普通模型请求在开始前已取消，或认证刷新期间取消。
- 根因：`resolveApiKey` 调用 `readOpenAICodexRequestAuth(credentials)` 时遗漏信号；本地宿主在等待 API key 后才组合请求 signal 和建立 stream watchdog。
- 子代理发现后，主代理独立使用纯内存合成凭据 + mock fetch 复现：已 aborted 请求仍执行 `/oauth/token`，且 `syntheticCredentialWrites=1`。未读取真实账户、未联网。
- 影响（实施时校正）：预取消请求仍开始刷新、取消中的调用者仍等待认证，插件 dispose 未接入该阶段。**已经开始的刷新完成并保存轮换令牌是有意的恢复策略，不属于本缺陷。** pi-ai 1.1.0 的认证实现明确仅取消锁等待和调用者等待；已开始的刷新与持久化使用独立 15 秒截止，以免丢失唯一有效 refresh token。
- 最小建议：沿 adapter 请求生命周期传递请求和插件生命周期信号，使预取消不开始认证、锁等待可取消、刷新中的调用者及时退出且不派发模型；保留已开始刷新完成提交的策略。宿主 resolver 签名未提供 signal，采用现有请求局部上下文，不编造额外参数、不改账户政策。
- 回归：预取消无 refresh/write；刷新中取消后调用者退出且不派发模型，同时后台完成轮换提交；停用插件取消；两个并发请求的信号不得串扰。

### R3 / P2：abort 提前释放并发槽位，清理尚未完成

- 位置：[backend-request.ts:84–89](<../../src/backend-request.ts#L84-L89>)，对照正确等待清理的 [109–114](<../../src/backend-request.ts#L109-L114>)。
- 触发：响应源 `cancel()` 异步释放网络/代理资源，期间请求收到 abort。
- 根因：abort 分支 fire-and-forget `reader.cancel()` 后立即 `finish()`，放行下个请求；显式 body.cancel 分支则等待 cleanup。
- 主代理独立纯内存复现：`maxConcurrent=1`，首个源的 cancel Promise 尚未解决时，第二次 fetch 已派发：`syntheticDispatchesBeforeCleanup=2, cleanupDone=false`。
- 影响：取消频繁时，实际未清理资源可超出 governor 的并发计数；此复现验证的是准入时序，不是实测 socket 总数。
- 最小建议：统一 abort/body.cancel/error 的一次性清理流程，在源取消 settle 后释放槽位，同时保留对消费者立即可见的取消错误。补异步清理、重复取消、dispose 和 cleanup rejection 回归；避免永不 settle 的 cleanup 把系统永久卡住，需明确清理策略而非简单吞错。

### R4 / P2：会话开关一次请求失败后不可恢复

- 位置：[OpenAICodexFastModeToggle.tsx:113–148](<../../src/client/OpenAICodexFastModeToggle.tsx#L113-L148>)、[166–173](<../../src/client/OpenAICodexFastModeToggle.tsx#L166-L173>)、[202](<../../src/client/OpenAICodexFastModeToggle.tsx#L202>)。
- 影响 Fast Mode 和复用同一组件的 Extended Context。
- 触发：一次 GET/POST 500、断网或无效 JSON，随后网络恢复。
- 根因：状态进入 error；`busy = status !== 'ready'`，按钮 disabled，toggle 拒绝 error；读取 effect 仅依赖 eligible/sessionId/path。相同会话恢复网络、切换另一 eligible GPT 均不触发重读。
- 影响：除刷新/重挂载或改变相关依赖外不能恢复；POST 响应丢失时也无法安全读回已提交状态。
- 最小建议：error 态提供用户触发 GET 读回；成功后再切换，绝不自动重放状态不确定的 POST。补 GET 失败恢复、POST 丢响应后读回和模型切换回归。

### R5 / P2：外部更新代理后检查状态永久停在 checking

- 位置：[OpenAICodexConfiguration.tsx:378–401](<../../src/client/OpenAICodexConfiguration.tsx#L378-L401>)、[242–248](<../../src/client/OpenAICodexConfiguration.tsx#L242-L248>)、[600–608](<../../src/client/OpenAICodexConfiguration.tsx#L600-L608>)。
- 触发：检查已保存代理 A 期间，另一设置视图/浏览器保存代理 B；A 的结果稍后返回。
- 根因：检查结果的 origin guard 正确丢弃 A，但没有退出 checking；外部配置更新 effect 仅同步 draft；B 的检查按钮继续 disabled。
- 最小建议：已保存 origin/enableProxy 改变时使旧请求失效并清回 idle；按请求代际清理，不能用旧请求 finally 覆盖后发 B 请求。无需自动探测 B。
- 回归：外部 A→B、A→关闭、旧 A 晚成功/晚失败、新 B 请求进行中旧 A 结束。

### R6 / P3：输出设置帮助与 wire 合同相反

- 位置：[locales.ts:182–185](<../../src/client/locales.ts#L182-L185>)及对应中文文本；[settings-contract.ts:50–53](<../../src/settings-contract.ts#L50-L53>)。
- 文案说 default verbosity 不发字段、默认 effort 不发摘要；实际 [adapter.ts:130–151](<../../src/adapter.ts#L130-L151>)发送目录默认 verbosity，选定非 none 摘要也不受 explicit-effort guard 限制；[163–174](<../../src/adapter.ts#L163-L174>)为默认 effort 补目录值。
- 最小建议：修双语说明和共享注释，保持当前已决定的 runtime 行为，不反向修改协议去迎合陈旧文案。
- 官方确认：[client.rs:929–947](<D:/codex-official-review/codex-rs/core/src/client.rs#L929-L947>)使用默认 effort、摘要 none 不发；[1033–1048](<D:/codex-official-review/codex-rs/core/src/client.rs#L1033-L1048>)在支持 verbosity 时取用户值或目录默认。

## 当前官方实现对比

1. **插件上游没有可直接合并的新提交。** 本次新克隆的官方 main 与本地已有 upstream/main 同为 `f1d1745`。本地相对其有四个提交及当前未提交药丸修复；源码目录差异为 26 个文件，830 行新增、251 行删除。生成 bundle 的大 diff 不能直接当作等量业务复杂度。
2. **已有八个公开模型的镜像字段一致。** 主代理对最新官方 JSON 与本地镜像计算比对：八个重合模型的默认 effort、verbosity、摘要默认、支持 effort（排除 client-only ultra）及最大窗口没有差异。
3. **`gpt-reserve` 不是本次公共 bundled catalog 的条目。** 它是本项目独立隐藏服务路由；不能由目录缺席推导它不存在或应删除。当前注释把所有条目统称官方目录镜像，建议区分公共目录证据和独立路由证据。
4. **官方另有隐藏条目。** Daybreak Blue、Daybreak Red、codex-auto-review 均 `visibility:"hide"`，且使用 Responses Lite；Red 为 372K。不建议仅为目录齐全把这些模型暴露给用户，也不推断账户有访问资格。
5. **272K/500K/872K 不需整体回退。** 官方公开默认 raw 272K、可扩展模型上限 872K、5.5 上限 272K；官方配置覆写受 max clamp。本项目 500K 是已记录的 opt-in 中间预算，不是官方公共目录默认，也不是账户容量验证。继续由 DSH 负责 admission/compaction，不能直接复制 Codex 的整个上下文管理栈。
6. **none 摘要省略及默认 verbosity 与官方一致。** 需要修的是帮助文字。未来可补 `support_verbosity` 和 `supports_reasoning_summary_parameter` 的 capability gate，未知模型不应无条件假设支持；当前八个已核模型没有据此证明请求失败。

## 更好的实现／优化（与缺陷分开）

- **优先复用已有浏览器有界请求机制。** [request-json.ts](<../../src/client/request-json.ts>)已有覆盖响应体的 45 秒截止和父 signal 清理。会话开关、额度药丸及部分代理请求仍裸 fetch；迁移时保留 quota 的 single-flight/backoff，并对 mutation timeout 只读回，不自动重试 POST。无截止属加固项，不单独声称生产已无限挂起。
- **把目录镜像变成可机械核验的投影。** 在固定 commit 的脱敏公开 fixture 上生成/验证默认值、上限、capability flags、visibility；CI 离线验证，不在运行时读取用户 Codex cache，不自动加入隐藏模型。当前字段一致不代表未来永远无漂移。
- **接通实际服务模型诊断。** [served-model.ts](<../../src/served-model.ts>)目前只有内部记录和测试，`lastServedModel` 没有生产消费者；可在现有脱敏诊断接口展示 requested/served，按实例和生命周期清理。不能声称该记录已在 GUI/doctor 可见，也不为它新建统计平台。
- **账户切换使药丸旧快照即时失效。** 当前已显示比例可留到下一次约 60 秒 poll；优先订阅已有账户状态而非新加第二套缓存。是刷新延迟优化，不是已证实的凭据或跨账户权限泄露。
- **原图读取安全模式对齐现有持久化读器。** [image-assets.ts:192–204](<../../src/image-assets.ts#L192-L204>)先 lstat 再无界 readFile，读取后才校验大小/hash。可复用 descriptor identity 与有界读取模式；当前没有复现远程攻击，因此仅列文件损坏/本地替换下的防御性加固。
- **不建议为“官方更快”直接切 WebSocket/Responses Lite。** 当前 SSE 明确用于避免一次性 Headless 被缓存连接留住。更换传输会触及 stream/replay/cancellation/宿主契约，不能凭官方 prefer_websockets 就保证本机速度收益。
- 官方 model manager 使用身份绑定、缓存策略和 auth-change deadline；可作为未来能力来源设计参考，但不能直接读取真实用户缓存或新增生产后台刷新。当前维护范围不授权这类新能力实施。

## 保留项与验证限制

> 🧠 **From Hindsight memory (Key decisions and rationale)** — 额度药丸应按 Profile 配置 opt-in，默认关闭；关闭时不仅不渲染，还不得轮询。已对照当前源码与未提交 diff 核实该门控存在，不能把历史通过测试的记录当作当前通过证据。

未提交药丸修复未发现新增实质缺陷：Host schema、解码、安全默认、设置保存、组件副作用清理与双语文档/产物一致。应保留，不因审查覆盖用户现有工作。

本次没有运行完整 Vitest、浏览器、Core 兼容矩阵、构建或安装验证；不复用此前 passing HEAD。实际执行证据仅包括仓库/版本/差异取证、`git diff --check`、官方目录计算比对、纯内存合成复现。完整测试仍是后续修复验收条件。

冻结 Task/Remember/Reserve 的扩张仍保持冻结；只允许针对具体维护安全缺陷拟定修复。没有提交、推送、修改生产服务或批准任何新产品功能。
