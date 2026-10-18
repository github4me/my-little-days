# AI 剩余当日预测：结果输出 Schema

## 实际发送给 AI 的定义

[sleep-prediction-remaining-day-v3.schema.json](../server/LittleDays.FamilyApi/Schemas/sleep-prediction-remaining-day-v3.schema.json)
是唯一源文件，作为 API 的嵌入资源读取。Schema 3 的首次请求和格式失败重试均通过
Responses API 的 `text.format` 发送它，并设置 `type: json_schema`、`strict: true`。
不是只在提示词里要求“返回 JSON”。Schema 1、2 保持原有路径。

使用当前 SDK 的原始 Responses 选项，避免通用适配器规范化 schema 时遗漏
`maxItems` 等约束。测试截获实际序列化的 HTTP 请求并比较完整 schema，未访问真实服务。

## Schema 直接限制

- 根对象只有必填的 `status`、`periods`；禁止额外字段。
- `status` 只有 `ready`、`insufficient_data`。
- `periods` 为 0–24 个时段。
- 每段必须包含 `sleepStart`、`sleepEnd`、`sootheStart`、`sootheEnd`。
- 时间使用包含日期和时区偏移的 ISO 8601 格式。建议秒写 `00`，精确到分钟即可；
  仍兼容秒和最多七位小数，不改变现有分钟级校验。
- 通过两个 `anyOf` 分支，哄睡时间必须**同时为时间字符串或同时为 null**，
  不能漏字段，也不能只给一个时间。

普通未来睡眠示例（合成数据）：

```json
{
  "status": "ready",
  "periods": [
    {
      "sleepStart": "2026-10-18T20:30:00+11:00",
      "sleepEnd": "2026-10-19T00:00:00+11:00",
      "sootheStart": "2026-10-18T20:20:00+11:00",
      "sootheEnd": "2026-10-18T20:25:00+11:00"
    }
  ]
}
```

## 仍由服务器校验的语义

JSON Schema 约束格式，不保证预测正确，也不能代替相对请求时间的比较。
Schema 中的说明与现有提示词会告诉 AI 以下规则，服务器继续独立校验：

- 预测范围仅为请求当前分钟至下一个当地午夜，结束时间必须晚于请求当前时间。
- 普通未来时段满足：当前分钟 ≤ 哄睡开始 < 哄睡结束 ≤ 入睡 < 睡醒 ≤ 午夜。
- 各段按时间排序且不重叠；下一段哄睡不能早于上一段睡眠结束。
- 哄睡开始到预计入睡最多四小时（格式上限，不是建议的哄睡时长）。
- 两个哄睡字段为 null 只允许第一段，且必须有正在睡眠的记录作为依据；
  该段从请求当前分钟开始，只预测剩余部分。
- `insufficient_data` 必须配空数组。`ready` 可以配空数组，不强行编造时段。

2026-10-18 合并精确化：schema 描述明确当前分钟是 `now` 向下取整的分钟起点，
结束仍严格晚于原始 `now`；数据不足是既无时间锚点也无重复规律。
本地边界遵循 IANA 时区，时间戳允许正确本地偏移或等价 UTC `Z`。
仅更新描述，不改变输出字段、JSON schema 结构限制或前后端运行时校验。

已记录睡眠仍以数据库为准，不要求 AI 重复输出。失败原因和字段继续使用现有校验日志。

使用的对象、必填字段、`anyOf`、`$defs`/`$ref`、日期格式、正则和数组数量限制，
参考 [OpenAI Structured Outputs 官方文档](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)。
尚未对线上模型发起请求；离线请求序列化测试不能替代真实服务验收。

## 验证与发布范围

专用测试命令：

```sh
env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --no-restore --filter FullyQualifiedName~SleepAiRemainingDaySchemaTests --logger 'console;verbosity=normal'
```

15 项通过，0 失败，0 跳过；使用合成记录和 HTTP 拦截，不发送真实宝宝记录、不调用付费模型。

完整回归命令：

```sh
env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.slnx --configuration Release --no-restore --logger 'console;verbosity=minimal'
```

API：630 通过、0 失败、141 项 SQL 测试跳过；数据库迁移器：29 通过、0 失败、
39 项 SQL 测试跳过。本次未连接 SQL，不代表数据库集成已验收。

最后执行 `dotnet build server/LittleDays.slnx --configuration Release --no-restore --no-incremental`：
构建成功，0 警告、0 错误。`git diff --check` 通过。独立静态审查未发现阻断问题；
未进行实际变异测试或覆盖率测量。

| Requirement | Evidence |
| --- | --- |
| “能做一份结果输出 schema给ai 以保证校验准确度吗” | `RemainingDayWirePreservesExactStrictSchemaAndPrivacyOptions` 验证首次与重试实际发出的完整严格 schema；`RemainingDaySchemaRequiresCompleteSettlingPairsWithoutChangingResponseFields` 验证字段及哄睡成对规则；`RemainingDayTimestampSchemaRejectsAmbiguousOrUnsupportedRepresentations` 验证时间格式边界。 |

本次仅本地实现，未部署后端，未发布 TestFlight。未修改 UI、模型、速率限制、超时或数据保留设置。
