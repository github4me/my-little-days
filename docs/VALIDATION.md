# 验证记录

## 本地 TestFlight build 46 · 2026-09-28（Apple 已处理，现有测试组可用）

- 将远端 `feature/family-invitations` 的 5 个提交与本机全部相关应用、Watch、测试和文档变更合并，发布源码提交 `dc15fb8cbbad78ba59ad2f8ea4781b840423a4c8`，Git tree `cce7be0a9ea60b8eef1d7e2243d2fdda9fde87d9`。保留本机 agent/Impeccable 配置，不作为产品源码发布。包含简化后的今日汇总标签、图表与录入改进、Watch 5 mL 档位及远端 Phone/Watch/Widget 语义图标；咖啡入口仍关闭。
- 合并后的 `npm run verify`、完整浏览器回归、Apple/UI 浏览器、睡眠图专项、Web 导出、Watch Swift 24 项与 Widget 模型 6 项通过。隔离源码 444 个文件逐一与提交 blob 对照，打包的 366 个文件与冻结源码一致，仅允许自动 build 号和原生生成脚本的已知改写。首次本地构建预检因归档缺少 `node_modules` 在 Xcode 前停止；在隔离源码 `npm ci` 后重新构建成功，未替换签名资源。
- 本机 EAS CLI 24.7.0 `--local --non-interactive --freeze-credentials --clear-cache` 使用生产环境、既有 Apple 团队与三个 Store profiles；没有 EAS 云构建或付费 Workflow。Xcode 26.5 归档、IPA 导出和 Phone/Watch/Widget 深签名通过；各目标 `0.2.1 (46)`，12 种语言、预期 App Group、production push、禁用 OTA 和 Apple Pay entitlement 状态正确。实际 Hermes 含已核对的 API/tenant/client/scope，demo `0`、咖啡关闭，三个目标的 dSYM UUID 均与导出二进制匹配。
- 2026-09-28 11:05:46 UTC，本机 `altool` 对 17,002,892 字节的 IPA 返回 **UPLOAD SUCCEEDED with no errors**，delivery UUID `99594bcc-404b-498f-b5e1-4c4ee5b99083`，SHA-256 `fa290558b3c42551f89cfe7a6a4c4c7be23ba669194b2074159f695652cf796c`。临时上传密钥与 EAS 临时签名 Keychain/导入 profiles 已删除，原有开发身份保留。11:06:55 UTC 的第一次 Apple readback 未列出 46；仍需核实处理状态和现有测试组，不能因此重复上传。
- 11:09:25 UTC 再次读取 Apple：应用 `6809826484` 的同一 build ID `99594bcc-404b-498f-b5e1-4c4ee5b99083` 为 `processingState=VALID`，内部与外部状态均为 `IN_BETA_TESTING`；现有 **Team (Expo)**、**Early Birds** 和 **Outside birds** 三组已关联 46。本轮未变更测试组或发起单独的外部审核，也没有重复上传。
- 保留 IPA、dSYM ZIP、检查、上传与构建日志于忽略的 `artifacts/`，Xcode Organizer 保留归档。iPhone 既有资料保留、真机 UI/VoiceOver/大字号、配对 Watch 5 mL 与同步、Widget 刷新均待独立验收；不能用签名或 Apple 上传结果代替。
- 校验保留的 IPA 哈希、dSYM、日志、源码清单、Xcode 归档和 Apple 状态后，仅删除了此次生成的隔离源码/构建及 IPA 解包临时目录，释放约 4.5 GB；未删除工作区原有文件或用户资料。仓库 build 号基线更新为 46，后续不得重用。

## 今日汇总标签简化 · 2026-09-27（源码变更，未发布）

- 根据真机截图反馈，去掉今日汇总中多余的「已记录／recorded」及「换／changes」措辞。保留三个数值和必要的单位/类别：中文「mL 奶量／小时 睡眠／次 尿布」，英文「mL milk／hours sleep／diapers」；全部 12 种语言同步简化。没有改变统计、原始记录、家庭同步、Watch/Widget 或按钮位置，也没有压缩字号或限制文字缩放。
- `npm run verify`、Web 导出、完整浏览器回归通过。专项浏览器检查确认 320 px 下全部 12 种语言标签单行且不裁切；另覆盖中文/英文明暗外观、768 px 德文及更高对比度，共 5 个完整 UI 场景。虚构数据不变、无外部请求；检查截图位于忽略的 `work/impeccable-fixes/`。
- 本轮未进行真机安装或原生 Dynamic Type/VoiceOver 验收，未 commit/push、新建签名构建或上传 TestFlight；已发布的 build 44 不包含这次简化。

## 本地 TestFlight build 44 · 2026-09-26（Apple 已处理，内部测试可用）

- 用户要求本次完成后上传 TestFlight。以基准提交 `38eeb4ee3cf83f63eb3396064ad6018faedb1e27` 加本次 UI/Watch 未提交修改，冻结 Git **tree** `11e68a7e3a9759436ef77f63a2ecc4fa1eaf947c`；443 个源码文件一致，未包含无关技能配置、工作目录、环境文件或密钥。它不是已提交/推送的 Git commit。本轮没有 GitHub 写入或新 CI 运行，也没有 API/SQL 部署。
- 隔离源码 `npm ci`、TypeScript 与 `npm run verify` 的 716 项测试通过；完整浏览器回归、Apple/UI 专项 10 场景及睡眠图 12 场景通过。Swift Watch 24 项、Widget 模型 6 项通过。只用虚构浏览器资料，不替代原生交互验收。
- Expo 生产配置和 Apple 现有应用确认无误：原项目、Store 分发、生产环境/频道、五项公共字段、demo `0`、OTA 关闭。Apple 最新已上传 build 43，选择新的 `0.2.1 (44)`；仅使用 EAS CLI 24.7.0 `--local --non-interactive --freeze-credentials --clear-cache`，未启动云构建、付费 Workflow 或云提交。归档输入 365 个打包源码文件与快照一致，只允许 build 号和 prebuild 两个启动脚本的预期变化。既有依赖维护告警仍在，未在冻结发布中升级依赖。
- 本地归档、导出及 IPA 深签名检查通过。Phone/Watch/Widget 各 `0.2.1 (44)`，原 Store profiles、团队、App Group、12 种语言、production push 和 Store/TestFlight entitlement 正确；没有 Apple Pay entitlement。实际 Hermes 内含正确 API/tenant/client/scope，咖啡关闭、OTA 关闭、runtime `0.2.1`。三个产品的 dSYM UUID 与导出二进制匹配。
- 2026-09-26 11:09:12 UTC，Apple 本地 `altool` 返回 **UPLOAD SUCCEEDED with no errors**，delivery UUID `b18e00e9-09e8-4577-a534-cd8954a45e11`，16,981,073 字节 IPA SHA-256 `3c59ebe9b96a1204166505f6d6ae6692e5af1022b96a23ba29403bbd0a824a96`。临时上传密钥文件已删除；EAS 已销毁临时签名 Keychain/导入的配置文件，现有开发身份保留。工作区 build 号基线更新为 44，避免下次误重用。
- 11:10:06 UTC 的首次 Apple readback 尚未列出 44；没有重复上传。11:12:11 UTC 再次确认同一 Apple build ID `b18e00e9-09e8-4577-a534-cd8954a45e11` 的 `processingState=VALID`、`internalBuildState=IN_BETA_TESTING`，现有内部组 **Team (Expo)** 和 **Early Birds** 可测试。外部状态 `READY_FOR_BETA_SUBMISSION`，未分配给 **Outside birds**，本轮没有提交外部 Beta App Review 或修改测试组。
- IPA、dSYM ZIP、检查、上传及 Apple 状态记录保存在忽略的 `artifacts/`；Xcode Organizer 保留对应 archive。真机加载/旧资料保留、原生草稿退出提示、键盘/VoiceOver/Dynamic Type、Watch 5 mL 与同步、Widget 刷新仍需独立确认；内部测试可用不等于这些交互已验收。

