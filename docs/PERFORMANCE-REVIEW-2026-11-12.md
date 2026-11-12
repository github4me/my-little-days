# Logging 与性能瓶颈复查 — 2026-11-12

后续进展：用户随后批准缩小锁和停止正文采集；见
[本地实现及回归记录](AI-SCOPED-LOCK-METADATA-FIX-2026-11-12.md)。下文保留改动前的诊断，
不应将其中的 capture / FindAsync 行为当作后续实现后的代码，也不代表线上已部署。

## 结论与证据边界

以前确实加了多层诊断。应区分轻量的耗时日志和写入 SQL 的完整 AI 请求／响应采集：后者位于实际请求等待路径，不能视作无开销的后台日志。

本次只检查工作区源码和已有部署／事故记录，没有修改运行代码、生产配置、数据或部署，也没有运行生产负载测试。Azure 实时日志入口因浏览器控制连接错误未能打开，未取得今天的延迟分布、配置或实际部署版本。以下“当前代码”不等于已重新核实的线上状态。

历史实测显示，之前最明确的瓶颈是数据库锁等待及事务日志写入压力，而不是 CPU。对当前剩余问题的排序是调查优先级，不是实测占比或性能提升承诺。

## 已有 logging

| 类型 | 当前源码行为 | 性能含义 |
| --- | --- | --- |
| AI 阶段计时 `SleepAiTiming` | 入队、领取、排队、权限、额度、Provider、校验、保存、总耗时、轮询和撤销；只记固定元数据 | 有价值；空队列领取不输出日志，未发现其本身造成秒级延迟的证据 |
| 家庭同步 `Family sync` / `Server-Timing` | Me、全量／睡眠喂奶快照、记录写入：身份服务、SQL、锁、事务、序列化、响应总耗时 | 每请求聚合，诊断对象及其内存锁是 request-scoped，不是全用户锁 |
| 手机 console | `[family-request]` token/API、`[family-api-timing]`、`[family-sync]` 本地等待／持久化／总耗时；无开发环境条件开关 | 可以评估采样，当前没有证据表明这些小对象输出是主要瓶颈，也没有证明它们自动上传到集中日志 |
| SQL 完整 AI 交换采集 | 每次 provider attempt 发送前和响应后分别等待保存；请求／响应各保留有界内容，7 天 TTL | 会增加 SQL 查询、写入、删除和 AI 锁竞争；与普通日志不同 |
| SQL 失败输出采集 | 任务完成后另一次事务记录失败原因、字段及有界输出；7 天 TTL | 不回滚已提交的任务结果，但仍占用资源和 worker 收尾时间 |

配置依据：`appsettings.json:2` 默认 Warning、AI diagnostics Information；`Program.cs:14` 禁止 EF 常规 SQL 日志，`:29` 显式开启家庭计时；`SleepAiService.cs:554` 关闭 SDK 内容日志。不能把配置文件中未覆盖的默认值当作已核实的 Azure 环境值。

## 历史实测：不是今天的性能样本

2026-10-29 的只读诊断保存于 [SYNC-REQUEST-AUDIT-2026-10-29.md](SYNC-REQUEST-AUDIT-2026-10-29.md:92)：

| 操作 | 总耗时 | 全局锁等待 | 结果 |
| --- | --- | --- | --- |
| RecordWrite，19:02:02 Melbourne | 10.43 秒 | 10.05 秒 | 503 |
| SleepFeedSnapshot，19:02:43 | 10.10 秒 | 10.01 秒 | 503 |
| FullSnapshot，19:03:17 | 10.10 秒 | 10.01 秒 | 503 |

这些失败尚未进入家庭记录读写，等待已消耗约 96%–99% 的响应时间。同窗口 SQL log-write 利用率峰值 97.10%／100%，CPU 峰值低于 9%，data IO 为 0%。这里的 log-write 是数据库事务日志，不是 `console.log` 或 `ILogger` 文本文件。

同次数据库元数据样本：AI exchanges 313 行、45,712 KiB reserved；失败输出 19 行、200 KiB reserved。Reserved 是表分配量，不等于每次请求大小或精确写入量。没有捕获当时的实际锁持有者，不能断言某条 capture/delete 就是唯一根因。

10 月 29 日发布 `4699aece` 已把 AI 状态操作从家庭全局 Exclusive 拆到 AI Exclusive + 家庭 Shared，并拆分保留期清理事务。10 月 31 日发布 `42ca16a9` 又把 consent 撤销改为先提交撤销标记，再逐行清理并保留已提交进度。见 [AI-FAMILY-LOCK-FIX-2026-10-29.md](AI-FAMILY-LOCK-FIX-2026-10-29.md)、[AI-REVOCATION-RECOVERY-2026-10-31.md](AI-REVOCATION-RECOVERY-2026-10-31.md)。

