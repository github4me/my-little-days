# AI prompt 合并与前后端契约核对

本地实现及自动化验证完成。后续部署与 TestFlight77 上传已执行，处理状态见
[发布记录](AI-REMAINING-DAY-TESTFLIGHT-2026-10-18.md)。

## 范围

合并已评估的 v3 prompt 修订，保留七个完整本地日期（不含今天）优先、今天微调、
仅返回当前至当地午夜预测。年龄参考原文不变。

- [实际英文 prompt](../server/LittleDays.FamilyApi/SleepAiService.cs) 的 `RemainingDayInstructions`。
- [实际发送的 schema](../server/LittleDays.FamilyApi/Schemas/sleep-prediction-remaining-day-v3.schema.json)。
- [规则说明](AI-SEVEN-DAY-PROMPT-2026-10-18.md)。

未改模型、输出字段、v1/v2、授权流程、频率、超时、数据库、异步工作流或 UI。
前端不新增预测逻辑；其运行时校验本已与后端一致。

## 契约核对

| 契约 | 前后端共同约束 |
| --- | --- |
| 历史范围 | `[historyStart,todayStart)` 是前七个完整本地日期，今天另作上下文；包含夏令时边界。 |
| 输出范围 | 从请求当前分钟起至下一个当地午夜；睡眠结束严格晚于原始 `now`。 |
| 哄睡 | 普通预测必须有成对且非零长度的哄睡范围；不得晚于入睡或与上一段睡眠重叠。 |
| 正在睡眠 | 仅第一段允许两个哄睡字段都为 null，且有正在睡眠的记录并从请求当前分钟预测剩余部分。 |
| 时间格式 | 正确本地偏移和等价 UTC `Z` 均可；本地日期边界按传入 IANA 时区解释。 |
| 旧预测 | 只作为有边界的历史猜测；不改变数据库记录，不回传已记录睡眠。 |
| 异步恢复 | 继续使用原任务的 `requestNow` 校验，而不是切回 App 后的轮询时间。 |

## 验证边界

使用合成记录、伪造 provider/HTTP 响应和拦截网络的浏览器。未发送真实宝宝数据、
未调用真实模型、未访问生产 SQL。自动化测试验证指令发送及传输/校验/渲染兼容，
不证明模型内部必然按顺序统计，也不证明实际预测准确率。物理设备及线上模型验收未执行。

## 本轮验证结果

- 后端专用 remaining-day/prompt/schema 测试：Passed: 50, Failed: 0, Skipped: 0。
- 后端完整回归：API Passed: 641, Failed: 0, Skipped: 141；迁移器 Passed: 29,
  Failed: 0, Skipped: 39。SQL 用例未连接数据库而跳过，不算数据库验收通过。
- 客户端输入/输出专项：27 通过、0 失败；新增 UTC `Z` / 本地偏移相同边界回归。
- `npm run verify` 完整退出 0：类型检查与全部配置测试通过；`src/*.test.ts`
  为 693 通过、0 失败、0 跳过。
- AI 组件浏览器 70 项、完整 App 浏览器 4 项通过；包含历史范围、保存记录独立显示、
  durable job 重连，以及中英／外观／屏幕尺寸场景。浏览器网络全部拦截。
- 完整 App 测试首次发现旧的 rolling-seven-day 断言；已将对应合成记录和断言同步为
  七个完整本地日期，明确验证最早一天上午保留、跨边界原始端点保留、边界前记录排除、
  边界时刻喂奶保留，完整重跑通过。
- 非增量 Release 构建成功：0 Warning(s), 0 Error(s)。`npm run format` 无额外格式改动，
  `git diff --check` 通过。

| Requirement | Evidence |
| --- | --- |
| “合并” | `RemainingDayPromptSummarizesSevenDayPatternBeforeAdjustingToday` 验证历史顺序、夜间总量与最长连续段独立、逐指标数据可靠性；`RemainingDayPromptAlignsPriorEstimateEvidenceMinuteFloorAndTimezoneOnFirstAndRetry` 验证首次／重试实际消息中的旧预测、分钟、时区及数据不足规则。 |
| “保证前后端一致可用” | `RemainingDaySchemaDescriptionsMatchPromptMinuteFloorInsufficientEvidenceAndTimezoneRules`；`RemainingDayMinuteFloorAndExactFutureEndUseEquivalentLocalAndUtcInstants`；`AI equivalent UTC and local-offset forecasts share minute-start and exact-now end boundaries`；完整 App 场景 `full-app-future-only-ai-keeps-saved-records-and-durable-reconnect`。证据限上述本地合成自动化，不声称真实模型／生产环境已验收。 |

成功命令（均退出 0）：

```sh
env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --filter 'FullyQualifiedName~LittleDays.FamilyApi.Tests.SleepAiRemainingDayTests|FullyQualifiedName~LittleDays.FamilyApi.Tests.SleepAiRemainingDaySchemaTests' --no-restore --verbosity minimal
env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.slnx --configuration Release --no-restore --logger 'console;verbosity=quiet'
node --import tsx --test src/aiSleep.test.ts
npm run verify
npm run format
env CI=1 EXPO_NO_DOTENV=1 EXPO_PUBLIC_FAMILY_API_URL= EXPO_PUBLIC_ENTRA_CLIENT_ID= EXPO_PUBLIC_ENTRA_TENANT_ID= EXPO_PUBLIC_ENTRA_API_SCOPE= EXPO_PUBLIC_FAMILY_UI_DEMO=0 ./node_modules/.bin/expo export --platform web --output-dir .git/testagent/prompt-merge/web
env AI_SLEEP_SCREENSHOTS=.git/testagent/prompt-merge/components node tests/ai-sleep-browser.mjs
env SLEEP_WEB_ROOT=.git/testagent/prompt-merge/web AI_SLEEP_APP_SCREENSHOTS=.git/testagent/prompt-merge/app node tests/ai-sleep-app-browser.mjs
/Users/chao/Applications/.dotnet/dotnet build server/LittleDays.slnx --configuration Release --no-restore --no-incremental
git diff --check
```
