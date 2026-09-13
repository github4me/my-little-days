import React, { createContext, useContext, useMemo } from "react";
import { getLocales } from "expo-localization";

export type LanguagePreference = "system" | "zh" | "en";
export type AppLocale = "zh-CN" | "en-US";

type TranslationValues = Record<string, string | number>;

// Chinese source text remains the fallback. Keeping translations together makes
// adding another language a data change rather than a screen-by-screen rewrite.
const english: Record<string, string> = {
  "MY LITTLE DAYS · 小日子": "MY LITTLE DAYS",
  今天的小日子: "{name}'s little days",
  "每一天，都记得": "Every day remembered",
  慢慢长大的你: "Growing with you",
  我的: "More",
  今天: "Today",
  记录: "Records",
  成长: "Growth",
  照护: "Care",
  喂奶: "Feed",
  喂养: "Feed",
  开始: "Start",
  停止: "Stop",
  确认结束喂养: "Finish feed",
  "结束时间：{time} · 时长：{duration}":
    "Ended at {time} · Duration: {duration}",
  "原选奶量：{amount} mL": "Originally selected: {amount} mL",
  "实际奶量：{amount} mL": "Actual amount: {amount} mL",
  滚动选择实际喝下的奶量: "Scroll to select the amount actually drunk",
  奶量滚轮: "Milk amount wheel",
  减少奶量: "Decrease amount",
  增加奶量: "Increase amount",
  确认并保存: "Confirm and save",
  正在保存: "Saving…",
  "取消，继续喂养": "Cancel and continue feeding",
  "亲喂仅记录时长，不估算奶量。":
    "Breastfeeding records duration only, not estimated volume.",
  "保存失败，请重试；喂养记录尚未结束。":
    "Could not save. Try again; the feeding record is still running.",
  正在喂养: "Feeding now",
  喂养计时状态无效: "Invalid feeding timer state",
  请先停止正在进行的喂养: "Stop the current feed before starting another.",
  尿布: "Diaper",
  睡眠: "Sleep",
  测量: "Measure",
  里程碑: "Milestone",
  成长测量: "Measurement",
  成长里程碑: "Milestone",
  配方奶: "Formula",
  瓶喂: "Bottle",
  瓶喂母乳: "Expressed milk",
  左侧: "Left",
  右侧: "Right",
  双侧: "Both",
  亲喂: "Breastfeed",
  尿: "Pee",
  便: "Poo",
  "尿＋便": "Pee + poo",
  "尿 + 便": "Pee + poo",
  "一点一滴，都是成长": "Every little moment is growth",
  照顾此刻: "Care right now",
  "mL 已记录奶量": "mL fed today",
  "小时 已记录睡眠": "hours slept today",
  "次 换尿布": "diaper changes",
  正在睡觉: "Sleeping now",
  "还没有记录，轻点开始": "No record yet — tap to start",
  醒了: "Awake",
  睡了: "Sleep",
  "＋记录": "+ Add",
  "补录睡眠 ›": "Add past sleep ›",
  "＋测量": "+ Measure",
  全部: "All",
  体重: "Weight",
  身长: "Length",
  头围: "Head",
  "体重 kg": "Weight kg",
  "身长 cm": "Length cm",
  "头围 cm": "Head cm",
  成长曲线: "Growth charts",
  "陪伴成长 · 不必完美记录": "Growing together · no need for perfect records",
  "每一刻，都值得记住": "Every moment matters",
  关闭记录编辑: "Close editor",
  喂养方式: "Feeding method",
  "实际喝奶量 · mL": "Amount fed · mL",
  实际喝奶量: "Amount fed",
  "按喂养当天日龄（{days}天）提供快捷选项，并非建议奶量。请记录实际喝下的量，顺应饥饱信号或医护建议。":
    "Quick amounts for age at feed ({days} days), not feeding targets. Record what was drunk; follow hunger/fullness cues or your clinician's advice.",
  "配方奶喂养参考 · 美国儿科学会 ↗": "Formula feeding guide · AAP ↗",
  "无法打开参考链接，请联网后重试。":
    "Could not open the guide. Check your connection and try again.",
  尿布情况: "Diaper details",
  有尿: "Pee",
  有便: "Poo",
  睡眠状态: "Sleep status",
  正在睡: "Sleeping",
  "已睡醒 / 补录": "Awake / add past sleep",
  "保存开始时间后，关闭应用也不会丢失计时。":
    "After saving the start time, the timer keeps running even when the app is closed.",
  入睡时间: "Sleep start",
  记录时间: "Time",
  "✓ 记录结束时间": "✓ End time recorded",
  "+ 记录结束时间（可选）": "+ Add end time (optional)",
  醒来时间: "Wake time",
  结束时间: "End time",
  测量数据: "Measurements",
  "至少填写一项；保留实际测量的小数。":
    "Enter at least one value; decimals are kept as measured.",
  "体重 · kg": "Weight · kg",
  "身长 · cm": "Length · cm",
  "头围 · cm": "Head · cm",
  未填写: "Not entered",
  里程碑标题: "Milestone title",
  "例如：第一次对我笑": "For example: smiled at me for the first time",
  "备注 · 可选": "Notes · optional",
  备注: "Notes",
  "记下一点小细节…": "Capture a little detail…",
  "保存 · 继续计时": "Save · keep timing",
  保存记录: "Save record",
  "仅保存在这台设备 · 无需联网": "Saved on this device · no internet needed",
  "属于宝宝，也属于你的小小日常。":
    "For your baby, and for your everyday moments together.",
  宝宝档案: "Baby profile",
  "收起　⌃": "Collapse  ⌃",
  "展开　⌄": "Expand  ⌄",
  收起宝宝档案: "Collapse baby profile",
  展开宝宝档案: "Expand baby profile",
  宝宝头像: "Baby photo",
  "仅保存在这台设备，不会上传": "Saved only on this device and never uploaded",
  "网页预览不支持保存本机头像，请在手机安装版中设置。":
    "Saving a local photo is unavailable in the web preview. Set it in the installed mobile app.",
  更换照片: "Change photo",
  选择照片: "Choose photo",
  移除头像: "Remove photo",
  宝宝名字: "Baby's name",
  宝宝: "Baby",
  "出生日期 · 可暂不填写": "Birth date · optional for now",
  "性别 · 用于匹配成长参考曲线": "Sex · used for growth reference charts",
  男宝宝: "Boy",
  女宝宝: "Girl",
  暂不填写: "Not specified",
  保存档案: "Save profile",
  夜间模式: "Night mode",
  主题: "Theme",
  "展开{section}": "Expand {section}",
  "收起{section}": "Collapse {section}",
  打开宝宝档案: "Open baby profile",
  "自动（跟随系统）": "Automatic",
  浅色: "Light",
  深色: "Dark",
  "自动跟随设备的系统外观，选择后立即保存。":
    "Automatic follows your device’s appearance. Changes save immediately.",
  "默认跟随系统；手动切换后记住你的选择。":
    "Follows your system until you toggle it. Your choice is then saved.",
  "柔和配色，夜里也舒适": "Softer colors for bedtime.",
  语言: "Language",
  "跟随系统语言，或在这里固定选择显示语言。":
    "Follow your system language, or choose one here.",
  跟随系统: "Follow system",
  自动: "Auto",
  中文: "Chinese",
  简体中文: "Simplified Chinese",
  隐私与支持: "Privacy & support",
  "了解本机数据、备份和软件更新":
    "Learn about on-device data, backups, and updates",
  返回我的: "Back to More",
  了解数据如何留在本机: "See how your data stays on this device",
  "你的数据，由你掌控": "Your data stays with you",
  "小日子是一款离线记录工具：我们不提供账号、服务器或云同步。":
    "Little Days is an offline journal: we do not provide accounts, servers, or cloud sync.",
  本机记录: "On-device records",
  "宝宝档案、照护记录、主题、语言和提醒设定都保存在这台设备上。":
    "Baby profiles, care records, theme, language, and reminder settings stay on this device.",
  宝宝照片: "Baby photos",
  "只有在你主动选择照片时才会请求相册权限。头像会复制到本机，可随时在宝宝档案中移除。":
    "Photo access is requested only when you choose a photo. The avatar is copied on-device and can be removed from the baby profile at any time.",
  本地提醒: "Local reminders",
  "照护提醒由手机本地安排，不会将提醒内容上传到服务器。":
    "Care reminders are scheduled locally on your phone. Their content is not uploaded to a server.",
  备份与删除: "Backups and deletion",
  "备份文件只会在你主动导出和分享时离开应用。删除应用会移除设备上的本机数据，请先导出备份。":
    "Backup files leave the app only when you choose to export and share them. Deleting the app removes its on-device data, so export first.",
  软件更新: "Software updates",
  "应用会安全检查更新。更新服务可能收到设备系统版本和随机安装标记，但不包含宝宝记录或照片。":
    "The app securely checks for updates. The update service may receive the operating-system version and a random installation token, never baby records or photos.",
  联系支持: "Contact support",
  "这款应用可离线使用，无需账号。需要帮助？请发送邮件给我们。":
    "This app works offline without an account. Need help? Send us an email.",
  照护提醒: "Care reminders",
  "跟随模式会在每次保存喂奶后，按最新开始时间安排下一次提醒。":
    "Follow mode schedules the next reminder from the latest saved feed start time.",
  "按自己的需要设置。间隔提醒从现在算起，只提醒一次。":
    "Set this around your needs. Interval reminders count from now and run once.",
  "浏览器预览不支持本地通知，请在手机安装版中设置和测试。":
    "Local notifications are unavailable in the web preview. Set and test them in the installed mobile app.",
  换尿布: "Diaper",
  "提醒标题 · 可选": "Reminder title · optional",
  喂养提醒: "Feed reminder",
  尿布提醒: "Diaper reminder",
  睡眠提醒: "Sleep reminder",
  随最新喂养: "Follow latest feed",
  跟随: "Follow",
  仅提醒一次: "Remind once",
  稍后提醒一次: "Remind later once",
  一次: "Once",
  每天固定时间: "At the same time daily",
  每天: "Daily",
  "每天当地时间 · HH:mm": "Local time each day · HH:mm",
  喂养开始后多少分钟: "Minutes after feed start",
  多少分钟后: "Minutes from now",
  静音提醒: "Silent reminder",
  切换后自动保存: "Saves automatically when changed",
  提醒设置已自动保存: "Reminder settings saved automatically",
  主题已自动保存: "Theme saved automatically",
  添加提醒: "Add reminder",
  还没有待提醒事项: "No pending reminders",
  取消: "Cancel",
  备份与恢复: "Backup and restore",
  "记录保存在当前设备。换手机或卸载前，请导出备份并妥善保存。备份包含宝宝档案和全部记录，不含提醒；重新安装后需重新设置提醒。":
    "Records stay on this device. Export a backup before changing phones or uninstalling. Backups include the baby profile and all records, but not reminders; set reminders again after reinstalling.",
  导出备份文件: "Export backup",
  选择备份文件: "Choose backup file",
  查看上次替换前的数据: "View data before last replacement",
  确认替换当前数据: "Replace current data",
  取消恢复: "Cancel restore",
  "Little Days · 单机离线版": "Little Days · offline edition",
  "无需账号 · 无后台服务器 · 不共享 · 不上传照片":
    "No account · no server · no sharing · no photo uploads",
  日期按设备当地时区显示和统计: "Dates use your device's local time zone",
  "近 7 天": "Last 7 days",
  "7 天": "7 days",
  "2 周": "2 weeks",
  "1 个月": "1 month",
  "3 个月": "3 months",
  "6 个月": "6 months",
  "近 2 周": "Last 2 weeks",
  "近 1 个月": "Last month",
  "近 3 个月": "Last 3 months",
  "近 6 个月": "Last 6 months",
  全部记录: "All records",
  "所选时段没有{kind}记录": "No {kind} records in this period",
  "每根柱为最多 {count} 天合计；下方可展开每日明细。":
    "Each bar totals up to {count} days. Expand daily details below.",
  "还没有{kind}记录": "No {kind} records yet",
  "{count} 次喂奶 · {amount} mL · {duration}":
    "{count} feeds · {amount} mL · {duration}",
  "{count} 段睡眠 · {duration}": "{count} sleep sessions · {duration}",
  "{count} 次更换 · 有尿 {wet} 次 · 有便 {dirty} 次":
    "{count} changes · {wet} pee · {dirty} poo",
  "距上次 {duration}": "Since last {duration}",
  "开始于 {date}；本日时长见汇总":
    "Started {date}; see the day's summary for duration",
  未记时长: "No duration",
  "编辑 ›": "Edit ›",
  时长: "Duration",
  "● 瓶喂　● 亲喂只计时长，不估算奶量":
    "● Bottle feeds  ● Breastfeeds count duration only",
  "已记录睡眠，跨日拆分；重叠时段只计一次":
    "Sleep spans are split across days; overlaps count once",
  一次混合尿布按一次更换统计: "A pee + poo diaper counts as one change",
  删除: "Delete",
  编辑: "Edit",
  "编辑{kind}": "Edit {kind}",
  "删除{kind}": "Delete {kind}",
  更早的记录: "Earlier records",
  "显示 {count} 条历史记录": "Show {count} earlier records",
  收起历史记录: "Hide earlier records",
  "显示 {count} 天历史记录": "Show {count} earlier days",
  收起历史日期: "Hide earlier days",
  展开当日明细: "Show day details",
  收起当日明细: "Hide day details",
  "显示 {count} 条更早记录": "Show {count} older entries",
  收起当天较早记录: "Hide older entries for this day",
  还没有: "No ",
  "先在「我的」设置出生日期，即可按月龄查看曲线。":
    "Set a birth date in More to view charts by age.",
  "三项曲线按各自单位缩放；切换到单项可查看 WHO 参考。":
    "Each chart uses its own scale. Switch to one metric to see WHO references.",
  "● 宝宝实测　— WHO P50　┄ P3 / P15 / P85 / P97":
    "● Baby measurement  — WHO P50  ┄ P3 / P15 / P85 / P97",
  "设置性别后显示参考线。": "Set sex to show reference lines.",
  "WHO 0–24月参考；月龄按天数 ÷ 30.4375 展示。":
    "WHO reference for 0–24 months; age in months is days ÷ 30.4375.",
  "曲线用于记录趋势，不作诊断。":
    "Charts show trends and are not for diagnosis.",
  "还没有{metric}记录": "No {metric} records yet",
  "{months}月": "{months} mo",
  "{reference} 曲线用于记录趋势，不作诊断。":
    "{reference} Charts show trends and are not for diagnosis.",
  重新读取: "Reload",
  从备份文件恢复: "Restore from backup",
  读取恢复副本: "Open recovery copy",
  确认恢复: "Confirm restore",
  确认删除: "Delete record",
  关闭提示: "Close message",
  "日期或时间无效，请检查输入":
    "Invalid date or time. Please check your input.",
  "时间格式应为 YYYY-MM-DD 和 HH:mm":
    "Use YYYY-MM-DD and HH:mm for date and time.",
  请填写已经发生的时间: "Use a time that has already occurred.",
  请填写实际喝奶量: "Enter the amount fed.",
  "保存失败，请重试": "Couldn't save. Please try again.",
  "操作失败，请重试": "Couldn't complete that action. Please try again.",
  暂时无法读取提醒: "Couldn't load reminders right now.",
  请填写提醒间隔: "Enter a reminder interval.",
  "时间格式应为 HH:mm": "Use HH:mm for time.",
  提醒已添加: "Reminder added",
  "提醒已添加；保存下一次喂养后会自动重置":
    "Reminder added; it will reset after the next saved feed.",
  提醒已取消: "Reminder cancelled",
  已保存到本机: "Saved on this device",
  宝宝头像已保存到本机: "Baby photo saved on this device",
  宝宝头像已移除: "Baby photo removed",
  宝宝档案已保存: "Baby profile saved",
  出生日期不能在未来: "Birth date cannot be in the future",
  "导出操作已完成，请确认备份文件已保存":
    "Export complete. Check that the backup file was saved.",
  "暂无恢复副本；首次导入并替换记录后会保留一份":
    "No recovery copy yet. The first imported replacement keeps one copy.",
  "记录已恢复；头像已移除，现有提醒保持不变，请按需检查":
    "Records restored; the photo was removed and existing reminders were kept. Please check them.",
  "无法读取本地数据，原数据没有被覆盖。":
    "Couldn't read local data; your existing data was not overwritten.",
  "用「{name}」的 {count} 条记录替换当前数据？":
    "Replace current data with {count} records from “{name}”?",
  "正在保存，请稍后再试": "Saving now. Please try again shortly.",
  记录日期不能早于出生日期: "A record cannot be earlier than the birth date.",
  "删除这条{kind}记录？": "Delete this {kind} record?",
  "喂养方式：{kind}": "Feeding method: {kind}",
  "{title}日期": "{title} date",
  "{title}时刻": "{title} time",
  完成: "Done",
  备份文件: "Backup file",
  上次替换前的数据: "Data before last replacement",
  "确认恢复：{source}": "Restore: {source}",
  "{name} · {count} 条记录": "{name} · {count} records",
  "这会替换当前「{name}」的 {count} 条记录，不会合并。替换前的数据会保留一份，可从上方入口恢复。":
    "This replaces the {count} current records for “{name}”; it does not merge them. A copy of the replaced data remains available above.",
  "统计图，单位{unit}，数值见每日汇总和明细":
    "Chart in {unit}; values appear in the daily summary and details.",
  没有恢复副本: "No recovery copy available",
  语言已保存: "Language saved",
  出生日期无效: "Invalid birth date",
  "请填写 1–10080 分钟": "Enter a value from 1 to 10,080 minutes.",
  安静提醒: "Quiet reminder",
  请在手机设置中允许通知后再试:
    "Allow notifications in your phone settings, then try again.",
  "随最新喂养 · {time}": "Follow latest feed · {time}",
  "距离上次喂养已到设定间隔。": "The interval since the latest feed has ended.",
  "每天 {time}": "Every day at {time}",
  "按宝宝当下的需要安排照护。": "Plan care around your baby's current needs.",
  "请先保存一条喂养记录，再启用自动提醒":
    "Save a feed record before turning on an automatic reminder.",
  "本地提醒需要在 iPhone 或 Android 真机中设置，网页预览不支持。":
    "Local reminders need an installed iPhone or Android app; the web preview does not support them.",
  小时: "hours",
  次: "changes",
  分钟: "min",
  天: " days",
  "{name}的小日子": "{name}'s little days",
  "正在睡 · {duration}": "Sleeping · {duration}",
  "已睡 {duration}": "Asleep for {duration}",
  "上次 {time} · {duration}前": "Last {time} · {duration} ago",
  "身长 {value} cm": "Length {value} cm",
  "头围 {value} cm": "Head {value} cm",
};

