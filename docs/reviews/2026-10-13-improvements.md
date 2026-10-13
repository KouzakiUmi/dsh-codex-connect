# 2026-10-13 插件维护修复记录

## 范围与状态

针对[本轮审查](<2026-10-13-code-review.md>)的六项发现，实施最小维护修复，并复用既有浏览器有界请求设施。原有额度药丸 opt-in 修复、默认关闭及关闭时不请求的行为保留；未重开冻结的 Task、Remember 或 Reserve 扩展。

- 源码基线：`feat/personal`，`cfecc9e9269192997e4961195c625b6211804b0b`；修复位于未提交工作树，不代表已合并或发布。
- 主代理验证运行时：Node `v24.21.0`；子代理独立合成验证另使用 Node `v24.13.0`，不混称为生产运行时。
- 3 个 `openai-codex/gpt-6.1-sol/high` 子代理分工实施，最多并发 2；主代理处理文案、计量顺序、冲突回归与整合验证。
- 未读取真实凭据、调用真实模型、修改宿主安装或生产配置；未提交、推送、发布、安装或重启。

## 实施内容

| 审查项 | 修复 | 位置 |
|---|---|---|
| R1 自动审查异常 DTO | 枚举字段先检查字符串类型，拒绝数组、对象、null、缺字段等非法结果；维持失败回人工审批链 | [auto-review-backend.ts](<../../src/auto-review-backend.ts#L76-L86>) |
| R2 认证取消 | 实例局部 ALS 将请求与插件生命周期信号传给认证 resolver，覆盖普通及 prepared 请求，保持并发隔离 | [adapter.ts](<../../src/adapter.ts#L357-L428>) |
| R3 异步清理准入 | 消费者立即收到取消错误；一次性源清理完成或失败后才释放槽位，抑制取消生成的虚假 EOF；hook 失败和包装失败也等清理 | [backend-request.ts](<../../src/backend-request.ts#L70-L145>) |
| R4 会话开关恢复 | Fast Mode / Extended Context 错误态允许用户点击 GET 读回；失败或超时的 POST 不重放 | [OpenAICodexFastModeToggle.tsx](<../../src/client/OpenAICodexFastModeToggle.tsx#L94-L185>) |
| R5 已保存代理外部更新 | 保存的代理或配置源变化时失效旧检查、取消请求并回 idle；旧响应不能覆盖新检查，也不自动探测新地址 | [OpenAICodexConfiguration.tsx](<../../src/client/OpenAICodexConfiguration.tsx#L220-L234>) |
| R6 输出提示契约 | 双语提示及共享配置注释说明模型默认实际发送目录默认详细度，摘要不要求显式推理档位，none 才省略摘要字段 | [locales.ts](<../../src/client/locales.ts#L180-L185>)、[settings-contract.ts](<../../src/settings-contract.ts#L50-L58>) |

### 认证边界校正

实施中依据本地 pi-ai 1.1.0 的认证契约校正了 R2 的影响说明：**已经开始的 OAuth 刷新继续其独立 15 秒截止并提交轮换令牌，是避免账户失效的既定策略，不是本次要阻止的副作用。** 修复阻止预取消请求开始认证，使锁等待/调用者等待可取消，并阻止取消后的模型派发；不强行中断已经开始的令牌轮换，不修改账户存储政策。

### 请求截止与生命周期

会话开关、额度刷新、自动代理检测、手动代理测试及当前代理检查统一复用[request-json.ts](<../../src/client/request-json.ts>)，截止为 45 秒，覆盖响应头与 JSON body。沿用卸载/配置变化取消与晚响应保护，不引入第二套请求封装。

额度仍为默认关闭、单请求进行、失败冷却与退避；挂起请求到期后可在冷却结束继续轮询。开关恢复仅由用户触发 GET，避免重复执行可能已经提交的修改。

计量记录与资源准入分离：取消或响应 hook 失败时及时记录终态，源清理 settle 后再释放槽位，避免 dispose 先关闭日志造成终态丢失。未知且永不 settle 的源清理不会被超时盲目释放。

## 回归覆盖（正式测试未运行）

本轮新增、更新及保留的正式回归包括：

- [adapter-auth-cancellation.spec.ts](<../../tests/adapter-auth-cancellation.spec.ts>)：普通/prepared 预取消、刷新中取消、并发隔离、dispose，并保留已开始轮换的提交策略。
- [auto-review-backend.spec.ts](<../../tests/auto-review-backend.spec.ts>)与[auto-review.spec.ts](<../../tests/auto-review.spec.ts>)：畸形枚举和 completed SSE 回人工链。
- [backend-request-review.spec.ts](<../../tests/backend-request-review.spec.ts>)与[metrics-pending-cancel.spec.ts](<../../tests/metrics-pending-cancel.spec.ts>)：异步取消 resolve/reject、重复取消、dispose、虚假 EOF、hook 清理、计量顺序；移除旧的提前准入断言。
- [openai-codex-fast-mode.client.spec.tsx](<../../tests/openai-codex-fast-mode.client.spec.tsx>)：GET 恢复、可能已提交 POST 的读回、45 秒截止、晚响应。
- [openai-codex-settings.client.spec.tsx](<../../tests/openai-codex-settings.client.spec.tsx>)：外部保存代理变化、旧成功/失败响应、探测截止与卸载；整合时通过真实 ConfigForm 接口模拟外部写入，避免宽泛 Mock 返回类型；手动测试的非法 JSON/null 响应维持失败反馈且不能启用代理。
- [request-json.client.spec.tsx](<../../tests/request-json.client.spec.tsx>)：父信号取消、计时器/监听清理、晚响应隔离、POST 到期不重放及新 GET。
- [issue-219-quota.client.spec.tsx](<../../tests/issue-219-quota.client.spec.tsx>)与[openai-codex-quota-indicator.client.spec.tsx](<../../tests/openai-codex-quota-indicator.client.spec.tsx>)：保留 opt-in 门控，挂起请求到期后的冷却恢复。
- [output-style.spec.ts](<../../tests/output-style.spec.ts>)：双语默认值提示与既有 wire 契约一致。

## 实际验证结果

| 验证 | 结果 |
|---|---|
| 严格服务端/客户端 `tsc` | 最终源码与全部新增测试整合复跑 exit 0；未放宽配置或使用忽略类型检查 |
| 全源码 ESLint、源码约束门禁 | exit 0 |
| 元数据及固定 OAuth 源码检查 | exit 0；元数据 44 项回归通过 |
| 发布契约检查 | exit 0；39/39 契约断言通过及附属合成回归通过 |
| Canary 检查 | 工作流 82/82 与维护场景通过，随后临时目录创建 `EPERM`，整条命令 exit 1；不能记为整体通过 |
| 主代理独立无落盘断言 | 畸形审查拒绝、取消立即可见但保留准入、普通/prepared 预取消零派发、caller/dispose 及时退出并保留轮换提交、hook 计量在日志关闭前、双语提示均通过 |
| 源码构建 | exit 0；服务端 ESM、客户端 CJS、CLI 和声明产物重建完成 |
| 构建导入/宿主代理策略 | exit 0；保留环境代理及自定义 v1 dispatcher 与所有权 |
| 打包清单 dry-run | exit 1；npm 报无法写入 `npm-cache/_logs`，未换缓存或重试，不能记为通过 |
| 正式 Vitest、完整 `check`、浏览器和支持矩阵验收 | 未完成；依赖系统 Temp 的验证已被阻断，主代理停止受阻验证，未改变临时路径或权限；替代 runner 结果不采用 |

子代理一次非正式替代 runner 的 12/12 结果已明确排除，不计入验收证据；正式 Vitest 仍未执行。子代理其余独立合成结果不等于真实账户、生产网络或宿主验收。

## 交付边界与待验收

- 当前状态是**源码与构建产物已更新、静态检查及独立合成边界验证通过**，不是完整测试通过、生产启用或发布。
- 系统 Temp 的 `mkdtemp EPERM` 与 npm cache 写日志失败的权限根因未在本任务中诊断或修复。未调整 ACL、TEMP、缓存或权限。
- 需在另行确认允许且工作正常的验证环境补跑正式 Vitest / 完整 check，重点核对客户端读回恢复、外部代理更新与截止退避。
- 未进行真实 OAuth、代理中正在轮换时的服务停用、真实额度/模型、GUI 或多宿主矩阵验收。
- 旧安装包未重新打包，不能当作本次修复产物安装；未做版本递增或任何安装操作。
