import React, { useCallback, useContext, useRef, useState } from "react";
import {
  Keyboard,
  Linking,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import Modal from "./AccessibleModal";
import RecordActionButton from "./RecordActionButton";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Button, Card, Field, T, Theme } from "./ui";
import { formatEditableNumber, formatNumber, useI18n } from "./i18n";
import {
  CareRecord,
  SupplementKind,
  validateCareRecord,
  makeId,
} from "./domain";
import {
  careOptions,
  careTime,
  temperatureMethods,
  defaultTemperatureMethod,
  defaultTemperatureInput,
  parseTemperatureInput,
  supplementOptions,
} from "./care";
import PlayIcon from "./PlayIcon";
import HelpDisclosure from "./HelpDisclosure";
import { playDayKey, type LearningText } from "./learning";
import {
  boundedCarePickerDate,
  updateCarePickerDate,
  type CarePickerMode,
} from "./careDateTime";

export default function DailyCare({
  records,
  birthDate,
  now,
  onSave,
  onDelete,
  sharedMode = false,
  supplementsEnabled = !sharedMode,
  versions = {},
  canEdit = () => true,
}: {
  records: CareRecord[];
  birthDate: string;
  now: number;
  onSave: (record: CareRecord, baseVersion?: string) => Promise<void>;
  onDelete: (id: string, baseVersion?: string) => Promise<void>;
  sharedMode?: boolean;
  supplementsEnabled?: boolean;
  versions?: Record<string, string>;
  canEdit?: (id: string) => boolean;
}) {
  const c = useContext(Theme);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { formattingLocale, localize: text } = useI18n();
  const copy = (w: LearningText) => text(w.zh, w.en);
  const [kind, setKind] = useState<CareRecord["kind"]>("temperature");
  const [temperature, setTemperature] = useState(() =>
    formatEditableNumber(Number(defaultTemperatureInput), formattingLocale),
  );
  const [supplements, setSupplements] = useState<SupplementKind[]>([]);
  const [otherSupplement, setOtherSupplement] = useState("");
  const [method, setMethod] = useState<CareRecord["method"]>(
    defaultTemperatureMethod,
  );
  const [date, setDate] = useState(playDayKey(new Date(now)));
  const [time, setTime] = useState(new Date(now).toTimeString().slice(0, 5));
  const [picker, setPicker] = useState<{
    mode: CarePickerMode;
    value: Date;
  } | null>(null);
  const pickerContext = useRef({ picker, now, birthDate });
  pickerContext.current = { picker, now, birthDate };
  // Android reopens its dialog when onChange changes. Keep it stable while the
  // app clock ticks, but use fresh bounds when the user finally confirms.
  const onPickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date) => {
      const latest = pickerContext.current;
      if (!picker || picker !== latest.picker) return;
      if (event.type !== "set" || !selected) {
        if (Platform.OS !== "ios") setPicker(null);
        return;
      }
      const value = updateCarePickerDate(
        picker.value,
        selected,
        picker.mode,
        latest.now,
        latest.birthDate,
      );
      if (Platform.OS === "ios") setPicker({ ...picker, value });
      else {
        setDate(playDayKey(value));
        setTime(value.toTimeString().slice(0, 5));
        setPicker(null);
      }
    },
    [picker],
  );
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<LearningText | null>(null);
  const lock = useRef(false);
  const editingVersion = useRef<string | undefined>(undefined);
  const deleteVersion = useRef<string | undefined>(undefined);
  const option = careOptions.find((o) => o.id === kind)!;
  const history = records
    .filter((r) => r.kind === kind)
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const shown = expanded ? history : history.slice(0, 3);
  function openPicker(mode: CarePickerMode) {
    Keyboard.dismiss();
    setPicker({
      mode,
      value: boundedCarePickerDate(
        new Date(`${date}T${time}:00`),
        now,
        birthDate,
      ),
    });
  }
  function acceptPicker(value: Date) {
    const bounded = boundedCarePickerDate(value, now, birthDate);
    setDate(playDayKey(bounded));
    setTime(bounded.toTimeString().slice(0, 5));
    setPicker(null);
  }
  function dateTimeField(mode: CarePickerMode) {
    const label =
      mode === "date"
        ? text("照护日期", "Care date")
        : text("照护时间", "Care time");
    const value = mode === "date" ? date : time;
    if (Platform.OS === "web")
      return (
        <Field
          editable={!busy}
          label={label}
          value={value}
          onChange={mode === "date" ? setDate : setTime}
          placeholder={mode === "date" ? "YYYY-MM-DD" : "HH:mm"}
          maxLength={mode === "date" ? 10 : 5}
        />
      );
    return (
      <View style={{ gap: 8 }}>
        <T raw style={{ fontSize: 12, color: c.muted }}>
          {label}
        </T>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityValue={{ text: value }}
          accessibilityState={{
            disabled: busy,
            expanded: picker?.mode === mode,
          }}
          disabled={busy}
          onPress={() => openPicker(mode)}
          style={({ pressed }) => ({
            backgroundColor: c.input,
            borderWidth: 1,
            borderColor: c.controlLine,
            borderRadius: 14,
            minHeight: 48,
            paddingHorizontal: 12,
            paddingVertical: 10,
            justifyContent: "center",
            opacity: busy ? 0.4 : pressed ? 0.7 : 1,
          })}
        >
          <T raw>{value}</T>
        </Pressable>
      </View>
    );
  }
  const nativePicker = picker ? (
    <DateTimePicker
      value={boundedCarePickerDate(picker.value, now, birthDate)}
      mode={picker.mode}
      display={Platform.OS === "ios" ? "spinner" : "default"}
      themeVariant={c.isDark ? "dark" : "light"}
      locale={formattingLocale}
      is24Hour
      minimumDate={birthDate ? new Date(`${birthDate}T00:00:00`) : undefined}
      maximumDate={new Date(now)}
      onChange={onPickerChange}
    />
  ) : null;
  function reset() {
    setPicker(null);
    setTemperature(
      formatEditableNumber(Number(defaultTemperatureInput), formattingLocale),
    );
    setMethod(defaultTemperatureMethod);
    setSupplements([]);
    setOtherSupplement("");
    setNote("");
    setEditing(null);
    editingVersion.current = undefined;
    setDate(playDayKey(new Date(now)));
    setTime(new Date(now).toTimeString().slice(0, 5));
  }
  async function save() {
    if (lock.current) return;
    if (kind === "supplement" && !supplementsEnabled) return;
    if (editing && !canEdit(editing)) {
      setMessage({
        zh: "你只能修改自己创建的记录；管理员可以修改所有记录。",
        en: "You can edit your own records; the admin can edit all records.",
      });
      return;
    }
    setMessage(null);
    let record: CareRecord;
    try {
      const at = careTime(date, time, now, birthDate);
      record = validateCareRecord({
        id: editing ?? makeId(),
        kind,
        time: at,
        note,
        ...(kind === "temperature"
          ? { temperature: parseTemperatureInput(temperature), method }
          : {}),
        ...(kind === "supplement"
          ? {
              supplements,
              ...(supplements.includes("other")
                ? { otherSupplement: otherSupplement.trim() }
                : {}),
            }
          : {}),
      });
    } catch {
      setMessage(
        kind === "supplement"
          ? {
              zh: "请选择至少一种补充剂；选择其他时请填写名称（最多 100 字），并检查日期和时间。",
              en: "Select at least one supplement. For Other, enter a name (up to 100 characters), and check the date and time.",
            }
          : {
              zh: "请检查日期、时间和读数；体温需为 25–45°C 并选择测量方式，时间不能晚于现在或早于出生。",
              en: "Check the date, time and reading. Temperature must be 25–45°C with a measurement method; time cannot be in the future or before birth.",
            },
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await onSave(record, editingVersion.current);
      reset();
      setMessage({ zh: "照护记录已保存", en: "Care record saved" });
    } catch {
      setMessage({
        zh: "照护记录未保存，请重试。",
        en: "Care record was not saved. Please try again.",
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (lock.current || !canEdit(id)) return;
    lock.current = true;
    setBusy(true);
    try {
      await onDelete(id, deleteVersion.current);
      setConfirm(null);
      if (editing === id) reset();
      setMessage({ zh: "照护记录已删除", en: "Care record deleted" });
    } catch {
      setMessage({
        zh: "删除失败，记录仍保留，请重试。",
        en: "Deletion failed. The record is still saved; please try again.",
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function openSource(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setMessage({
        zh: "无法打开来源，请检查网络。",
        en: "Could not open the source. Check your connection.",
      });
    }
  }
  return (
    <View style={{ gap: 14 }}>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 5,
        }}
      >
        {careOptions.map((o) => (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            accessibilityLabel={copy(o.label)}
            accessibilityState={{ selected: kind === o.id, disabled: busy }}
            aria-pressed={kind === o.id}
            disabled={busy}
            onPress={() => {
              setKind(o.id);
              reset();
              setConfirm(null);
              setExpanded(false);
              setMessage(null);
            }}
            style={{
              flex: 1,
              flexBasis: largeText ? "44%" : "30%",
              flexGrow: 1,
              minWidth: 0,
              minHeight: 62,
              paddingVertical: 8,
              paddingHorizontal: 3,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 14,
              borderWidth: 1,
              borderColor: kind === o.id ? c.primary : c.line,
              backgroundColor: kind === o.id ? c.soft : c.card,
            }}
          >
            <PlayIcon kind={o.icon} color={c.primary} />
            <T raw style={{ fontSize: 11, textAlign: "center" }}>
              {copy(o.label)}
            </T>
          </Pressable>
        ))}
      </View>
      <Card style={{ padding: 14, gap: 12 }}>
        <T raw style={{ fontWeight: "700" }}>
          {editing
            ? text("编辑照护记录", "Edit care record")
            : text("记录一次照护", "Record a care session")}
        </T>
        {kind === "temperature" ? (
          <>
            <Field
              editable={!busy}
              label={text("体温 · °C", "Temperature · °C")}
              value={temperature}
              onChange={setTemperature}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={8}
              placeholder={text("请输入实际读数", "Enter the measured reading")}
            />
            <T raw style={{ fontSize: 13, lineHeight: 20, fontWeight: "600" }}>
              {text(
                "未满 3 个月且体温 ≥38°C，请立即就医。任何年龄出现呼吸困难、难以唤醒或抽搐，应立即寻求急救，不要等记录完成。",
                "Under 3 months with a temperature of 38°C or above: seek urgent medical care. At any age, breathing difficulty, difficulty waking or seizures need emergency help. Do not wait to finish recording.",
              )}
            </T>
            <T raw style={{ fontSize: 12, color: c.muted }}>
              {text(
                "测量方式 · 默认腋下，请按实际部位选择",
                "Measurement method · defaults to armpit; select the site used",
              )}
            </T>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {temperatureMethods.map((m) => (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  accessibilityLabel={copy(m.label)}
                  accessibilityState={{
                    selected: method === m.id,
                    disabled: busy,
                  }}
                  aria-pressed={method === m.id}
                  accessibilityShowsLargeContentViewer={Platform.OS === "ios"}
                  accessibilityLargeContentTitle={copy(m.label)}
                  disabled={busy}
                  onPress={() => setMethod(m.id)}
                  style={{
                    flexBasis: largeText ? "100%" : "30%",
                    flexGrow: 1,
                    minWidth: 80,
                    minHeight: 88,
                    paddingVertical: 16,
                    paddingHorizontal: 8,
                    gap: 6,
                    justifyContent: "center",
                    alignItems: "center",
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: method === m.id ? c.primary : c.line,
                    backgroundColor: method === m.id ? c.soft : c.bg,
                  }}
                >
                  <PlayIcon kind={m.id} color={c.primary} size={30} />
                  <T raw style={{ fontSize: 12, textAlign: "center" }}>
                    {copy(m.label)}
                  </T>
                  {method === m.id ? (
                    <View style={{ position: "absolute", top: 4, right: 4 }}>
                      <PlayIcon kind="check" color={c.primary} size={16} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
            <T raw style={{ fontSize: 12, color: c.muted }}>
              {text("已选择：", "Selected: ")}
              {copy(temperatureMethods.find((m) => m.id === method)!.label)}
            </T>
          </>
        ) : null}
        {kind === "supplement" ? (
          <View style={{ gap: 10 }}>
            <T raw style={{ fontSize: 13, color: c.muted }}>
              {copy(option.hint)}
            </T>
            {!supplementsEnabled ? (
              <T raw accessibilityRole="alert">
                {text(
                  "家庭服务尚未支持补充剂记录，更新服务并刷新后可用。",
                  "Supplement sharing needs a service update. Refresh after the update to enable it.",
                )}
              </T>
            ) : null}
            {supplementOptions.map((item) => {
              const checked = supplements.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={copy(item.label)}
                  aria-checked={checked}
                  aria-disabled={busy || !supplementsEnabled}
                  accessibilityState={{
                    checked,
                    disabled: busy || !supplementsEnabled,
                  }}
                  disabled={busy || !supplementsEnabled}
                  onPress={() =>
                    setSupplements((selected) =>
                      checked
                        ? selected.filter((value) => value !== item.id)
                        : [...selected, item.id],
                    )
                  }
                  style={{
                    minHeight: 44,
                    padding: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: checked ? c.primary : c.line,
                    backgroundColor: checked ? c.soft : c.bg,
                  }}
                >
                  <T raw accessible={false} style={{ color: c.primary }}>
                    {checked ? "☑" : "☐"}
                  </T>
                  <T raw style={{ flex: 1 }}>
                    {copy(item.label)}
                  </T>
                </Pressable>
              );
            })}
            {supplements.includes("other") ? (
              <Field
                label={text("其他补充剂名称", "Other supplement name")}
                value={otherSupplement}
                onChange={setOtherSupplement}
                maxLength={100}
                editable={!busy && supplementsEnabled}
              />
            ) : null}
          </View>
        ) : null}
        {"safety" in option && kind !== "supplement" ? (
          <T raw style={{ fontSize: 13, color: c.muted, lineHeight: 20 }}>
            {copy(option.safety)}
          </T>
        ) : null}
        {kind === "bath" ? (
          <T raw style={{ fontSize: 13, color: c.muted, lineHeight: 20 }}>
            {copy(option.hint)}
          </T>
        ) : null}
        <View style={{ flexDirection: largeText ? "column" : "row", gap: 8 }}>
          <View style={{ flex: 1.4, minWidth: 0 }}>
            {dateTimeField("date")}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>{dateTimeField("time")}</View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => {
            setDate(playDayKey(new Date(now)));
            setTime(new Date(now).toTimeString().slice(0, 5));
          }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <T raw style={{ color: c.primary, fontSize: 12 }}>
            {text("使用当前时间", "Use current time")}
          </T>
        </Pressable>
        <Field
          editable={!busy}
          label={text("照护备注", "Care notes")}
          value={note}
          onChange={setNote}
          maxLength={1000}
        />
        <Button
          label={text("保存照护记录", "Save care record")}
          disabled={busy || (kind === "supplement" && !supplementsEnabled)}
          onPress={() => void save()}
        />
        {editing ? (
          <Button
            label={text("取消编辑", "Cancel edit")}
            secondary
            disabled={busy}
            onPress={reset}
          />
        ) : null}
      </Card>
      {message ? (
        <T
          raw
          accessibilityRole="alert"
          style={{ fontSize: 13, color: c.primary }}
        >
          {copy(message)}
        </T>
      ) : null}
      <View style={{ gap: 4 }}>
        <T raw style={{ fontWeight: "700" }}>
          {copy(option.label)} · {text("历史记录", "History")} ({history.length}
          )
        </T>
        {!history.length ? (
          <T raw style={{ fontSize: 13, color: c.muted }}>
            {text(
              "还没有记录，保存后会保留在这里。",
              "No records yet. Saved sessions will stay here.",
            )}
          </T>
        ) : null}
        {shown.map((r) => (
          <View
            key={r.id}
            style={{
              borderBottomWidth: 1,
              borderBottomColor: c.line,
              paddingVertical: 10,
              gap: 4,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 6,
              }}
            >
              <View style={{ flex: 1, minWidth: largeText ? "100%" : 0 }}>
                <T raw style={{ fontSize: 14, fontWeight: "600" }}>
                  {r.kind === "temperature"
                    ? `${formatNumber(r.temperature!, {}, formattingLocale)}°C · ${copy(temperatureMethods.find((m) => m.id === r.method)!.label)}`
                    : r.kind === "supplement"
                      ? r
                          .supplements!.map((id) =>
                            id === "other"
                              ? r.otherSupplement
                              : copy(
                                  supplementOptions.find(
                                    (item) => item.id === id,
                                  )!.label,
                                ),
                          )
                          .join(" · ")
                      : copy(option.label)}
                </T>
                <T raw style={{ fontSize: 12, color: c.muted }}>
                  {new Date(r.time).toLocaleString(formattingLocale, {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </T>
              </View>
              <RecordActionButton
                action="edit"
                accessibilityLabel={text("编辑照护记录", "Edit care record")}
                accessibilityHint={text(
                  "打开记录编辑界面",
                  "Opens the record editor",
                )}
                disabled={busy || !canEdit(r.id)}
                onPress={() => {
                  if (!canEdit(r.id)) return;
                  editingVersion.current = versions[r.id];
                  setEditing(r.id);
                  setDate(playDayKey(new Date(r.time)));
                  setTime(new Date(r.time).toTimeString().slice(0, 5));
                  setTemperature(
                    r.temperature === undefined
                      ? ""
                      : formatEditableNumber(r.temperature, formattingLocale),
                  );
                  setMethod(r.method);
                  setSupplements(r.supplements ?? []);
                  setOtherSupplement(r.otherSupplement ?? "");
                  setNote(r.note);
                  setMessage(null);
                }}
              />
              <RecordActionButton
                action="delete"
                accessibilityLabel={text("删除照护记录", "Delete care record")}
                accessibilityHint={text(
                  "打开删除确认",
                  "Opens a confirmation before deleting",
                )}
                disabled={busy || !canEdit(r.id)}
                onPress={() => {
                  if (canEdit(r.id)) {
                    deleteVersion.current = versions[r.id];
                    setConfirm(r.id);
                  }
                }}
              />
            </View>
            {r.note ? (
              <T raw style={{ fontSize: 12, color: c.muted }}>
                {r.note}
              </T>
            ) : null}
            {confirm === r.id ? (
              <View style={{ gap: 8 }}>
                <T raw>
                  {text(
                    "确定删除这条照护记录？无法撤销。",
                    "Delete this care record? This cannot be undone.",
                  )}
                </T>
                <Button
                  label={text("确认删除照护记录", "Confirm care deletion")}
                  disabled={busy || !canEdit(r.id)}
                  onPress={() => void remove(r.id)}
                />
                <Button
                  label={text("取消删除", "Cancel deletion")}
                  secondary
                  disabled={busy}
                  onPress={() => setConfirm(null)}
                />
              </View>
            ) : null}
          </View>
        ))}
        {history.length > 3 ? (
          <Button
            label={
              expanded
                ? text("收起照护历史", "Collapse care history")
                : text(
                    "展开更早的 {count} 条照护记录",
                    "Show {count} older care records",
                    { count: history.length - 3 },
                  )
            }
            secondary
            onPress={() => setExpanded(!expanded)}
          />
        ) : null}
      </View>
      <HelpDisclosure
        key={kind}
        title={
          kind === "supplement"
            ? text(
                "补充剂建议、注意事项与参考",
                "Supplement guidance & references",
              )
            : text("记录说明与参考", "Recording help & references")
        }
      >
        {kind === "supplement" ? (
          <>
            <T raw style={{ fontSize: 15, lineHeight: 22 }}>
              {text(
                "维生素 D（VD）：是否需要补充取决于喂养方式、配方奶摄入量及缺乏风险；请按当地儿科医生建议选择适龄产品和剂量，不要把列表当作每日必服清单。",
                "Vitamin D (VD): need depends on feeding, formula intake and deficiency risk. Ask your baby's clinician about an age-appropriate product and dose; this list is not a daily checklist.",
              )}
            </T>
            <T raw style={{ fontSize: 15, lineHeight: 22 }}>
              {text(
                "益生菌：效果与菌株及具体情况有关，不是所有宝宝都需要。早产、重病或免疫功能受损的宝宝可能有严重感染风险，使用前应咨询医生。",
                "Probiotics: effects depend on the strain and condition; they are not needed by every baby. Premature, seriously ill or immunocompromised babies may be at risk of serious infection. Consult their clinician before use.",
              )}
            </T>
            <T raw style={{ fontSize: 15, lineHeight: 22 }}>
              {text(
                "铁及复合维生素：仅按医生评估或处方给予。注意产品成分重叠，核对浓度与实际用量；不要叠加相同成分或因漏服自行加倍。记录不代替专业建议，也不代表给药提醒。",
                "Iron and multivitamins: give only following clinical assessment or prescription. Check overlapping ingredients, concentration and the amount given. Do not double up ingredients or missed doses. Logging is not medical advice or a dosing reminder.",
              )}
            </T>
            {[
              {
                label: "Vitamin D · Royal Children's Hospital",
                url: "https://www.rch.org.au/kidsinfo/fact_sheets/Vitamin_D/",
              },
              {
                label: "Probiotics · NIH NCCIH",
                url: "https://www.nccih.nih.gov/health/probiotics-usefulness-and-safety",
              },
            ].map((source) => (
              <Pressable
                key={source.url}
                accessibilityRole="link"
                accessibilityLabel={source.label}
                onPress={() => void openSource(source.url)}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <T raw style={{ color: c.primary, fontSize: 15 }}>
                  {source.label} ↗
                </T>
              </Pressable>
            ))}
          </>
        ) : null}
        <T raw style={{ fontSize: 15, color: c.muted, lineHeight: 22 }}>
          {text(
            "记录实际做过的照护，不是每日任务。测温、洗澡等记录会保留历史，填写后点保存才生效。",
            "Record care you actually provided, not daily tasks. Temperature and care history are kept; drafts are only stored when you tap Save.",
          )}
        </T>
        {kind !== "bath" ? (
          <T raw style={{ fontSize: 15, color: c.muted, lineHeight: 22 }}>
            {copy(option.hint)}
          </T>
        ) : null}
        {kind === "temperature" ? (
          <>
            <T raw style={{ fontSize: 15, lineHeight: 22 }}>
              {text(
                "本应用不能测温。请使用适龄体温计并遵循说明；不同测量方式的读数不能直接比较。",
                "This app cannot measure temperature. Use an age-suitable thermometer as directed; readings from different methods are not directly comparable.",
              )}
            </T>
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                void openSource(
                  "https://www.healthdirect.gov.au/fever-and-high-temperature-in-children",
                )
              }
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <T raw style={{ color: c.primary, fontSize: 15 }}>
                {text(
                  "发热安全提示 · healthdirect ↗",
                  "Fever safety · healthdirect ↗",
                )}
              </T>
            </Pressable>
          </>
        ) : null}
        <Pressable
          accessibilityRole="link"
          onPress={() => void openSource(option.url)}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <T raw style={{ color: c.primary, fontSize: 12 }}>
            {text("查看照护参考来源 ↗", "Care reference ↗")}
          </T>
        </Pressable>
        <T raw style={{ fontSize: 12, color: c.muted }}>
          {sharedMode
            ? text(
                "已同步的家庭照护记录可在「我的 → 备份与恢复」下载。每天可记多次，记录不替代医疗评估。",
                "Download confirmed family care records in More → Backup and restore. Multiple sessions per day are supported; records do not replace medical assessment.",
              )
            : text(
                "照护历史保存在本机并包含在记录备份中；每天可记多次，不替代医疗评估。",
                "Care history stays locally and is included in record backups. Multiple sessions per day are supported; this is not a medical assessment.",
              )}
        </T>
      </HelpDisclosure>
      {Platform.OS === "ios" && picker ? (
        <Modal
          transparent
          animationType="fade"
          onRequestClose={() => setPicker(null)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.45)",
              justifyContent: "flex-end",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={text("取消选择时间", "Cancel time selection")}
              onPress={() => setPicker(null)}
              style={{ flex: 1 }}
            />
            <SafeAreaView
              edges={["bottom", "left", "right"]}
              accessibilityViewIsModal
              onAccessibilityEscape={() => setPicker(null)}
              style={{
                backgroundColor: c.elevated,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingHorizontal: 14,
                paddingTop: 10,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPicker(null)}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    justifyContent: "center",
                    padding: 8,
                  }}
                >
                  <T raw style={{ color: c.primary }}>
                    {text("取消", "Cancel")}
                  </T>
                </Pressable>
                <T
                  raw
                  accessibilityRole="header"
                  style={{
                    flexShrink: 1,
                    textAlign: "center",
                    fontWeight: "700",
                  }}
                >
                  {picker.mode === "date"
                    ? text("照护日期", "Care date")
                    : text("照护时间", "Care time")}
                </T>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => acceptPicker(picker.value)}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    justifyContent: "center",
                    padding: 8,
                  }}
                >
                  <T raw style={{ color: c.primary, fontWeight: "700" }}>
                    {text("完成", "Done")}
                  </T>
                </Pressable>
              </View>
              {nativePicker}
            </SafeAreaView>
          </View>
        </Modal>
      ) : Platform.OS === "android" ? (
        nativePicker
      ) : null}
    </View>
  );
}