10 月 31 日修复前仍有约 10 秒 AI Claim 数据库错误；30 分钟样本 log-write 峰值 89.55%、CPU 5.32%。这些旧峰值不能证明今天持续饱和，也不足以决定升级付费 SQL 档位。发布记录未完成真实手机成功启用／双手机同步延迟验收。

## 扫描执行清单（分类前）

使用 `.NET analyzing-dotnet-performance` 技能作 critical-only 检查。固定 12 文件：FamilyService、FullFamilyService、FamilySyncDiagnostics、GraphAdmissionTokens、SleepAiService、SleepAiJobStore、SleepAiAttemptStore、SleepAiJobWorker、SleepAiExchangeCapture、SleepAiFailureCapture、SleepAiDiagnostics、Program；另按调用链检查 PublicIdentityAdmission、FamilyAvailability 和手机同步／AI coordinator。

以下是固定 12 文件中的语法匹配数，不等同于缺陷数：

| 配方／检查 | 匹配数与复核 |
| --- | --- |
| 字面量 IndexOf 未指定比较／Substring／字面量 StartsWith、EndsWith／字面量 Contains | 0／0／0／0 |
| `.Result`／`GetAwaiter().GetResult()`／`Thread.Sleep` | 0／0／0 |
| `.Wait(` | 1：`SemaphoreSlim.Wait(0)`，立即返回，不是阻塞等待 |
| ValueTask | 7：拦截器返回值及 lease dispose；未发现重复 await 同一实例 |
| stackalloc／new byte[]／string.Format／ToCharArray | 0／1／0／0；byte 数组为版本校验的 8 字节，不列为瓶颈 |
| Regex 调用 | 4：配置、固定 request-id／model／字段元数据检查；未发现嵌套量词灾难性回溯模式 |
| ContainsKey | 1：额度容量条件；不是 ContainsKey 后重复 indexer 取同值的模式 |
| JsonSerializer 调用／JsonSerializerOptions 声明 | 12／1；复核所用 Json、SleepAiJson.Options 均为静态复用；未发现每请求创建 options |
| HttpClient 构造候选 | 3：包含 2 个名称误匹配和 1 个真实 scoped wrapper；真实 wrapper 的内层 transport 由 factory 池化，不是每请求新建 socket 池 |
| SQL app-lock／monitor lock／SemaphoreSlim 声明 | 3／11／1；按 SQL 全局／家庭和 request／process 区分，不能相加为用户人数限制 |
| class 声明（含 partial 的重复声明） | 33：30 sealed、2 static、1 非 sealed Program 测试入口；没有系统性未密封类问题 |

人工复核：未发现热路径循环字符串拼接、stackalloc 循环或重复枚举数据库 IEnumerable 的确定缺陷。全量快照确有多次扫描已物化 records、JSON 解析及预算序列化；其重要性在于数据规模和持锁时长，见下文，不把普通 LINQ 自动定为严重问题。未进行微基准或端到端压测。

## 当前代码中应优先核实的 5 项

### 1. 完整 AI 采集与 AI 状态读写共用排他锁（1 条关键路径，较高优先级）

**影响：** `await capture.Save` 位于真正 HTTP 发送前和结果返回前，正常一次 attempt 有 2 次保存等待，每次配置 5 秒取消期限；这不是 5 秒固定延迟或绝对硬上限。保存使用全局 AI SQL 锁，与领取、额度、查询、完成、撤销竞争，较慢写入会拖慢其他 AI 请求。模型网络推理本身不持有 SQL 锁。

**位置：** `server/LittleDays.FamilyApi/SleepAiExchangeCapture.cs:72,103,114`；`SleepAiJobStore.cs:276`；`FamilyService.cs:29`。

**建议：** 先分别量化 capture begin/end、AI 锁等待和 SQL commit；再设计持久化采集队列／独立写入通道，保留 7 天清理、撤销隔离、故障恢复和采集缺口标记。不能直接 fire-and-forget 并宣称完整采集，不建议先一刀切删除诊断。

### 2. 高频 API 请求重复做两次串行身份服务查询（1 个公共入口，较高优先级）

**影响：** Directory 模式下每次 `/v1`／`/v2` admitted 请求都查询账户及邮箱唯一性。包括无变化的 304 和 AI GET 轮询；只缓存应用 token，不缓存用户准入结果。因此每次刷新都依赖两次外部网络往返，SQL 很快也不等于整条 API 快。

**位置：** `server/LittleDays.FamilyApi/PublicIdentityAdmission.cs:119`；`Program.cs:214`。

**建议：** 先分析现有 directory_lookup／directory_uniqueness 分布，合并同一轮重复请求；同账户同时在途的验证可评估安全合并。任何短期准入缓存都必须明确账户禁用／删除的失效语义，不能简单取消权威检查或把 token 有效当作账户仍可访问。

