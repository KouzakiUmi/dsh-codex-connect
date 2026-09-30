# GPT-6.1-Sol 手动模型支持（0.2.0-alpha.1 候选，2026-09-30）

基线为 Alpha 4.54，提交 `3998265630e31bc1b4a75cdc757e7d48f80180f6`。现有维护范围允许手动模型支持；本变更不重启 Adaptive Task、改变已保存授权或 Luna Reserve，也不升级 pi-ai。

## 可核验参数与边界

- 模型 ID 为 `gpt-6.1-sol`，使用现有 `openai-codex-responses` / ChatGPT OAuth 路由，而非臆造 `-codex` 后缀。
- [官方 Codex 锁定目录](https://github.com/openai/codex/blob/a5cce8895a1400f94eb0a71771275284027fff17/codex-rs/models-manager/models.json) 中默认窗口 272,000、本地配置上限 872,000，支持文字与图片；不是 API 产品宣传窗口，也不是实测账户容量。
- [官方模型文档](https://developers.openai.com/api/docs/models/gpt-6.1-sol) 给出最大输出 128,000，直接推理强度 Low、Medium、High、Xhigh、Max。Codex 的 Ultra 是客户端自动委派编排，本插件不提供；Off、Minimal、None、Ultra 在认证和派发之前拒绝。
- Default 不发送显式 effort，交由路由决定，不把 API 默认 Medium 与 Codex 目录默认 Low 混同。
- OAuth 路由零价格字段沿用未知订阅价格的现有占位约定，不能作为免费或 API 价格证明。

## 实现

补齐缺失模型目录，若未来 pi-ai 已原生提供则保留名称、容量、价格及能力元数据，仅校准当前可表达的推理选项；不重复注册。统一目录同时供宿主选择、配置页和诊断使用。新模型配置上限链接指向其独立锁定来源，旧模型来源保持不变。

## 验证与交付状态

原候选 `320e9a1632a856d1f55d3705aaf263274896e6c6` 的历史检查：Node v22.22.3，134 个测试文件、1566 项测试通过；浏览器 11 个文件、53 项通过；工作流门禁、lint、typecheck、build、导入隔离、CLI、请求指标、兼容性及145文件打包检查通过。首次系统 Node v26.5.0 因既有跨进程测试参数 `--experimental-transform-types` 不兼容而有25项失败；未修改这些测试，使用现有兼容 Node22 后全通过。

补充新模型 Codex OAuth `/codex/responses` 工具往返测试，验证并行调用与反序工具结果按 call_id 对应、后续历史回放；禁止混用 Chat Completions。非法 None/Minimal 等在认证前拒绝。

定向适配器、上下文与推理测试验证目录去重、原生元数据保留、边界预算、所有五档 wire effort 和 wire model ID；合成 fetch，无真实账户请求。浏览器验证配置选择及窄窗口；完整 runtime 检查结果如上。

## 用户验收与发布范围

维护者报告：已在现有 3081 环境看到模型，并完成真实模型调用验证。这是用户验收，不是本次自动化测试或跨账户可用性保证。

本候选对应 #298 的模型可选目标，采用已有目录回退机制，不升级 pi-ai 或 OAuth。其他新模型不在本轮范围；Ultra 自动委派不受支持。新候选为 `0.2.0-alpha.1`；这是维护者批准的独立插件编号简化，四宿主支持范围和 Alpha 阶段不变。原 `0.1.0-alpha.4.55` 未发布。最终提交仍须重新通过精确 SHA CI、浏览器及四宿主同产物安装矩阵；上述旧提交通过记录不能替代新版本证据。最终检查与发布产物身份记录于 [PR #299](https://github.com/franksong2702/dsh-codex-connect/pull/299)，发布范围见 [0.2.0-alpha.1 说明](../release-notes/0.2.0-alpha.1.md)。
