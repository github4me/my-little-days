# 七天规律优先：AI Prompt 更新

状态：本地实现，未部署、未发布 TestFlight。实际英文指令位于
[RemainingDayInstructions](../server/LittleDays.FamilyApi/SleepAiService.cs)。
仅改变新协议 schema 3；旧版 schema 1/2 路径保留。

## 执行顺序

### 1. 必须先总结不含今天的过去七天规律

先在内部完成历史总结，再预测或根据今天的记录调整。历史基线为
`[historyStart, todayStart)`，即前七个完整本地日期，不是向前滚动 168 小时。

逐日观察并比较：

- 前夜总睡眠时长，以及最长连续睡眠。约 19:00 是观察夜间睡眠的参考，不是强制入睡点。
- 白天总睡眠时长。
- 白天小睡次数。
- 白天小睡的大致时间分布，以及睡醒至下一次入睡的间隔规律。

优先识别多天共同出现的模式及正常波动，不由某一天或最新一条记录决定安排。
缺失记录不算零睡眠，重叠记录不重复累计；不完整夜晚不冒充完整夜晚。
跨过今天零点的睡眠，其今天部分不计入历史基线；今天的前夜及当前状态在下一步对比。

### 2. 再对比今天的实际记录

以七天共性为主要推测依据，对比今天的睡眠次数、时长、间隔及当前睡眠状态，
只根据已发生的偏差适度调整。不能为符合历史规律而否认今天真实发生的睡眠。
年龄及原有年龄特点参考继续作为辅助，不使用固定月龄模板替代个人规律。

最终只输出：

- 从现在到下一个当地 00:00 的预计睡眠时段。
- 各时段开始前可开始哄睡的时间窗口。

历史总结只用于生成结果，不增加输出字段、解释文字或本机预测。
没有足够历史时使用真实可用部分，不虚称已有七天规律，也不为了填满日程而编造时间。

## 数据边界同步

例如今天为 10 月 18 日，基线是当地 **10 月 11 日 00:00 至 10 月 18 日 00:00**；
今天 00:00 至请求当前时间的记录另作当前情况比较。客户端筛选与服务器验证使用相同
日历边界，并考虑夏令时，七个完整日期不一定恰好为 168 小时。
保留跨边界记录的原始起止时间，记录本身不被裁剪或更改。

现有英文、简体和繁体说明中的数据范围已同步。没有新增弹窗、改动授权流程、
修改输出字段、模型、超时、频率或保留期限。

## 评估后合并的精确化规则

- 根据多日真实规律识别夜间范围；分别计算范围内各段的总睡眠，以及最长连续一段。
  不把最长一段等同整夜，不自动把最后一次白天小睡当作夜间主睡眠。
- 各指标分别判断记录可用性。白天不完整不能当作完整总量或总次数，但可靠的小睡
  时间与完整清醒间隔仍可参考；可用的前夜记录独立保留。低总量或少次数本身不证明漏记。
- 新记录与 `previousEstimate` 冲突时丢弃矛盾部分，旧预测不是已发生的事实。
- `currentMinute` 明确定义为请求 `now` 向下取整到当前分钟。普通未来时段要求
  `currentMinute <= sootheStart < sootheEnd <= sleepStart < sleepEnd <= todayEnd`，
  同时 `sleepEnd` 必须严格晚于未取整的 `now`。不再同时要求矛盾的严格 `now <= sootheStart`。
- 仅在既无可用时间锚点、也无重复规律时返回 `insufficient_data`，不因缺少任一项而拒绝。
- 本地钟点及日期边界按 IANA 时区解释；允许对应正确偏移或等价 UTC `Z`，
  保持前后端已有时间格式兼容，不增加按字符串偏移机械拒绝的规则。

同样的分钟边界、数据不足和时区表述已同步到 v3 JSON schema 描述。字段结构与
前后端运行时校验不变；不增加本机预测、内部总结输出或 UI 提示。
本轮验证见 [合并验证记录](AI-PROMPT-MERGE-2026-10-18.md)。

## 验证

- 相关后端测试：130 通过，0 失败，0 跳过。
- 完整后端回归：API 636 通过、141 项 SQL 测试跳过；迁移器 29 通过、39 项 SQL 测试跳过；0 失败。
- 客户端 AI 输入/输出测试：26 通过，0 失败，0 跳过。
- 非增量 Release 构建成功：0 警告、0 错误；`git diff --check` 通过。
- 最新 Web 导出上的隐私说明检查通过：5 组语言/外观/屏幕尺寸组合，所有网络均被测试拦截。
- `npm run verify` 最终完整重跑通过：类型检查及 14 组配置测试全部通过，其中 `src/*.test.ts` 为 692 通过、0 失败、0 跳过；旧范围文字的测试断言已同步。
- AI 组件浏览器测试：70 通过，含英文、简繁及其余语言回退的说明文字，0 失败。
- 提示词测试检查实际发送的系统消息及首次/重试路径，不能证明真实模型一定遵循分析顺序。
- 本次没有调用真实 AI、访问生产 SQL 或更改线上服务。

| Requirement | Evidence |
| --- | --- |
| “除今天以外的过去七天” | `HistoryUsesSevenCompleteLocalDaysExcludingTodayAcrossDst`；`AI input includes seven complete local days plus today across the DST-forward week and preserves cutoff sleep endpoints`，另含 ordinary / DST-backward 分组。 |
| “先总结过去七天规律（必须先完成这一步再做推测）” | `RemainingDayPromptSummarizesSevenDayPatternBeforeAdjustingToday` 验证两步顺序及全部总结指标。 |
| “推测时优先参考七天共性，再结合今天已发生的偏差进行微调。不要过度依赖单日数据。” | `RemainingDayPromptSummarizesSevenDayPatternBeforeAdjustingToday` 验证历史优先、今天微调、不依赖单日及只返回剩余预测的指令。 |

命令：

```sh
env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --no-restore --filter 'FullyQualifiedName~SleepAiRemainingDayTests|FullyQualifiedName~SleepAiRemainingDaySchemaTests|FullyQualifiedName~SleepAiWholeDayTests' --logger 'console;verbosity=minimal'
env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.slnx --configuration Release --no-restore --logger 'console;verbosity=quiet'
node --import tsx --test src/aiSleep.test.ts
/Users/chao/Applications/.dotnet/dotnet build server/LittleDays.slnx --configuration Release --no-restore --no-incremental
env CI=1 ./node_modules/.bin/expo export --platform web --output-dir .git/testagent/seven-complete-days/web
env BROWSER_EXPORT_DIR=.git/testagent/seven-complete-days/web PRIVACY_REVIEW_DIR=.git/testagent/seven-complete-days/privacy node tests/privacy-links-browser.mjs
npm run verify
env AI_SLEEP_SCREENSHOTS=.git/testagent/seven-complete-days/ai-sleep node tests/ai-sleep-browser.mjs
```