let activeLocale: AppLocale = "zh-CN";

export function resolveLocale(preference: LanguagePreference): AppLocale {
  if (preference === "zh") return "zh-CN";
  if (preference === "en") return "en-US";
  return getLocales()[0]?.languageCode?.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export function setActiveLocale(locale: AppLocale) {
  activeLocale = locale;
}

export function currentLocale() {
  return activeLocale;
}

export function t(source: string, values?: TranslationValues): string {
  const template =
    activeLocale === "en-US" ? (english[source] ?? source) : source;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    String(values[name] ?? ""),
  );
}

export function formatTime(
  value: string | number | Date,
  locale = activeLocale,
) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
  },
  locale = activeLocale,
) {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

export function elapsed(ms: number, locale = activeLocale) {
  const minutes = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 60000);
  if (locale === "en-US") {
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  }
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}小时${minutes % 60}分`
    : `${minutes}分钟`;
}

export function age(
  birthDate: string,
  now = new Date(),
  locale = activeLocale,
) {
  if (!birthDate) return locale === "en-US" ? "Set birth date" : "设置出生日期";
  const [year, month, day] = birthDate.split("-").map(Number);
  const days = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(year, month - 1, day)) /
      86400000,
  );
  if (days < 0)
    return locale === "en-US"
      ? "Birth date is in the future"
      : "出生日期在未来";
  return locale === "en-US"
    ? `${days} days · ${Math.floor(days / 7)}w ${days % 7}d`
    : `${days}天 · ${Math.floor(days / 7)}周${days % 7}天`;
}

type I18nValue = { locale: AppLocale; t: typeof t };
const I18nContext = createContext<I18nValue>({ locale: activeLocale, t });

export function I18nProvider({
  locale,
  children,
}: {
  locale: AppLocale;
  children: React.ReactNode;
}) {
  setActiveLocale(locale);
  const value = useMemo(() => ({ locale, t }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