### 3. 查询状态不够轻，轮询同时制造固定负载与可见延迟（手机及 worker 两处）

**影响：** 手机仅前台 loading 时，在上次请求结束后再等 4 秒；worker 空队列时约每 5 秒取一次任务。后者即便没输出日志，也会进 AI SQL 事务。Get 使用 `FindAsync` 读取完整 job，包括运行中无需展示的 RequestJson，再占用同一 AI 排他锁。

例如仅作容量推算：50 台前台手机同时等待结果、忽略网络耗时，最多约 750 次状态查询／分钟，Directory 模式对应约 1,500 次身份查询／分钟；这不是当前真实流量。单 worker 一直空闲且 AI 启用，忽略查询耗时，上限约 17,280 次空队列检查／天。低流量时也存在固定数据库开销。

**位置：** `src/aiSleepJobs.ts:4`；`src/aiSleepJobCoordinator.ts:106`；`server/LittleDays.FamilyApi/SleepAiJobWorker.cs:151`；`SleepAiJobStore.cs:79`。

**建议：** 状态读取改为最小投影；在保留撤销／到期／恢复边界的前提下，评估将纯读与额度及写入锁拆开；worker 采用可唤醒队列或有上限的空闲退避。不要直接把手机间隔改短，增加请求不一定使结果更快。

### 4. 家庭数据读取和失败退避放大用户看到的等待（1 条同步路径）

**影响：** 正常前台自动同步在成功后 30 秒才再次允许发起，由 5 秒本地 timer 检查；不是实时推送。自动同步仍是有 ETag 的全工作区读取，变化后重新下载全量。睡眠／喂奶手动刷新只筛记录类型，但不是只取当天或增量，且预算检查位于 304 判断前。完整读取／写入预算可能扫描全家记录并做编码计算，在家庭锁内增加工作。失败退避为 30／60／120／240／300 秒，服务短暂故障后用户可能继续看到数分钟等待。

**位置：** `src/family/useFamilyPilot.ts:1575,1632,1995`；`server/LittleDays.FamilyApi/FullFamilyService.cs:105,323,356`；`FamilyAvailability.cs:42`。

**建议：** 分别统计 SQL、family_lock、本地 persist 和等待队列；设计版本化增量同步、原子维护的容量计数及安全的重连立即重试，保留全量恢复路径、权威访问检查、最后服务器保存胜出和首次删除胜出。不能移除大小限制或无界并发重试。

### 5. 日志虽多，AI 耗时边界仍有盲点（3 个边界）

**影响：** `Provider` 包住 SDK call，因此包含请求／响应采集保存，不能直接认定全是模型推理；Enqueue／Poll 计时开始于 endpoint handler，之前的 Directory 准入不在这两个计时中；AI SQL 专用锁尚无独立等待阶段。可出现“Poll 很快但手机等很久”或“Provider 慢其实部分在等 SQL”的误判。

**位置：** `server/LittleDays.FamilyApi/SleepAiService.cs:272`；`SleepAiExchangeCapture.cs:103`；`SleepAiEndpoints.cs:11,22`；`FamilyService.cs:35`。

**建议：** 新增少量独立数值指标：AI HTTP 全程、directory 阶段、ai_lock_wait、capture_write、纯 provider transport/response、result_commit；结合已有手机 token/API/persist 耗时。按成功、错误、重试分组给出样本数、P50/P95，不直接相加相互包含的阶段。采集表的 DurationMs 从第一次保存后开始、第二次保存前结束，可辅助分析，但也包含响应读取，不是纯模型推理。

## 建议顺序与验收

1. 用新鲜的已有家庭计时和上述小范围 AI 计时补齐端到端样本；不需要扩大请求内容采集。
2. 优先处理关键路径的 payload SQL 保存、AI 状态读锁竞争及重复身份往返。
3. 再处理增量同步／容量统计、worker 空闲检查和安全退避恢复。
4. 验证真实双手机保存→可见时间、请求数、错误率以及 SQL log-write／锁等待。测试正确性和发布成功不能替代这些验收。

| 分类 | 数量 | 首要内容 |
| --- | --- | --- |
| 已证实的当前 Critical 代码缺陷 | 0 | 未发现 sync-over-async；无今天生产压测／锁持有者证据 |
| Moderate／需实测的热路径与可观测性问题 | 5 | 采集落库、身份往返、AI 轮询、同步数据量／退避、计时边界 |
| 单列 Info 微优化建议 | 0 | 不把 Regex、LINQ、8 字节数组等当作主要原因 |

这是 AI 辅助的有界源码审查，可能有漏报或误报；应通过新鲜运行指标、基准及人工复核确认后，再改生产关键路径。没有据此声称今天的 P95、实际人数容量或优化后的提升比例。
