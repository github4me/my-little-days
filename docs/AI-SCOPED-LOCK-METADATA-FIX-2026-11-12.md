# AI 锁范围和轻量诊断优化 — 2026-11-12

状态：本地实现；尚未提交、部署、上传 TestFlight 或修改生产配置。本文是
[性能分析](PERFORMANCE-REVIEW-2026-11-12.md)之后的实现记录，不代表线上已生效。

## 改动

| 路径 | 新的协调范围 | 保留的保护 |
| --- | --- | --- |
| Get / EnsureCurrent | 同账户 Shared；不同账户并行 | 权限、撤销、租约、到期和恢复模式 |
| Complete / Cancel 的每个小批次 | 同账户 Exclusive；不同账户并行 | 取消标记先提交、禁止迟到结果重新出现 |
| 入队 / 领取 / 跨实例额度 / 清理 | 原有短全局 AI Exclusive | 队列上限、唯一领取、分布式额度和旧进程兼容 |

账户操作的锁顺序为：账户锁 → 旧 AI Shared 兼容锁 → 生命周期 Shared。
全局 AI 操作仍为：旧 AI Exclusive → 生命周期 Shared，而且不请求账户锁。
因此，某账户排队时不会先占着全局锁或生命周期锁。家庭记录读写、账户删除、
成员移除等原有锁和权限语义未改变。模型网络请求期间仍不持有 SQL 锁。

Get / EnsureCurrent 只读取状态所需列，不取 RequestJson；EnsureCurrent 也不取
结果正文。状态轮询是无跟踪只读事务，到期结果只在响应中隐藏，数据库过期清理
仍由原有有界任务执行，不再因一次轮询写入数据库。

空队列领取先做一次只读存在性检查，没任务就不进入写事务／应用锁。有候选时
仍在全局事务内重新选择和领取，预检查不赋予租约。后台 5 秒、手机前台加载时
4 秒的既有间隔未改变。

异步任务执行只使用任务存储的权威检查，不再紧邻着重复查询一次同样的账户／
成员权限。调用前、返回后、重试前后的检查仍在；旧同步接口仍使用原有授权。
没有缓存或跳过 Directory 账户准入，也没有修改家庭同步频率、容量限制或冲突策略。

## 日志和数据边界

- 停止新的完整请求、完整响应和失败输出正文采集；HTTP handler 不复制、提前读取
  或截断正文，也不等待诊断 SQL 写入。StoreExchange 为兼容性无操作。
- `FullRequestCaptureEnabled` 在此版本始终为 false；遗留 true 配置不能重启采集。
- 保留已有阶段耗时／安全错误分类，以及最多两次 attempt 的固定原因、字段路径、
  索引和耗时。新事件 4102 不包含模型输出、家庭记录、异常原文或凭证；日志故障不能
  改变业务结果。异步和旧同步入口均记录安全失败元数据。
- 旧客户端的可选诊断字段仍接受，原请求指纹不变，但新任务的诊断授权列均为空，
  满足旧 SQL 约束；同一 operationId 改写该字段仍被判定为 operation_reused。
- 既存诊断表与迁移脚本不改，历史正文仍由既有 7 天到期及有界清理处理。此任务没有
  连接或删除生产数据。旧版本进程仍可能采集旧任务，必须完成滚动发布后才可验收全站停采。
- 异步运行本身必需的任务输入／结果不是调试日志：输入在任务结束时清空，结果保留
  至本地午夜；这些机制保持，以免切出 App 后任务丢失。

## 回归证据

专用 AI 单元及真实 SQL 回归：**625 passed，0 failed，0 skipped**。临时 SQL Server
只含合成数据、无生产凭证／宿主端口；每次运行结束删除本次临时容器和网络。

最终版本（含追加的家庭授权／历史版本回归）验证：

- 后端全量：API **946** + migrator **157** = **1103 passed**，0 failed，0 skipped。
- .NET 10 Release 非增量构建：0 warnings，0 errors；测试发现命令成功。
- `npm run verify` 成功：TypeScript 类型检查及仓库配置的前端回归套件。
- 两个测试工作流交叉审查与主代理复核，没有发现阻塞性缺陷；没有声明覆盖率百分比。

后端命令在临时 Docker .NET 10 / SQL Server 2022 环境执行，均退出 0：

```sh
dotnet test server/LittleDays.slnx --configuration Release --artifacts-path /out/artifacts --logger trx --results-directory /out/results
dotnet build server/LittleDays.slnx --configuration Release --artifacts-path /out/artifacts --no-incremental
dotnet test server/LittleDays.slnx --configuration Release --artifacts-path /out/artifacts --no-build --list-tests
```

| Requirement | Evidence |
| --- | --- |
| 缩小锁的范围。 | `DifferentAccountMutationsCommitConcurrentlyWhileLegacyAndLifecycleBarriersRemain`；`WaitingForAccountDoesNotBlockGlobalAdmissionTransaction`；`HeldPollAllowsOtherReadsCompletionAndCancellationButExcludesOwnCancellation` |
| 只保留轻量计时记录。 | `CaptureStaysDisabledEvenWithLegacyEnabledConfigurationAndEpoch`；`FailureEventContainsOnlySanitizedBoundedMetadataNotResponseOrExceptionText`；`RetiredExchangeStoreReturnsFalseWithoutADatabaseProviderOrTransaction` |
| 并修复其他问题，确保不会引入新问题 | `QueuedPollProjectsNoRequestPayloadAndPerformsNoDatabaseMutation`；`EmptyClaimBypassesApplicationLocksButStillChecksRecoveryAndAvailability`；`TwoPositiveClaimPreflightsStillProduceExactlyOneLeaseAndOneRun`；`QueuedRevocationAtEveryAuthorizationGateRejectsUnverifiedDispatchOrResult` |
| 验证 | 上述 `dotnet test`、`dotnet build --no-incremental`、测试发现命令；`npm run verify`，全部成功 |

补充旧合同回归：`GlobalFiftyLeaseLimitIsAtomicAcrossContextsAndRejectedAttemptDoesNotSpend`、
`CommittedConsentFenceMasksCompletedResultsAndRejectsAdmissionAndLateCompletionBeforeCleanup`、
`LeaseRecoveryIsBoundedAndOldWorkerCannotPublishAfterReplacement`、
`LegacyExchangeRemainsUnchangedThroughCompletionAndExpiresExactlyAtSevenDays`。

交叉审查还补充了 `EnsureCurrentRechecksFamilyGrantAndHistoryInTheSameDbContext`：
同一数据库上下文中，先成功检查，再独立撤销家庭权限或更换历史版本，必须立即拒绝
继续；拒绝不能来自租约到期，也不能修改任务输入、状态或租约。

验收不是绝无回归的保证。尚未测量线上 P50/P95、锁等待、SQL log-write 的改善，
也未完成真实双手机保存→同步／AI 切出恢复验收。外部 Directory 往返、模型延迟、
全量家庭数据和失败退避仍可能影响速度，不将其未经测量地宣称为已解决。

## 后续发布

这是后端兼容改动，本身不需要新的原生构建。另有未发布的前端工作不能混入本次
修复包。未来得到部署指令后，按 runbook 冻结准确差异、检查实际云端配置与目标、
运行 CI／catalog no-op 验证；全部新实例上线后再做签入 SQL 和设备验收。