## 本地 Release 真机安装 · 2026-09-26（开发测试版，未发布）

- 用户解锁后，连接的 iPhone 11 / iOS 26.1、Developer Mode 和原有 Apple Development 签名可用。基于 `38eeb4ee3cf83f63eb3396064ad6018faedb1e27` 的当前未提交源码，非清空 prebuild 更新原生工程，`pod install --deployment` 及 Xcode 26.5 本地 Release 构建通过；Watch 的 5 mL 档位源码与生成副本一致。prebuild 自动改写的两个启动脚本已恢复，不影响此前测试脚本修改。
- Phone、嵌入的 Watch 和 Widget 均通过签名、原有 bundle ID、团队 `A9974KXQ4G`、版本 `0.2.1 (43)`、有效开发配置文件与当前设备、12 个语言资源检查。Phone/Widget 仍有原 App Group；没有 Apple Pay entitlement。内含 4,546,235 字节 Hermes JS，OTA 关闭；这是开发签名 `.app`，不是可上传 TestFlight 的 App Store IPA。
- 安装前拦截了错误构建：`CI=1` 下 Expo `export:embed` 跳过请求的缓存重置，复用了隔离导出时的空 API/认证转换。单独显式设置公共配置仍复用旧缓存。取消 `CI` 并显式注入既有五个公共字段、关闭 dotenv 和限定 2 个打包 worker 后重新构建，实际中间 JS 和签名 Hermes 包均包含预期 API URL、tenant/client/scope；错误产物没有安装。经验已补入 `PROJECT-LESSONS.md`，操作及证据见运行手册。
- `devicectl` 通过原 bundle ID 原地覆盖安装；未卸载、清空资料或读取家庭记录。2026-09-26 10:46:22 UTC 启动命令成功，设备报告 `0.2.1 (43)`，约 23 秒后相同应用进程仍在。没有启动此项目的 Metro，也未停止其他项目占用的 8081 服务。
- **尚需用户真机确认**：实际界面是否正确加载及旧资料是否保留；退出修改草稿的原生提示/VoiceOver 焦点、键盘、系统大字号、中文/英文、明暗图表；配对 Watch 的安装与 5 mL 选择、同步及 Widget 刷新。进程启动和嵌入目标签名不能代替这些验收。本轮未使用 Simulator、提交 Git、推送、上传 TestFlight 或使用 EAS 云构建。

## Impeccable 审查建议修复 · 2026-09-26（源码变更，未发布）

- 记录编辑器只在实际修改后询问「继续编辑／放弃修改」；iOS/Android 使用原生 alert，网页使用浏览器确认。奶量、备注、类型、起止时间、测量和里程碑字段都受保护，未完成或无效的输入也不会因退出检查而被解析或清空。未修改或完全还原的表单直接关闭；返回/读屏退出先取消顶层日期选择，保存期间不能退出，保存失败保留输入。重复退出和旧 alert 的延迟回调不会覆盖新的退出决定。没有新增草稿持久化或家庭资料副本。
- 奶种明确显示「瓶喂母乳／Expressed milk」，不再把它泛称为「瓶喂／Bottle」。今日汇总各语言明确是「已记录」的数据；说明字号由 10 提高至 11。新增或修订的退出提示、奶种、汇总和简短图例均覆盖全部 12 个语言。
- 汇总柱增加随增强对比度调整的轮廓；睡眠、汇总和成长 SVG 使用平台系统字体。汇总及成长标签按文字比例放大，画布同时扩展高度/宽度，必要时只让图表横向滚动，不能缩小或裁切标签。WHO 参考线保留实线/虚线区分并提高对比度。相邻喂奶数值标签错层并用引导线连接，柱的时间位置、实际奶量及所有统计值不变。
- 六种统计范围改成换行展示，长范围不再隐藏在没有提示的横向滚动区域。压缩睡眠图上方新增「断线＝高度压缩；以标签时长为准」的简短图例，下方详细说明、真实时长和时间锚点保留。记录及成长列表的编辑/删除读屏名称加入日期、时间，记录页有结束时间时也包含时间范围。紧凑卡片、原按钮位置、历史分页、隐藏咖啡入口与 Watch 5 mL 档位保持不变。
- `npm run verify`：716 项测试、TypeScript 检查通过；完整 `npm run test:browser` 通过。`npm run test:apple-browser` 的原有 6 场景及新增 4 场景通过，新增覆盖 320/375/390/768 px、简中/英文/德文、明暗及增强对比度；确认全部统计范围可见、SVG 系统字体/边界、相邻奶量标签不重叠、记录原值不变。`npm run test:sleep-chart` 12 场景通过。独立几何/组件测试覆盖 2/3/4 倍文字及原生 alert 的取消、放弃、重复退出、延迟回调与保存失败。浏览器仅用虚构本机数据，未尝试外部请求。
- Web、iOS/Hermes 导出及 `git diff --check` 通过；导出使用关闭 dotenv、空 API/认证公共配置的隔离验证环境，不是发布 IPA。Impeccable 对四个已修改主界面文件的检测退出 0，无主要告警；这不是原生可访问性认证。复核浏览器图保存在 `work/impeccable-fixes/`、`work/apple-guidance-review/` 与 `work/sleep-chart-review/`，不作为真机截图。
- **尚未完成**：原生 alert 的 VoiceOver/焦点、系统 Dynamic Type、键盘打开后的完整录入和图表字体度量仍需 iPhone/iPad 验收。配对 iPhone 11 的 lockState 检查显示仍锁定；本次没有使用 Simulator、安装/卸载应用、修改真实家庭数据、签名构建、提交 Git 或上传 TestFlight。

