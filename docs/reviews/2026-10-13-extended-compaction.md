# 会话扩展上下文与自动压缩窗口修复

## 范围与根因

2026-10-13，基于 feat/personal 的 `9c6b659e4418a524179f4dd60c3832846df934c6` 工作树修复；未提交、推送、安装或重启，不修改宿主或使用真实凭据/模型。

工作区解析的 DSH LLM Core 为 `0.2.1-alpha.2`。其 BasicCompactionEngine 在自动 `agent/pre-step` 中调用 `llm.resolveModelInfo`，最终读取 `adapter.resolveModel`；原插件仅在 `prepareCall` 返回扩展窗口。因此请求使用500K/872K，压力判断仍使用272K。

## 最小修复

- [extended-context.ts](<../../src/extended-context.ts#L31-L50>)：global/prepend pre-step 中，按宿主同样使用的 durable request/header 路由重新绑定会话、模型和 turn signal。每个步骤均刷新，避免同一 turn 复用 signal 时开关变化不生效；无 header 或非 Codex 路由清除旧绑定。最终 agent/request 仍捕获实际请求路由。
- [adapter.ts](<../../src/adapter.ts#L420-L435>)：`resolveModel` 与 `prepareCall` 共用现有 expanded/maximum adapter。压力查询现在使用开启默认500000、开启最大872000、关闭272000；未绑定的模型目录读取仍为标准窗口，不改变输出预留与其他模型属性，不扩展不同模型的辅助查询。
- 不改变宿主的阈值比例、headroom、输出预留、摘要/原生压缩选择、事务、持久化、溢出恢复及 Reserve 禁压缩边界。旧 prepared call 已捕获的预算不变。

## 正式回归（已编写、未执行）

- [extended-context.spec.ts](<../../tests/extended-context.spec.ts>)：500K/872K/272K元数据及模型隔离。
- [extended-context-compaction.spec.ts](<../../tests/extended-context-compaction.spec.ts>)：真实 Cordis、AgentLoop、BasicCompactionEngine、LLM及TokenMeter服务的手工事件链；首次有durable header但尚未request绑定、同turn变化、并发会话、路由/辅助模型隔离、旧绑定清理、预算捕获和输出cap保持不变。无持久化插件、真实凭据或联网。此回归不代表完整AgentLoop turn、压缩提交/恢复或真实长会话验收。

## 本轮实际验证

| 检查 | 结果 |
| --- | --- |
| 严格服务端与客户端tsc，包含新增测试 | exit 0 |
| 源码ESLint与source-lint gate | exit 0 |
| tsdown构建、环境代理与自定义dispatcher导入检查 | exit 0；工作区构建产物已同步 |
| git diff --check | exit 0 |
| 独立无落盘压力链合成断言，Node v24.21.0 | exit 0 |

独立断言调用实际 LlmRuntime.resolveModelInfo 与 BasicCompactionEngine.compactIfNeeded 方法，只用合成session/token meter及内存注册夹具，不执行摘要或压缩事务。在显式 `thresholdRatio=0.8`、`headroomTokens=65536`、请求输出预留8192的夹具中，证实以下阈值前一token不进入历史范围选择、阈值处进入：

| 会话窗口 | 合成压力阈值 |
| ---: | ---: |
| 500000 | 400000 |
| 872000 | 697600 |
| 272000 | 198272 |

这些阈值是上述夹具的结果，不是实际Profile固定配置；宿主仍按 `floor(min(window * ratio, window - outputReserve - headroom))` 计算。另证实首次pre-step、同signal开关/最大模式变化、未绑定元数据、辅助模型和另一signal隔离、非Codex/无header清理，以及旧prepared仍500K。

一次探索性旧窗口基线断言与子代理写入发生交错，实际已返回500K，因此旧272K断言exit 1；读取并冻结最终源码后，上述最终三档断言全部通过。不将旧基线命令计作通过。

## 未验收边界

此前正式Vitest/full check在系统Temp路径遇到EPERM；本轮未重试该受阻链，也未更换TEMP、权限、runner或执行通道。上述独立断言不是正式测试套件运行。未执行生产长会话、真实模型、完整自动压缩提交/持久化、Desktop装载或兼容矩阵。已有安装包和本机插件不包含这次新增修复；需要另行授权提交、推送与安装。
