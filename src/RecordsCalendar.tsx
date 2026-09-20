import React, { useContext, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Modal from "./AccessibleModal";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import Svg, { Rect } from "react-native-svg";
import CareIcon from "./CareIcon";
import RecordActionButton from "./RecordActionButton";
import { Entry, summarize } from "./domain";
import { Button, Card, T, Theme, row } from "./ui";
import {
  elapsed,
  formatDate,
  formatNumber,
  formatTime,
  t,
  useI18n,
} from "./i18n";
import {
  calendarDayKey,
  calendarItems,
  calendarWeek,
  parseCalendarDay,
  shiftCalendarDay,
  type CalendarKind,
  type CalendarItem,
} from "./recordCalendar";

const kindLabels = { feed: "喂奶", diaper: "尿布", sleep: "睡眠" };
const filterKinds: CalendarKind[] = ["all", "feed", "diaper", "sleep"];
const filterLabel = (kind: CalendarKind) =>
  t(kind === "all" ? "全部" : kindLabels[kind]);
function FilterIcon({ kind, color }: { kind: CalendarKind; color: string }) {
  return kind === "all" ? (
    <Svg width={22} height={22} viewBox="0 0 24 24" accessible={false}>
      {[3, 14].flatMap((x) =>
        [3, 14].map((y) => (
          <Rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width={7}
            height={7}
            rx={1.5}
            fill="none"
            stroke={color}
            strokeWidth={1.8}
          />
        )),
      )}
    </Svg>
  ) : (
    <CareIcon kind={kind} size={22} color={color} />
  );
}
function entryLabel(entry: Entry) {
  if (entry.type === "feed")
    return entry.amount !== undefined
      ? `${t("喂奶")} ${formatNumber(entry.amount)} mL`
      : t("亲喂");
  if (entry.type === "diaper")
    return t(
      entry.diaperKind === "wet"
        ? "有尿"
        : entry.diaperKind === "dirty"
          ? "有便"
          : "尿 + 便",
    );
  return t("睡眠");
}

export default function RecordsCalendar({
  entries,
  now,
  onEdit,
  onDelete,
  authorLabel,
  canEdit,
}: {
  entries: Entry[];
  now: number;
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  authorLabel?: (id: string) => string;
  canEdit?: (id: string) => boolean;
}) {
  const c = useContext(Theme);
  const { fontScale } = useWindowDimensions();
  const { localize } = useI18n();
  // A dense, time-proportional chart cannot grow every event label safely.
  // At larger reading sizes, expose the same filtered records as full rows.
  const largeText = fontScale >= 1.3;
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [mode, setMode] = useState("day");
  const [kind, setKind] = useState<CalendarKind>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  const [periodWidth, setPeriodWidth] = useState(0);
  const compactFilters = largeText || toolbarWidth - periodWidth < 184;
  const [datePicker, setDatePicker] = useState(false);
  const [dateDraft, setDateDraft] = useState("");
  const [dateError, setDateError] = useState(false);
  const [width, setWidth] = useState(280);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedList, setExpandedList] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const verticalScroll = useRef<ScrollView>(null);
  const today = shiftCalendarDay(new Date(now), 0);
  const date = chosenDay ? parseCalendarDay(chosenDay)! : today;
  const dateKey = calendarDayKey(date);
  const days = mode === "week" ? calendarWeek(date) : [date];
  const layouts = days.map((day) => calendarItems(entries, day, now, kind));
  const selectedEntry = entries.find((entry) => entry.id === selectedId);
  const axisWidth = 46;
  const columnWidths = layouts.map((layout) =>
    Math.max(
      mode === "week" ? 98 : width - axisWidth,
      ...layout.items.map((item) => item.laneCount * 78),
    ),
  );
  const totalWidth =
    axisWidth + columnWidths.reduce((sum, value) => sum + value, 0);
  const gridMinutes = Math.max(...layouts.map((layout) => layout.dayMinutes));
  const clockChange = layouts.some((layout) => layout.dayMinutes !== 1440);
  const chartKey = `${dateKey}-${mode}-${kind}`;
  const startMinutes = layouts.flatMap((layout) =>
    layout.items.map((item) => item.startMinute),
  );
  const initialMinute = Math.max(
    0,
    (startMinutes.length
      ? Math.min(...startMinutes)
      : dateKey === calendarDayKey(today)
        ? new Date(now).getHours() * 60
        : 8 * 60) - 45,
  );
  const visibleEntries = [
    ...new Map(
      layouts
        .flatMap((layout) => layout.items)
        .map((item) => [item.entry.id, item.entry]),
    ).values(),
  ].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const normalized = entries.map((entry) =>
    entry.type === "sleep" && !entry.end
      ? { ...entry, end: new Date(now).toISOString() }
      : entry,
  );
  const totals = summarize(
    normalized,
    days[0],
    shiftCalendarDay(days[days.length - 1], 1),
  );
  const fills = { feed: c.feed, diaper: c.diaper, sleep: c.sleep };
  function chooseDate(next: Date) {
    setChosenDay(calendarDayKey(next > today ? today : next));
    setExpandedList(false);
    setDateError(false);
  }
  function act(action: () => void) {
    if (Platform.OS === "ios") pendingAction.current = action;
    setSelectedId(null);
    if (Platform.OS !== "ios") action();
  }
  function openDatePicker() {
    setDateDraft(dateKey);
    setDateError(false);
    setDatePicker((value) => !value);
  }
  function eventName(item: CalendarItem) {
    return `${entryLabel(item.entry)} · ${formatTime(item.entry.start)}${item.running ? ` · ${t("进行中")}` : ""}`;
  }
  function chooseFilter(value: CalendarKind) {
    setKind(value);
    setExpandedList(false);
    setFiltersOpen(false);
  }
  function filterOption(value: CalendarKind, showLabel = false) {
    return (
      <Pressable
        key={value}
        accessibilityRole="button"
        accessibilityLabel={t("筛选：{kind}", { kind: filterLabel(value) })}
        accessibilityState={{ selected: kind === value }}
        aria-selected={kind === value}
        onPress={() => chooseFilter(value)}
        style={({ pressed }) => ({
          minWidth: 44,
          minHeight: 44,
          width: showLabel ? undefined : 44,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: showLabel ? "flex-start" : "center",
          paddingHorizontal: showLabel ? 12 : 0,
          paddingVertical: showLabel ? 10 : 0,
          gap: 12,
          borderRadius: 10,
          borderWidth: kind === value ? 2 : 1,
          borderColor: kind === value ? c.primary : "transparent",
          backgroundColor: kind === value ? c.soft : "transparent",
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <FilterIcon kind={value} color={kind === value ? c.primary : c.muted} />
        {showLabel && <T style={{ flexShrink: 1 }}>{filterLabel(value)}</T>}
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      <View
        onLayout={(event) => setToolbarWidth(event.nativeEvent.layout.width)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <View
          onLayout={(event) => setPeriodWidth(event.nativeEvent.layout.width)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexShrink: 1,
            flexWrap: "wrap",
          }}
        >
          {(["day", "week", "today"] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={t(
                option === "day" ? "日" : option === "week" ? "周" : "回到今天",
              )}
              accessibilityState={{
                selected: option !== "today" && mode === option,
              }}
              aria-selected={option !== "today" && mode === option}
              onPress={() => {
                if (option === "today") setChosenDay(null);
                else setMode(option);
                setExpandedList(false);
              }}
              style={({ pressed }) => ({
                minWidth: 44,
                minHeight: 44,
                paddingHorizontal: 8,
                paddingVertical: 8,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                backgroundColor: mode === option ? c.soft : "transparent",
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <T
                style={{
                  fontSize: 13,
                  fontWeight: mode === option ? "700" : "400",
                  color: mode === option ? c.primary : c.muted,
                }}
              >
                {option === "day" ? "日" : option === "week" ? "周" : "今天"}
              </T>
            </Pressable>
          ))}
        </View>
        {compactFilters ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("筛选记录：{kind}", {
              kind: filterLabel(kind),
            })}
            accessibilityState={{ expanded: filtersOpen }}
            aria-expanded={filtersOpen}
            onPress={() => setFiltersOpen(true)}
            style={{
              width: 56,
              minHeight: 44,
              flexDirection: "row",
              gap: 4,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 10,
              backgroundColor: c.soft,
              flexShrink: 0,
            }}
          >
            <FilterIcon kind={kind} color={c.primary} />
            <T raw style={{ fontSize: 12, color: c.primary }}>
              ▾
            </T>
          </Pressable>
        ) : (
          <View style={{ flexDirection: "row", flexShrink: 0 }}>
            {filterKinds.map((value) => filterOption(value))}
          </View>
        )}
      </View>
      <View style={[row, { gap: 6 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(mode === "week" ? "上一周" : "前一天")}
          onPress={() =>
            chooseDate(shiftCalendarDay(date, mode === "week" ? -7 : -1))
          }
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <T style={{ fontSize: 28 }}>‹</T>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("选择日历日期")}
          accessibilityState={{ expanded: datePicker }}
          onPress={openDatePicker}
          style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
        >
          <T style={{ textAlign: "center", fontSize: 17, fontWeight: "700" }}>
            {mode === "day"
              ? formatDate(date, {
                  month: "short",
                  day: "numeric",
                  weekday: "short",
                })
              : `${formatDate(days[0], { month: "short", day: "numeric" })} – ${formatDate(days[6], { month: "short", day: "numeric" })}`}
          </T>
          <T style={{ textAlign: "center", fontSize: 13, color: c.muted }}>
            {date.getFullYear()} ▾
          </T>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(mode === "week" ? "下一周" : "后一天")}
          accessibilityState={{
            disabled: mode === "week" ? days[6] >= today : date >= today,
          }}
          disabled={mode === "week" ? days[6] >= today : date >= today}
          onPress={() =>
            chooseDate(shiftCalendarDay(date, mode === "week" ? 7 : 1))
          }
          style={{
            width: 44,
            height: 44,
            opacity: (mode === "week" ? days[6] >= today : date >= today)
              ? 0.35
              : 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <T style={{ fontSize: 28 }}>›</T>
        </Pressable>
      </View>
      {datePicker &&
        (Platform.OS === "web" ? (
          <View style={{ gap: 8 }}>
            <TextInput
              accessibilityLabel={t("日历日期")}
              allowFontScaling
              maxFontSizeMultiplier={0}
              value={dateDraft}
              onChangeText={setDateDraft}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={c.muted}
              selectionColor={c.primary}
              style={{
                padding: 12,
                minHeight: 48,
                color: c.text,
                fontSize: 17,
                backgroundColor: c.input,
                borderWidth: 1,
                borderColor: c.controlLine,
                borderRadius: 12,
              }}
            />
            <Button
              label="前往日期"
              secondary
              onPress={() => {
                const next = parseCalendarDay(dateDraft);
                if (!next || next > today) {
                  setDateError(true);
                  return;
                }
                chooseDate(next);
                setDatePicker(false);
              }}
            />
            {dateError && (
              <T accessibilityRole="alert">请选择今天或以前的有效日期。</T>
            )}
          </View>
        ) : (
          <DateTimePicker
            value={date}
            mode="date"
            themeVariant={c.isDark ? "dark" : "light"}
            maximumDate={new Date(now)}
            onChange={(event, next) => {
              setDatePicker(false);
              if (event.type === "set" && next) chooseDate(next);
            }}
          />
        ))}
      <T style={{ fontSize: 13, color: c.muted }}>
        {t("{amount} mL · {nappies} 次尿布 · 睡眠 {duration}", {
          amount: formatNumber(totals.feedMl),
          nappies: formatNumber(totals.diaperCount),
          duration: elapsed(totals.sleepMinutes * 60000),
        })}
      </T>
      <View style={{ flexDirection: "row", gap: 14, flexWrap: "wrap" }}>
        {(Object.keys(kindLabels) as (keyof typeof kindLabels)[]).map((key) => (
          <View
            key={key}
            style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
          >
            <View
              style={{
                height: 12,
                width: 12,
                borderRadius: 3,
                backgroundColor: fills[key],
                borderWidth: 1,
                borderColor: c.line,
              }}
            />
            <T style={{ fontSize: 12, color: c.muted }}>{kindLabels[key]}</T>
          </View>
        ))}
      </View>
      {!visibleEntries.length && (
        <T accessibilityLiveRegion="polite" style={{ color: c.muted }}>
          这段时间还没有记录。
        </T>
      )}
      {!largeText && (
        <View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={{
            borderWidth: 1,
            borderColor: c.line,
            backgroundColor: c.card,
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={totalWidth > width}
          >
            <View style={{ width: totalWidth }}>
              <View
                style={{
                  flexDirection: "row",
                  paddingLeft: axisWidth,
                  borderBottomWidth: 1,
                  borderColor: c.line,
                }}
              >
                {days.map((day, index) => (
                  <View
                    key={calendarDayKey(day)}
                    style={{
                      width: columnWidths[index],
                      paddingVertical: 10,
                      alignItems: "center",
                      backgroundColor:
                        calendarDayKey(day) === calendarDayKey(today)
                          ? c.soft
                          : c.card,
                    }}
                  >
                    <T style={{ fontSize: 12, fontWeight: "700" }}>
                      {formatDate(day, { weekday: "short", day: "numeric" })}
                    </T>
                  </View>
                ))}
              </View>
              <ScrollView
                key={chartKey}
                ref={verticalScroll}
                nestedScrollEnabled
                style={{ height: 420 }}
                onContentSizeChange={() =>
                  verticalScroll.current?.scrollTo({
                    y: initialMinute,
                    animated: false,
                  })
                }
              >
                <View
                  accessibilityLabel={t("日历时间轴")}
                  style={{ height: gridMinutes + 24, flexDirection: "row" }}
                >
                  <View style={{ width: axisWidth }}>
                    {Array.from(
                      { length: Math.ceil(gridMinutes / 60) + 1 },
                      (_, hour) => (
                        <T
                          key={hour}
                          raw
                          style={{
                            position: "absolute",
                            top: hour * 60,
                            left: 3,
                            color: c.muted,
                            fontSize: 11,
                            lineHeight: 16,
                          }}
                        >
                          {mode === "week" && clockChange
                            ? `${hour}h`
                            : hour * 60 === layouts[0].dayMinutes
                              ? "24:00"
                              : formatTime(
                                  new Date(days[0].getTime() + hour * 3600000),
                                )}
                        </T>
                      ),
                    )}
                  </View>
                  {layouts.map((layout, index) => (
                    <View
                      key={calendarDayKey(days[index])}
                      style={{
                        width: columnWidths[index],
                        height: layout.dayMinutes,
                        borderLeftWidth: 1,
                        borderColor: c.line,
                      }}
                    >
                      {Array.from(
                        { length: Math.ceil(layout.dayMinutes / 60) + 1 },
                        (_, hour) => (
                          <View
                            key={hour}
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              top: hour * 60,
                              height: 1,
                              backgroundColor: c.line,
                            }}
                          />
                        ),
                      )}
                      {layout.items.map((item) => (
                        <Pressable
                          key={item.entry.id}
                          accessibilityRole="button"
                          accessibilityLabel={t("查看记录：{detail}", {
                            detail: eventName(item),
                          })}
                          onPress={() => setSelectedId(item.entry.id)}
                          style={{
                            position: "absolute",
                            top: item.visualStart,
                            height: item.visualEnd - item.visualStart,
                            left:
                              (item.lane * columnWidths[index]) /
                                item.laneCount +
                              3,
                            width: columnWidths[index] / item.laneCount - 7,
                            backgroundColor:
                              fills[item.entry.type as keyof typeof fills],
                            borderRadius: 7,
                            borderWidth: item.running ? 2 : 1,
                            borderColor: item.running ? c.primary : c.line,
                            paddingHorizontal: 5,
                            paddingVertical: 3,
                            overflow: "hidden",
                          }}
                        >
                          <T
                            numberOfLines={1}
                            style={{
                              fontSize: 11,
                              lineHeight: 16,
                              fontWeight: "700",
                            }}
                          >
                            {entryLabel(item.entry)}
                          </T>
                          <T
                            numberOfLines={1}
                            style={{ fontSize: 11, lineHeight: 15 }}
                          >{`${item.continuesBefore ? "↳ " : ""}${formatTime(item.entry.start)}${item.running ? ` · ${t("进行中")}` : !item.point ? ` · ${elapsed((item.endMinute - item.startMinute) * 60000)}` : ""}${item.continuesAfter ? " ↴" : ""}`}</T>
                        </Pressable>
                      ))}
                      {calendarDayKey(days[index]) ===
                        calendarDayKey(today) && (
                        <View
                          pointerEvents="none"
                          style={{
                            position: "absolute",
                            top: (now - today.getTime()) / 60000,
                            left: 0,
                            right: 0,
                            height: 2,
                            backgroundColor: c.danger,
                          }}
                        />
                      )}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      )}
      {!largeText && (
        <T style={{ fontSize: 12, color: c.muted }}>
          {totalWidth > width
            ? "左右滑动查看更多，点击色块查看记录。"
            : "上下滑动查看全天，点击色块查看记录。"}
        </T>
      )}
      {clockChange && !largeText && (
        <T style={{ fontSize: 12, color: c.muted }}>
          {mode === "week"
            ? "本周有夏令时切换，纵轴按当地午夜后的实际小时数排列。"
            : "当天有夏令时切换，时间轴保留跳过或重复的小时。"}
        </T>
      )}
      {largeText && (
        <T raw style={{ color: c.muted }}>
          {localize(
            "较大字体下，日历记录在下方完整列出。仍按所选日期和筛选条件显示。",
            "For larger text, calendar records are shown in a full list below. Your selected date and filters still apply.",
          )}
        </T>
      )}
      <Card style={{ padding: 14, gap: 6 }}>
        <T
          accessibilityRole="header"
          style={{ fontSize: 17, fontWeight: "700" }}
        >
          {t("日历明细（{count}）", { count: visibleEntries.length })}
        </T>
        {(largeText || expandedList
          ? visibleEntries
          : visibleEntries.slice(0, 5)
        ).map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityLabel={t("打开日历记录：{detail}", {
              detail: `${entryLabel(entry)} ${formatTime(entry.start)}`,
            })}
            onPress={() => setSelectedId(entry.id)}
            style={{
              minHeight: 48,
              paddingVertical: 7,
              borderTopWidth: 1,
              borderColor: c.line,
            }}
          >
            <T style={{ fontSize: 17, fontWeight: "600" }}>
              {entryLabel(entry)}
            </T>
            <T
              style={{ fontSize: 15, color: c.muted }}
            >{`${formatDate(entry.start, { month: "short", day: "numeric" })} · ${formatTime(entry.start)}`}</T>
          </Pressable>
        ))}
        {!largeText && visibleEntries.length > 5 && (
          <Button
            secondary
            label={expandedList ? "收起日历明细" : "展开全部日历明细"}
            onPress={() => setExpandedList((value) => !value)}
          />
        )}
      </Card>
      <Modal
        visible={filtersOpen}
        transparent
        animationType="none"
        onRequestClose={() => setFiltersOpen(false)}
      >
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <Card
            style={{ maxHeight: "90%", gap: 12, backgroundColor: c.elevated }}
          >
            <T
              accessibilityRole="header"
              style={{ fontSize: 20, fontWeight: "700" }}
            >
              记录筛选
            </T>
            <ScrollView>
              {filterKinds.map((value) => filterOption(value, true))}
            </ScrollView>
            <Button
              secondary
              label="关闭筛选"
              onPress={() => setFiltersOpen(false)}
            />
          </Card>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={!!selectedEntry}
        transparent
        animationType="none"
        onRequestClose={() => setSelectedId(null)}
        onDismiss={() => {
          const action = pendingAction.current;
          pendingAction.current = null;
          action?.();
        }}
      >
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: c.elevated,
              borderRadius: 22,
              padding: 20,
              maxHeight: "90%",
              gap: 16,
            }}
          >
            <View style={row}>
              <T
                accessibilityRole="header"
                style={{ flex: 1, fontSize: 22, fontWeight: "700" }}
              >
                记录详情
              </T>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("关闭记录详情")}
                onPress={() => setSelectedId(null)}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <T style={{ fontSize: 24 }}>×</T>
              </Pressable>
            </View>
            {selectedEntry && (
              <>
                <ScrollView>
                  <T
                    style={{
                      fontSize: 18,
                      fontWeight: "700",
                      marginBottom: 12,
                    }}
                  >
                    {entryLabel(selectedEntry)}
                  </T>
                  <T>
                    {formatDate(selectedEntry.start)} ·{" "}
                    {formatTime(selectedEntry.start)}
                  </T>
                  {authorLabel ? (
                    <T raw style={{ fontSize: 12, color: c.muted }}>
                      {authorLabel(selectedEntry.id)}
                    </T>
                  ) : null}
                  {selectedEntry.end ? (
                    <T>
                      {t("结束：{date} · {time}", {
                        date: formatDate(selectedEntry.end),
                        time: formatTime(selectedEntry.end),
                      })}
                    </T>
                  ) : selectedEntry.feedRunning ||
                    selectedEntry.type === "sleep" ? (
                    <T>进行中</T>
                  ) : null}
                  {selectedEntry.end && (
                    <T>
                      {elapsed(
                        Date.parse(selectedEntry.end) -
                          Date.parse(selectedEntry.start),
                      )}
                    </T>
                  )}
                  {!!selectedEntry.note && (
                    <T raw style={{ marginTop: 12 }}>
                      {selectedEntry.note}
                    </T>
                  )}
                </ScrollView>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <RecordActionButton
                    action="edit"
                    accessibilityLabel={t("编辑记录")}
                    accessibilityHint={t("打开记录编辑界面")}
                    disabled={canEdit && !canEdit(selectedEntry.id)}
                    onPress={() => act(() => onEdit(selectedEntry))}
                  />
                  <RecordActionButton
                    action="delete"
                    accessibilityLabel={t("删除记录")}
                    accessibilityHint={t("打开删除确认")}
                    disabled={canEdit && !canEdit(selectedEntry.id)}
                    onPress={() => act(() => onDelete(selectedEntry))}
                  />
                </View>
              </>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
