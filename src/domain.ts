export type EntryType = "feed" | "diaper" | "sleep" | "growth" | "milestone";
export const supplementKinds = [
  "vitamin-d",
  "probiotics",
  "iron",
  "multivitamin",
  "other",
] as const;
export type SupplementKind = (typeof supplementKinds)[number];
export type CareRecord = {
  id: string;
  kind: "temperature" | "bath" | "wash" | "oral" | "nails" | "supplement";
  time: string;
  note: string;
  temperature?: number;
  method?: "armpit" | "ear" | "forehead" | "rectal" | "other";
  supplements?: SupplementKind[];
  otherSupplement?: string;
};
export type Entry = {
  id: string;
  type: EntryType;
  start: string;
  end?: string;
  feedRunning?: true;
  amount?: number;
  feedKind?:
    "formula" | "expressed" | "breast-left" | "breast-right" | "breast-both";
  diaperKind?: "wet" | "dirty" | "mixed";
  weight?: number;
  length?: number;
  head?: number;
  title?: string;
  note: string;
};
export type State = {
  schemaVersion: 1;
  profile: {
    name: string;
    birthDate: string;
    sex: "male" | "female" | "unspecified";
  };
  entries: Entry[];
  careRecords?: CareRecord[];
};
export const initialState: State = {
  schemaVersion: 1,
  profile: { name: "Baby", birthDate: "", sex: "unspecified" },
  entries: [],
};
const fail = (message: string): never => {
  throw new Error(message);
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("数据格式无效");
  return value as Record<string, unknown>;
}
function string(
  value: unknown,
  field: string,
  max: number,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim())
  )
    return fail(`${field}无效`);
  return value;
}
function dateOnly(value: unknown): string {
  const s = string(value, "出生日期", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
    return fail("出生日期格式应为 YYYY-MM-DD");
  const d = new Date(`${s}T00:00:00Z`);
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s ||
    Number(s.slice(0, 4)) < 1900
  )
    return fail("出生日期无效");
  return s;
}
function instant(value: unknown): string {
  const s = string(value, "记录时间", 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      s,
    )
  )
    return fail("记录时间需要带时区");
  dateOnly(s.slice(0, 10));
  if (
    !Number.isFinite(Date.parse(s)) ||
    Number(s.slice(11, 13)) > 23 ||
    Number(s.slice(14, 16)) > 59 ||
    Number(s.slice(17, 19)) > 59
  )
    return fail("记录时间无效");
  return s;
}
function number(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    return fail(`${field}超出有效范围`);
  return value;
}
export function validateEntry(input: unknown): Entry {
  const e = object(input);
  const type = e.type as EntryType;
  if (!["feed", "diaper", "sleep", "growth", "milestone"].includes(type))
    return fail("记录类型无效");
  const out: Entry = {
    id: string(e.id, "记录编号", 128),
    type,
    start: instant(e.start),
    note: string(e.note, "备注", 10000, true),
  };
  const allowed = ["id", "type", "start", "note"];
  if (type === "sleep" || type === "feed") {
    allowed.push("end");
    if (e.end !== undefined) {
      out.end = instant(e.end);
      if (Date.parse(out.end) < Date.parse(out.start))
        return fail("结束时间不能早于开始时间");
    }
  }
  if (type === "feed") {
    allowed.push("feedKind", "amount", "feedRunning");
    if (e.feedRunning !== undefined) {
      if (e.feedRunning !== true || out.end) return fail("喂养计时状态无效");
      out.feedRunning = true;
    }
    if (
      ![
        "formula",
        "expressed",
        "breast-left",
        "breast-right",
        "breast-both",
      ].includes(e.feedKind as string)
    )
      return fail("喂养方式无效");
    out.feedKind = e.feedKind as Entry["feedKind"];
    if (e.feedKind === "formula" || e.feedKind === "expressed")
      out.amount = number(e.amount, "奶量", 0, 2000);
    else if (e.amount !== undefined) return fail("亲喂不能填写估算奶量");
  }
  if (type === "diaper") {
    allowed.push("diaperKind");
    if (!["wet", "dirty", "mixed"].includes(e.diaperKind as string))
      return fail("尿布类型无效");
    out.diaperKind = e.diaperKind as Entry["diaperKind"];
  }
  if (type === "growth") {
    allowed.push("weight", "length", "head");
    if (
      e.weight === undefined &&
      e.length === undefined &&
      e.head === undefined
    )
      return fail("至少填写一项测量");
    if (e.weight !== undefined) out.weight = number(e.weight, "体重", 0.1, 200);
    if (e.length !== undefined) out.length = number(e.length, "身长", 10, 250);
    if (e.head !== undefined) out.head = number(e.head, "头围", 10, 100);
  }
  if (type === "milestone") {
    allowed.push("title");
    out.title = string(e.title, "里程碑标题", 200);
  }
  if (Object.keys(e).some((k) => !allowed.includes(k)))
    return fail("记录包含不支持的字段");
  return out;
}
export function validateCareRecord(input: unknown): CareRecord {
  const r = object(input);
  if (
    !["temperature", "bath", "wash", "oral", "nails", "supplement"].includes(
      r.kind as string,
    )
  )
    return fail("照护类型无效");
  const out: CareRecord = {
    id: string(r.id, "记录编号", 128),
    kind: r.kind as CareRecord["kind"],
    time: instant(r.time),
    note: string(r.note, "备注", 10000, true),
  };
  const allowed = ["id", "kind", "time", "note"];
  if (out.kind === "temperature") {
    allowed.push("temperature", "method");
    out.temperature = number(r.temperature, "体温", 25, 45);
    if (
      !["armpit", "ear", "forehead", "rectal", "other"].includes(
        r.method as string,
      )
    )
      return fail("测量方式无效");
    out.method = r.method as CareRecord["method"];
  }
  if (out.kind === "supplement") {
    allowed.push("supplements", "otherSupplement");
    if (
      !Array.isArray(r.supplements) ||
      r.supplements.length < 1 ||
      r.supplements.length > supplementKinds.length ||
      new Set(r.supplements).size !== r.supplements.length ||
      r.supplements.some((value) => !supplementKinds.includes(value))
    )
      return fail("请选择有效的补充剂");
    out.supplements = [...r.supplements] as SupplementKind[];
    if (out.supplements.includes("other"))
      out.otherSupplement = string(
        r.otherSupplement,
        "其他补充剂名称",
        100,
      ).trim();
    else if (r.otherSupplement !== undefined)
      return fail("请选择其他补充剂后填写名称");
  }
  if (Object.keys(r).some((key) => !allowed.includes(key)))
    return fail("照护记录包含不支持的字段");
  return out;
}
export function validateState(input: unknown): State {
  const s = object(input),
    p = object(s.profile);
  if (s.schemaVersion !== 1) return fail("不支持此备份版本");
  if (
    Object.keys(s).some(
      (k) =>
        !["schemaVersion", "profile", "entries", "careRecords"].includes(k),
    ) ||
    Object.keys(p).some((k) => !["name", "birthDate", "sex"].includes(k))
  )
    return fail("备份包含不支持的字段");
  if (!["male", "female", "unspecified"].includes(p.sex as string))
    return fail("性别设置无效");
  if (!Array.isArray(s.entries) || s.entries.length > 100000)
    return fail("记录列表无效或过大");
  const entries = s.entries.map(validateEntry);
  if (entries.filter((e) => e.feedRunning).length > 1)
    return fail("请先停止正在进行的喂养");
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    return fail("备份包含重复记录编号");
  if (entries.filter((e) => e.type === "sleep" && !e.end).length > 1)
    return fail("只能有一个进行中的睡眠");
  let careRecords: CareRecord[] | undefined;
  if (s.careRecords !== undefined) {
    if (!Array.isArray(s.careRecords) || s.careRecords.length > 100000)
      return fail("照护记录列表无效或过大");
    careRecords = s.careRecords.map(validateCareRecord);
    if (new Set(careRecords.map((r) => r.id)).size !== careRecords.length)
      return fail("照护记录编号重复");
  }
  return {
    schemaVersion: 1,
    profile: {
      name: string(p.name, "宝宝名字", 100),
      birthDate: p.birthDate === "" ? "" : dateOnly(p.birthDate),
      sex: p.sex as State["profile"]["sex"],
    },
    entries,
    ...(careRecords === undefined ? {} : { careRecords }),
  };
}
export function summarize(entries: Entry[], from: Date, to: Date) {
  const a = from.getTime(),
    b = to.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
    return fail("统计日期范围无效");
  const summary = {
    feedMl: 0,
    feedCount: 0,
    sleepMinutes: 0,
    diaperCount: 0,
    wetCount: 0,
    dirtyCount: 0,
  };
  const sleepIntervals: [number, number][] = [];
  for (const e of entries) {
    const t = Date.parse(e.start);
    if (e.type === "sleep" && e.end) {
      const start = Math.max(t, a),
        end = Math.min(Date.parse(e.end), b);
      if (end > start) sleepIntervals.push([start, end]);
    }
    if (t < a || t >= b) continue;
    if (e.type === "feed") {
      summary.feedCount++;
      summary.feedMl += e.amount ?? 0;
    }
    if (e.type === "diaper") {
      summary.diaperCount++;
      if (e.diaperKind !== "dirty") summary.wetCount++;
      if (e.diaperKind !== "wet") summary.dirtyCount++;
    }
  }
  sleepIntervals.sort((x, y) => x[0] - y[0]);
  let mergedStart: number | undefined,
    mergedEnd = 0;
  for (const [start, end] of sleepIntervals) {
    if (mergedStart === undefined || start > mergedEnd) {
      if (mergedStart !== undefined)
        summary.sleepMinutes += (mergedEnd - mergedStart) / 60000;
      mergedStart = start;
      mergedEnd = end;
    } else mergedEnd = Math.max(mergedEnd, end);
  }
  if (mergedStart !== undefined)
    summary.sleepMinutes += (mergedEnd - mergedStart) / 60000;
  return summary;
}
export function elapsedLabel(ms: number): string {
  const minutes = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 60000);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}小时${minutes % 60}分`
    : `${minutes}分钟`;
}
export function ageLabel(birthDate: string, now = new Date()): string {
  if (!birthDate) return "设置出生日期";
  try {
    dateOnly(birthDate);
  } catch {
    return "出生日期无效";
  }
  const [y, m, d] = birthDate.split("-").map(Number);
  const days = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(y, m - 1, d)) /
      86400000,
  );
  if (days < 0) return "出生日期在未来";
  return `${days}天 · ${Math.floor(days / 7)}周${days % 7}天`;
}
export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