## 每日睡眠柱状图自适应 · 2026-09-26（源码变更，未发布）

- 只调整记录页展开后的每日睡眠图；喂奶、尿布、范围汇总及原始记录不变。至少有 3 个有效正时长时，超过中位数 2.5 倍的柱以其他非长柱时长的平均高度显示；用蓝色轮廓与断线明确标记，标签仍显示真实的当日片段时长。单条、两条及相近时长保持原比例。
- 相邻柱分别显示，交替使用睡眠色系，标签错层并用引导线连接。底部标记保留本日片段的实际时间位置；跨午夜记录的整段时长仍可在明细查看。密集记录与大字号扩展图表高度，必要时仅图表横向滚动，不缩小文字或合并记录。
- 两条显示说明已覆盖全部 12 个语言；深浅色及增强对比度的柱轮廓通过对比度检查。没有改动 API、SQL、Watch/Widget 数据或咖啡功能开关。
- `npm run verify`、`npm run test:browser`、`npm run test:sleep-chart` 通过。专用浏览器检查覆盖 320/390/768 px × 中英文 × 深浅色，共 12 组，仅使用虚构数据且拦截外部请求；确认标签与柱无重叠/裁切、9 条记录原值未变、重叠时间去重后的每日总量仍为 14 小时 44 分。几何测试另外覆盖 24/48/96 点标签、同起点、午夜边界、无效数字与冻结输入。
- web 与 iOS/Hermes 导出通过（关闭 dotenv、空 API/认证公共配置的隔离验证产物；不是发布候选 IPA）。浏览器图在 `work/sleep-chart-review/`，不作为 iOS 真机验收证据。
- **尚未完成**：iPhone 原生 SVG 字体度量、VoiceOver、实际系统大字号验收。已配对的 iPhone 11 当时锁定，未安装、卸载或清空应用；现有 8081 Metro 属于另一个项目，没有停止它。没有创建本地签名 IPA、提交 TestFlight 或发布 OTA；应用仍需新原生构建才能交付这些源码变更。

> 以下按日期保留各轮实际验证结果，不是当前功能或发布状态清单。2026-09-16 的头像、提醒、早教共享及五人名额范围见[共享资料说明](FAMILY-EXTRAS.md)，已完成的数据库/API 与 preview 发布见[运行手册证据](AZURE-MANUAL-SETUP-RUNBOOK.md#shared-extras-release-evidence-16-september-2026)。较早的本机准备、虚构数据试点及旧邀请上限描述只适用于当时版本。两部 iPhone 的激活/恢复、照片显示、实际通知、真实删除与恢复演练仍需独立验收，不能由这些本机测试或发布结果推定通过。

## 本次发布暂停咖啡购买 · 2026-09-22（源码变更，未发布）

- 用户决定先发布其他功能和修复。`src/support/release.ts` 的 `SUPPORT_PURCHASES_ENABLED` 固定为 `false`：所有语言隐藏咖啡入口及可选购买隐私段落；旧页面返回「我的」。普通隐私说明与联系支持保留。
- 关闭时不加载 StoreKit 适配器、不注册前台监听、不请求商品、不发起购买或处理交易；未完成交易不被删除，待未来启用版本恢复核对。保留商品 ID、翻译、依赖与购买源码，无服务端、签名或 Apple 商品配置变更。
- 自动验证覆盖关闭时的 iOS/Android/Web provider、无原生购买模块加载、无副作用的操作、旧页面返回与隐私文案隐藏；浏览器新增中英文入口缺失断言。`npm run verify` 类型检查及 686 项测试通过，完整浏览器回归、iOS Hermes 和 Web 导出通过；格式化及 `git diff --check` 通过。这些是源码/模拟依赖与浏览器验证，不代表真机 StoreKit 或签名发布验收。
- 仍需新本地签名构建及真机验收；本次未构建 IPA、安装或上传 TestFlight。后续步骤见运行手册的「Coffee deferred」条目。

## 自愿支持购买源码实现 · 2026-09-20（本机实现，未构建或发布）

- More 中新增 iOS/iPadOS 专用的「请我喝杯咖啡」入口和独立页面。三档均为可重复购买的单次 Consumable，不订阅、不解锁功能；价格仅使用 StoreKit 返回的本地化价格，初始不预选金额。Android 和 Web 不显示入口。
- 固定依赖 `expo-iap` 5.6.3（内含 OpenIAP Apple 3.4.0）。源码审计后未启用该版本会同时写入 Android Billing 配置的通用 Expo 插件；改为只让 Apple 自动链接，并用 `expo.autolinking.android.exclude` 排除 Android。`npx expo-modules-autolinking resolve --platform android --json` 未解析 `expo-iap`，Apple 同命令成功解析。
- 购买监听器先于连接注册；应用启动和回到前台时重放 StoreKit 未完成交易。仅接受产品白名单、Apple store、数量 1、已购买状态、同一原始/规范交易编号、有效日期、签名交易、匹配的可选 bundle/environment 且未撤销/升级的交易；完成操作只作用于该笔已验证的原始交易。取消保持安静，等待批准、结果不明、已确认但完成失败分别显示，后两者阻止重复付款直至状态核对。
- 不新增 Azure/API/SQL/Entra 依赖，不把支持与应用登录、家庭或宝宝资料关联，不保存银行卡、Apple 账户、收据/JWS 或购买历史，也不新增本机支付账本；StoreKit 未完成交易是恢复来源。隐私说明和 Apple 购买记录/退款帮助入口已加入。
- 支持页面的文字使用独立 locale catalog：当前提供英文和简体中文、缺失项明确回退英文，交易逻辑不含语言分支。扩展新语言仍须同步扩展全局 locale/语言选择、应用翻译和 App Store Connect 商品元数据；英文回退不代表该语言已完成发布本地化。
- 本机验证：`npm run verify` 全部配置套件通过；其中根级单元测试 244 项通过，原生安全套件 9 项通过。`npm audit --omit=dev` 为 0 个已知漏洞。`npx expo config --type public` 成功，仍仅包含原有 Watch、Today Widget 等插件/扩展，没有 Apple Pay entitlement。`npm run export:web` 和 `npm run export:ios` 成功；`npm run test:browser` 通过；`npm run test:apple-browser` 在 320/390/768px、中英文、浅/深色和更高对比度下通过 24 个隔离截图场景，外部请求为 0。
- **尚未验证**：干净 iOS prebuild/CocoaPods、Swift 原生编译、签名 archive、主应用 IAP capability/profile、Watch/Widget 嵌入保留、App Store Connect 商品/协议/税务/银行、StoreKit sandbox 的成功/取消/等待/重复/中断/完成重试、真机 VoiceOver/Dynamic Type/浅深色、App Privacy 声明、TestFlight 上传/处理/安装。本功能加入原生依赖，不能通过 OTA 交付。本轮没有修改 Apple/Azure/GitHub 远端状态，没有生成 IPA 或提交 TestFlight。

后续操作和验收门槛见[实现计划](BUY-ME-A-COFFEE-PLAN.md)及[手工设置运行手册](AZURE-MANUAL-SETUP-RUNBOOK.md#buy-me-a-coffee-iap-setup-client-implemented-apple-steps-not-executed)。

## 喂养保存、照护补充剂及导航 · 2026-09-19（本机实现，未发布）

- 喂养可只填开始时间后「保存记录」，不再自动开始计时；「开始计时」为独立次要操作，填写结束时间后隐藏。编辑正在计时的记录且未填结束时间时保留计时。
- 不足一分钟睡眠的误触提示 5 秒后消失；额温选项改为图标，保留辅助名称及选中后的文字说明。底栏顺序为今天、照护、记录、成长、我的。
- 日常照护加入补充剂多选：维生素 D（VD）、益生菌排前两项，其后为铁、复合维生素、其他；均不默认选中。其他需填写名称，记录可保存、编辑、重启恢复。建议、注意事项与来源位于历史下方的默认折叠区，不提供自动剂量或每日必服清单。医学内容依据 [RCH 维生素 D](https://www.rch.org.au/kidsinfo/fact_sheets/Vitamin_D/)、[NIH NCCIH 益生菌](https://www.nccih.nih.gov/health/probiotics-usefulness-and-safety)及 [Pregnancy, Birth and Baby](https://www.pregnancybirthbaby.org.au/children/feeding-and-nutrition/children-and-vitamins)，2026-09-19 查阅。
- `npm run verify`：类型检查及 581 项测试通过。最后的复选框 web ARIA 修正与按钮间距调整后，类型检查及 22 项表单/照护测试再次通过。保存数据与勾选状态分别验证；React Native Web 不转发旧 `accessibilityState.checked`，因此显式提供 `aria-checked`，未放宽测试。
- Web 导出、完整浏览器回归通过，包括新记录 ID 精确识别、开始时间单独保存、结束时间上限、5 秒提示、多选保存/编辑/重启与默认折叠。布局脚本覆盖 320/390/768px、中英、浅深色及更高对比度，生成 24 张隔离截图；人工检查了新多选、参考区、额温图标及喂养动作。未连接真实家庭或改写原有预览截图。
- .NET：API 155 项及 migrator 9 项通过；无隔离 SQL 测试连接，API 100 项与 migrator 23 项 SQL 测试跳过，包含新增的补充剂幂等写入、旧版投影与跨版本 ETag 集成场景。不是生产数据库验收。
- iOS Hermes JavaScript 导出通过（`work/care-refinements-ios`）；仅为资源包验证，不是签名构建或 TestFlight 提交。
- 家庭 API 增加 care schema 2 的协商及兼容投影。旧版客户端继续读取已支持的类别，不显示补充剂；新客户端对旧 API 禁用共享补充剂并说明原因。本机离线记录不受此限制。无需 SQL 迁移，必须先发布兼容 API，再发布 app；详见 [API 合约](FAMILY-API-CONTRACT.md#supplement-compatibility-19-september-2026-implementation-deployment-separate)与运行手册。
- **仍需真机**：iPhone 浅/深色、键盘打开时的完整表单、较大 Dynamic Type、VoiceOver 的额温名称与复选状态、通知/Watch/Widget 原有行为无回归、SQLite 重启恢复、两部授权测试设备的新旧版本兼容同步。本轮没有 commit、push、Azure 部署或 TestFlight 构建/提交。

## 冷启动验证与重连修复 · 2026-09-17

- `npm run verify` 通过：TypeScript 及 420 项测试，0 失败。包含 128 项实际控制器测试、19 项原生认证模拟和 13 项 API 边界测试；新增冷启动静默重试、到期/撤权立即保护、登出中止、401 正文卡住、已知 4xx 状态保留、内外认证超时竞态与迟到令牌隔离覆盖。
- Web 导出及完整浏览器回归通过（Node 时区设为 UTC）；最终 iOS Hermes 导出通过。界面清晰化检查未发现新增机械问题；原有样式保持不变，仅调整连接文案和重复提示。
- 独立复核发现并修复了 15 秒内外计时器竞争导致重试复用旧请求的问题；真实模块组合回归验证新的 20 秒外层保护与 15 秒原生网络超时。剩余复核范围未发现阻塞项。
- 新原生 preview 目标为 0.2.1 / build 21；本次未修改/部署 API、SQL 或 Azure。发布完成状态应以 Expo 构建页为准。真机长时间锁屏后的刷新、离线恢复与双机撤权仍需验收；测试通过不等于已证明截图事件的后端根因。
- 修复边界、无需额外云端设置的安装步骤与脱敏诊断说明见[响应性复核](API-RESPONSIVENESS-REVIEW.md#follow-up-cold-start-identity-check--17-september-2026-build-21)。

## 安全修复候选版 · 2026-09-17

- 修复范围、逐项状态及 Azure/GitHub 手工步骤见[安全修复与发布清单](SECURITY-REMEDIATION-2026-09-17.md)。SEC-03 的外部恢复证据与恢复演练仍未闭环，不以维护开关或构建成功代替。
- `npm run verify` 通过：TypeScript 及 384 项单元/实际控制器与界面/原生适配器模拟测试，0 失败。包含提醒独立清理与重启重试、头像重编码/元数据剥离、iOS 原生保护桥接失败关闭、数据库初始化失败后同进程重试和补丁依赖兼容性。
- 真实本机 SQL Server 隔离测试：API 183 项、DbUp 11 项通过，0 失败、0 跳过；使用自动生成并清理的测试数据库，未访问 Azure 数据。覆盖匿名/账户限流隔离、并发家庭锁、Unicode 响应容量、超限回滚、旧历史读取/编辑/删除、条件读取、限次创建和恢复门控。18 项工作流/action 固定版本检查通过；防火墙测试使用模拟，不访问 Azure。
- Web 导出与完整浏览器回归通过；iOS Hermes 导出通过。导出不等于 Swift 编译、签名安装或真机验证。
- `npm audit --json` 全部依赖为 0 项已知漏洞；仅定向修复 `xcode → uuid`，未强制降级 Expo。
- iOS 新原生候选版为 0.2.1 / build 19，禁用未签名 OTA；原生数据库备份排除及图像处理依赖不能通过旧 0.2.0 OTA 添加。已安装的旧版本必须升级，历史备份无法撤回。
- 尚未操作 Azure 生产数据/配置；实际系统备份、原生通知、照片方向及双机检查仍按清单单独验收。

## API 操作响应速度审查 · 2026-09-17

- 操作范围、改动及保留服务器确认的原因见 [API 响应速度审查](API-RESPONSIVENESS-REVIEW.md)。普通记录、头像、提醒和早教原本已先更新本机，再后台同步，未为优化延迟而取消持久化或权限检查。
- 喂奶开始待同步时保持计时可见、可打开停止/实际奶量确认；持久化后续完成意图，保留原始请求和操作编号，不覆盖弹窗打开后的并发修改。
- 空闲同步省去第二次完整快照；重叠刷新在工作已完成时合并，仍保留写入前核验和写入后结果核对。退出登录先取消后台请求，避免等待 API 超时；本机清理失败仍明确报告且可重新刷新。
- 档案保存、添加邀请、重新登录和删除状态查询在发起按钮显示进行中。创建/加入家庭、权限与删除等仍等待服务器确认。
- `npm run verify` 通过，含 108 项控制器及 41 项家庭界面测试。覆盖慢请求、离线重启、实际奶量、陈旧弹窗、本机保存失败、刷新合并、退出取消与失败恢复；独立复核未发现新增阻塞问题。真机与双机验证步骤见审查文档，尚未执行；没有改动 API/数据库，也没有发布。
- 完整浏览器回归、Web 与 iOS JavaScript/Hermes 导出通过；iOS 导出不是 IPA 签名或手机安装验收。

## 睡眠即时状态与今日汇总 · 2026-09-17

- 首页不再把等待同步的睡眠开始记录过滤掉；点击「睡了」立即显示「正在睡觉」，本机保存和家庭同步不再决定这个状态何时出现。本机保存失败会回退并显示错误。
- 点击「醒了」同样先更新本机状态。实时计时不足 60 秒会按误触取消，并在睡眠卡片内提示；恰好 60 秒或更长正常保存。手动补录不经过这个过滤，仍可保存短时睡眠。
- 如果开始请求已发出，保持原请求内容与操作编号不变，持久保存后续停止/删除意图。收到回执和核验后的快照再发送带版本的后续操作；不直接丢弃未知结果的请求，避免留下服务器上的进行中睡眠。慢网/离线期间另一设备可能暂时看到开始状态，恢复同步后才完成清理；并发修改会保留冲突供处理，不强行覆盖。
- 顶部奶量、睡眠、尿布空值统一显示 `0`，三项统一标注「今日数据 / Today's totals」。统计仍按本地当天计算，跨日睡眠只计入当天重叠部分。
- 本轮 `npm run verify`、新增实时计时/队列回归与完整浏览器回归通过，Web 和 iOS JavaScript/Hermes 导出成功。覆盖 59.999 秒取消、60 秒保存、补录例外、本机保存失败、离线重启、开始响应丢失后的原编号重试、延迟回执及其他成员并发修改。没有修改 API/数据库契约，也没有执行提交、远程推送或 Expo/TestFlight 发布。

待真机验证（仅用虚构测试记录）：

1. 在线点击「睡了」，确认马上显示「正在睡觉」和「醒了」；在一分钟内点击「醒了」，确认回到未计时状态且睡眠卡片显示取消说明，记录中不保留这段短时睡眠。
2. 用两台手机模拟慢网与断网，重复快速取消；恢复网络并等待同步后，确认两台手机都没有残留的进行中计时。不要以 API 健康检查代替此项。
3. 开始后关闭并重新打开应用，确认计时仍在；满一分钟后结束并确认保留准确开始/结束时间。另测停止后立刻关闭并重启，后续同步不能丢失停止意图。
4. 手动补录不足一分钟的睡眠，确认仍可保存。另一成员同时修改时，确认应用显示冲突而不是覆盖对方最新数据。
5. 新建空白虚构资料，确认今日三项都是 `0`，中英文标题清楚；只有昨天记录时，今天仍显示 `0`。

原生 SQLite 写入、实际网络与双机显示仍需以上独立验证；自动测试和 Hermes 导出不等同于安装验收。

## 完整家庭共享 · 2026-09-15

- 主界面接入家庭档案、喂养、尿布、睡眠、成长、旧里程碑及日常照护。首次创建上传已审核完整历史；接受邀请只下载家庭资料，不合并个人历史。只有核对创建回执的 seed digest、家庭/授权/历史和完整快照后才清理旧本机资料；未确认及清理失败的操作可重启恢复。
- `npm run verify` 通过：111 项单元测试、33 项实际控制器测试桩、8 项家庭界面测试、9 项首次设置测试及 TypeScript 检查。覆盖离线队列持久化、先提交获胜、错误家庭/授权与摘要、撤权后的存储失败/重启、19/20 邀请边界、本机数据及原生提醒的清理竞态。原生控件、身份与设备数据库边界为模拟，不等于 iPhone 验收。
- .NET 后端 **106 项真实本机 SQL Server 测试通过，0 跳过**。使用隔离的临时测试数据库，完成后已清理；没有改动 Azure 数据。覆盖迁移、全类型校验、原始 ID/数值、并发创建与版本冲突、作者与权限、记录重叠、撤权、删除及不可变种子回执。
- 8 项实际 Bicep 编译检查、60 项 Azure 部署脚本模拟测试、20 项 GitHub helper 模拟测试和 11 项工作流/权限契约检查通过。计划查询改为 ARM 的明确属性路径，并报告具体失败字段；保留 B1/区域/状态与成本安全检查，不推断之前实际失败字段，也未调整现有计划。
- Web 和 iOS JavaScript/Hermes 导出成功；本机并行默认 worker 首次失败后使用 `--max-workers 2` 成功。浏览器原有记录、日历、深色/窄屏、中英文及未配置家庭服务回归通过。导出不是 IPA 签名、安装或 TestFlight 发布。
- 独立开发样例的 9 种界面场景也通过浏览器回归：中文/英文、浅色/深色、390/320px。以 `EXPO_PUBLIC_FAMILY_UI_DEMO=1` 和 `--clear` 独立导出，样例不持久化、不调用账户/API，也不修改原有本机记录；此结果不是在线家庭功能验收。
- 独立复核发现并修复：激活目标未严格绑定、网络失败隐藏缓存、旧迁移草稿残留、原生提醒越过清理边界、档案保存后旧版本号、延迟启动读取恢复旧内存资料。复核范围未发现剩余阻塞。
- [完整 Azure 设置指南](AZURE-FAMILY-SETUP.md) 和 [v2 API 契约](FAMILY-API-CONTRACT.md) 是当前入口。客户租户/Graph、真实 SQL 托管身份、受保护 GitHub 部署、两部 iPhone、删除/备份保留与恢复演练仍未在此轮验收；没有执行 Azure 部署或 Expo/TestFlight 发布。

## GitHub 自动基础设施工作流 · 2026-09-14

- 新增 `Family infrastructure`：相关文件 push/PR 自动编译与测试；配置后，可信分支 push 自动使用独立只读 OIDC 身份进行 Azure 预览，受保护环境审批后由另一身份部署。PR 无 Azure 登录/OIDC 权限；默认云端步骤关闭，不创建 GitHub 环境、Azure 身份或权限。API 代码发布保持原有手动流程。
- 本机验证通过：8 项实际 Bicep 编译检查、58 项部署脚本模拟测试、20 项 GitHub helper 模拟测试、11 项解析实际 YAML/预览角色的契约检查。测试覆盖 `ProviderNoRbac` 仅用于预览、CLI 版本拦截、事件/分支隔离、身份分离、准确 SHA、跨 job 配置指纹、审批开关、JSON 转义、临时文件清理及不输出管理员详情/令牌。未执行 Azure 资源操作。
- 独立复核未发现阻塞问题。明确记录环境名称不等于审批保护、预览不等于不可变执行计划、旧审批和配置变化须重新预览。预览角色没有资源写入或数据平面权限；默认预览要求部署权限的问题通过 CLI 2.76+ `ProviderNoRbac` 解决，禁止降级回退。
- 更新中英文 README 与 [GitHub 设置指南](AZURE-GITHUB-INFRA.md)，保留本机执行作为备用。真实 OIDC 信任、环境审批、RBAC、免费 SQL 可用性及 Azure 部署尚待用户完成一次性设置后验收。本轮无手机/API 逻辑修改，也没有 Expo 或 TestFlight 发布。

## Bicep 基础设施与部署脚本 · 2026-09-14

- 新增订阅级 Bicep、独立资源组模块、精确出站 IP 的 SQL 防火墙模块，以及默认仅本机验证的 PowerShell 部署脚本。复用 `ProdRG/reticelASP`，不创建或调整计划；新增 Web App/托管身份与免费额度用尽即暂停的 SQL，不创建 Key Vault、付费网络或额外监控资源。
- `./infra/tests/bicep.Tests.ps1`：实际 Bicep 编译通过，8 项编译产物检查通过。检查资源范围、创建时父资源、托管身份、TLS、免费额度、备份保留、防火墙及无密钥输入输出。使用 Azure CLI 2.61.0 / Bicep 0.46.1，没有读取 Azure 账户或资源。
- `./infra/tests/deploy-pilot.Tests.ps1`：53 项模拟 Azure CLI 测试通过，覆盖默认不访问云端、显式审批、订阅/计划/归属校验、付费与宽泛防火墙拦截、配置漂移、Web App 或 SQL 单独创建后的重试、参数/模板快照、异常停止和清理失败时保留原始错误。测试不是实际 Azure 部署或权限验收。
- 独立复核发现普通 SQL server GET 不包含管理员子资源，已改为明确请求 `administrators/activedirectory` 扩展，并加入严格请求形状及缺失管理员拦截测试。重复部署不 PUT 已有 Web App/SQL server，不读取或重写手工配置的应用设置、密钥和 HistoryId。
- 更新中英文 README、[部署指南](AZURE-BICEP-DEPLOYMENT.md) 及原有 Azure 配置指南。未更改手机或 API 运行逻辑，未重跑无关的应用测试，未发布 Expo/TestFlight。真实免费资格、区域可用性、Azure RBAC、托管身份 SQL、Entra/Graph 和双机测试仍待部署后验证；当前清理任务每分钟访问 SQL 的行为仍须调整，避免耗尽免费额度。
- 一次早期模拟清理失败测试留下了仓库外的 GUID 临时目录，仅含测试脚本和虚构参数；宿主拒绝自动清理，未改用其他方式删除。其余本轮测试的临时快照正常清理，未触碰用户已有 `work/` 内容。

## 初版不依赖 Key Vault · 2026-09-14

- Azure 设置指南、试点契约和服务端/基础设施说明改为直接使用受限的 App Service 服务器设置保存目录删除凭据；初版不创建 Key Vault 或授予其访问角色。配置模板继续保留空密钥，不向 Git、手机/EAS、日志或部署产物加入真实凭据。SQL 托管身份、GitHub OIDC 与账户删除要求不变。
- 运行 `dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --filter FullyQualifiedName~AccountIdentityDeletionTests --no-restore`：12 项通过、0 跳过。新增测试通过实际配置/依赖注入注册目录删除提供程序并验证删除请求；HTTP 为测试桩。保留缺失配置、未解析引用、权限/网络错误不能误报删除完成的验证。
- 运行时代码仅更新注释，无逻辑或手机界面变更。未执行 Azure 部署、真实凭据配置/轮换、真实 Entra/Graph 删除或 SQL 集成测试；真实用户发布仍须完成这些适用的验收。下方较早记录中的 Key Vault 验收不再是初版前置条件。

## 首次邀请手机端准备 · 2026-09-14

- 实现完整本机 `State` 的严格快照验证、六类记录数量汇总、最多三位邮箱校验、确认前资料变化检测、进行中计时阻止、10 MiB UTF-8 限制。真实原生页面仅保存账户隔离的本机准备内容，不发送到 API；普通离线档案与记录不变。完整历史上传及主应用共享模式尚未实现，见 [Azure 交接说明](FAMILY-OWNER-ONBOARDING.md)。
- `npm run verify` 通过：TypeScript、100 项单元测试、26 项控制器/认证测试、6 项界面权限测试、9 项 owner setup / 原生持久化边界测试，共 141 项。SQLite 为实际模块配确定性测试边界，不是真机数据库验收。
- 独立复核发现并修正退出清理失败后准备内容可能恢复的问题：现在退出前的持久事务同时清空试点状态和准备内容，账户删除意图亦清理准备内容；覆盖事务回滚、重试、最终清理失败后重启登录及不同账户隔离。
- 九种 demo 场景在中文/英文、浅色/深色、320px/390px 下通过浏览器回归。新增首次邀请的邮箱规范化、取消、重新确认、创建后完整虚构历史保留和交接不更改作者；无认证/API 请求或家庭持久化，原有五类记录及照护数据逐字保持。已检查首次邀请及确认窗口截图，沿用现有蓝色主题和紧凑布局。
- 普通网页回归、网页及 iOS JavaScript/Hermes 导出通过。没有部署 Azure、操作真实家庭、发送邀请或提交 TestFlight。原生 iPhone 键盘、模态框滚动、SQLite、登录和双机共享仍需后续验证。

## 家庭界面预览 · 0.2.0 / build 18 · 2026-09-14

- 新增独立 `ui-preview` 模式，复用实际家庭界面，八种样例场景与全部操作仅在内存中模拟。独立复核确认不会挂载真实控制器，不访问认证、网络、SQLite、SecureStore 或原有宝宝资料；切换场景、重置、返回及退出均丢弃样例会话。
- `npm run verify` 通过：TypeScript、81 项单元测试（含 9 项 demo 测试）、26 项控制器/认证边界测试、6 项实际界面权限/确认流程测试。
- `npm run test:family-demo-browser` 通过：八场景 × 英文浅色 390px、英文深色 320px、中文深色 390px、中文浅色 320px；覆盖同意加入、角色权限、修改样例奶量、移除/退出、交接、关闭家庭、删除进度、重置和返回。没有非静态资源请求、账户/家庭持久化或页面异常；原有档案、喂养和照护数据保持不变。已查看窄屏深色和加入确认截图。
- 普通构建与 demo 切换曾命中 Metro 缓存；清缓存重新导出验证，文档及 CI 已要求 demo 导出使用 `--clear`。普通浏览器回归、demo 网页导出及 iOS JavaScript/Hermes 导出通过。iPhone 模态框、键盘、原生日历控件和真实安装仍需设备验收。
- 专用 EAS 原生安装包使用独立 `ui-preview` 频道；它不是 TestFlight 或生产发布，不依赖 Azure。[操作说明](FAMILY-UI-PREVIEW.md)。

## 家庭邀请流程修订 · 0.2.0 源码 · 2026-09-14

本节是按最新批准流程完成的验证；下方初始试点和 0.1.0 等结果均为历史记录。仅使用虚构数据；没有操作真实家庭、Azure 租户或用户账户。

- `npm run verify`：TypeScript、72 项单元测试、26 项控制器/原生认证边界测试、6 项中英文界面权限与确认流程测试全部通过。
- `dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release`：41 项通过、0 跳过。使用本机真实 SQL Server，覆盖邮箱收件箱、接受/拒绝、作者与管理员权限、交接、退出/移除、关闭家庭、账户删除及 HTTP 授权。SQL 测试仅创建并删除工具自己的 GUID 命名数据库。Graph 测试为受控 HTTP 桩，不是实时目录删除。
- 独立复核后补充验证：旧家庭内容不能重新绑定新家庭；旧退出/移除请求不能影响新成员授权；不确定的提交结果跨重启重试仍幂等；退出清理在磁盘/凭据失败后不恢复旧队列；管理员降级及时限制写入；删除回执在退出后可查；某个目录删除失败不阻塞其他任务。空准入名单拒绝所有登录访问，但仍可查删除回执。
- EF 模型与迁移一致。v2 迁移撤销旧待接受链接邀请；禁止向下迁移删除安全屏障。数据库恢复必须先重放删除与权限撤销，再恢复服务。
- `npm run export:web`、`npm run export:ios` 通过，分别打包 376 / 911 个模块。iOS 为 JavaScript/Hermes 产物，不是 IPA 编译或签名。
- `npm run test:browser` 通过：既有本地流程、日历/历史、深色/窄屏、中英文未配置试点页，以及返回后原有本机历史保留。新增家庭交互通过控制器和界面测试桩验证；浏览器不能替代原生登录、SQLite、SecureStore 或双机验收。
- 未增加依赖；本轮未重新运行依赖漏洞审计。下方旧审计结果不能视为新的安全认证。
- **未执行 / 尚未开放**：Azure 部署、真实 Entra/Graph 登录及删除、Key Vault/托管身份、原生双机离线/退出/冲突测试、备份恢复演练、完整家庭数据同步、真实历史迁移/替换、共享照片和公开注册。原有离线数据未上传或删除。没有生成 IPA、发布 OTA 或提交 TestFlight。
- 下一步按 [Azure 设置指南](AZURE-FAMILY-PILOT-SETUP.md) 配置独立服务、更新迁移与最小运行权限、配置服务器目录删除应用，再用两个核验的虚构账户完成 iPhone 验收。真实用户发布还须落实配置/备份保留与删除、隐私披露和审核访问。

## 历史验证 · 初始家庭邀请试点 · 0.2.0 源码 · 2026-09-14

Windows、Node.js 24.19、.NET 10 和本机 SQL Server 环境；仅虚构数据。本节为本次执行结果，下方 0.1.0 等内容为历史结果，不代表本次原生设备验收。

- `npm run verify`：TypeScript、68 项单元测试、13 项试点控制器/原生认证边界测试通过。控制器测试执行实际 hook、存储与认证模块，使用确定性 React、SQLite、HTTP、SecureStore、AuthSession 测试桩，覆盖先持久保存再发送、导航恢复、退出清理失败与重试、重新认证和旧会话竞争。
- 设置 `FAMILY_TEST_SQL_CONNECTION` 后运行 `dotnet test server/LittleDays.FamilyApi.Tests`：15 项通过，使用真实 SQL Server 而非内存数据库，覆盖 JWT、邀请、并发写入、版本冲突、撤销权限、历史变更和迁移；仅创建并清理测试工具自己的 GUID 命名数据库。命令与权限见 [服务端说明](../server/README.md)。
- `npm run export:web` 和 `npm run export:ios` 通过。iOS 为 JavaScript/Hermes 导出，不是 IPA 编译、签名或真机验证。
- `npm run test:browser` 通过：既有本机流程、日历/历史、深色与窄屏，以及中英文未配置试点页面、禁止网页登录、返回后本机历史保留。浏览器未验证原生登录、分享或 SQLite。
- 依赖检查：`npm audit` 为 12 项 moderate、0 high、0 critical；来自既有 `uuid@7.0.3 → xcode@3.0.1 → Expo` 工具链，相关版本与本次改动前一致。未强制降级 Expo；兼容的依赖修复仍需跟进，不能将本次结果称为完整安全认证。服务端依赖审计未报告已知漏洞。
- **未执行**：Azure 资源创建/部署、真实 Entra 邮箱验证码登录、托管身份连接 Azure SQL、两部 iPhone 的原生离线/冲突/撤销验收，以及 Azure 数据库恢复演练。当前仍是独立、仅虚构数据的受控试点，原有宝宝资料不会上传。没有生成新 IPA、发布 OTA 或提交 TestFlight。
- 下一步按 [Azure 设置指南](AZURE-FAMILY-PILOT-SETUP.md) 配置服务与两个核验账户，安装新的 0.2.0 原生构建并完成双机检查。公开或外部 TestFlight 发布还需账户/家庭删除、保留策略、隐私披露和审核访问安排。

## 历史验证 · 0.1.0

执行环境：Linux、Node.js 24.19、Expo SDK 57。测试数据为虚构数据；docs 中预览图不包含用户真实记录。

## 已通过

- TypeScript：`npm run typecheck`。
- 21 项自动测试：`npm test`。包含备份往返、无效版本/字段/日期/数值、重复 ID、重复进行中睡眠、跨午夜、夏令时、重叠睡眠去重、尿布混合口径、日龄、随最新喂养开始时间计算提醒、提醒设置回填、WHO 六组数据与官方锚点。
- `expo export --platform ios`：838 个模块生成 Hermes 资源包。
- `expo export --platform web`：网页生产资源生成成功。
- Chromium 浏览器操作回归：档案填写，五类记录，重启后记录与睡眠计时恢复，错误输入拦截，编辑、删除/撤销，曲线，JSON 导出，损坏备份拦截，替换/恢复副本，深色模式，夏令时重复小时仅编辑备注不改变原时间戳，启动数据损坏后的恢复入口。
- 390×844 手机宽度无横向溢出、无页面运行时错误。已人工查看浅色首页、深色首页和成长页截图。

浏览器回归使用 `.web.ts` 存储/文件实现，不代表原生 SQLite 或系统通知测试。

## 重跑浏览器回归

```powershell
npm run export:web
npx playwright install chromium
node tests/browser.mjs
```

脚本拦截 `little-days.test` 并提供本地产物，不连接外部站点，不需要启动 HTTP 服务器。Linux 无中文字体时可设置 `SCREENSHOT_FONT_DIR` 为解压后的 `@fontsource/noto-sans-sc` 目录，仅供截图渲染。此字体不打入手机应用，iPhone 使用系统字体。

## iPhone 真机验收清单（尚未执行）

1. 安装签名构建；创建宝宝档案和每一种记录。
2. 启动睡眠，锁屏、结束进程、重开，确认开始时间未变；点击醒了后时长合理。
3. 飞行模式下新增、编辑、删除记录，重启后仍存在。
4. 验证日期选择器、跨午夜睡眠、错误结束时间、键盘遮挡和较大系统字体。
5. 设置一分钟后本地提醒，允许权限，前台/后台/锁屏分别验证；检查每日提醒、静音、取消和系统专注模式。为喂养设置“随最新喂养”提醒，新增、编辑、删除最新一条喂养记录后，确认计划时间始终为最新开始时间加上设定间隔；离开并重新进入“我的”，确认标题、方式、间隔和静音开关均回填。
6. 导出至“文件”，重新导入，确认条数/数据；导入损坏备份不覆盖原始数据；替换后可恢复上一份。
7. 比较测试日期上的 WHO 曲线与官方数据，检查 kg/cm 单位。
8. 独立安装包关闭 PC 后可启动、查看和记录；Expo Go 不作为独立安装验收。

## 明确的产品边界

- 本版本支持从现在开始的一次性提醒、每天固定时间提醒，以及随最新喂养开始时间自动重置的提醒；不包含免打扰时段自动顺延。
- 不含亲喂实时独立计时器（可填写开始/结束时间）、白天/夜间睡眠分组、每日与每月自动报告。
- 手机本地 SQLite 的事务行为依据 Expo API 实现，尚未在原生运行时验证。
- 本交付未签名，没有生成 IPA，也没有在用户 PC 安装任何程序。

## 界面修订回归

新浏览器脚本验证首页没有最近记录、记录页没有打叉控件、每日250mL/21分钟与3小时1分间隔、单位切换、编辑、删除撤销、睡眠/尿布汇总、里程碑隐藏且旧数据保留、成长测量入口和340px宽度无横向溢出。17项数据单元测试继续通过。iPhone真机验收状态不变。

## Baby Blue 视觉更新

TypeScript 检查、网页操作回归通过；已检查390px实际渲染首页。主卡片使用浅蓝配深蓝文字，辅助卡片为白底柔和分类色，表单/统计及夜间模式同步改色。iOS资源包重新导出，原生真机验收状态不变。
