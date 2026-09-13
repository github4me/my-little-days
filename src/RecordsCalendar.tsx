import React, { useContext, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Entry, summarize } from "./domain";
import { Button, Card, Chips, T, Theme, light, row } from "./ui";
import { elapsed, formatDate, formatTime, t } from "./i18n";
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
function entryLabel(entry: Entry) {
  if (entry.type === "feed")
    return entry.amount !== undefined
      ? `${t("喂奶")} ${entry.amount} mL`
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
}: {
  entries: Entry[];
  now: number;
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
}) {
  const c = useContext(Theme);
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [mode, setMode] = useState("day");
  const [kind, setKind] = useState<CalendarKind>("all");
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
  const fills =
    c === light
      ? { feed: "#FBE0D3", diaper: "#FFF0C9", sleep: "#C9E6FA" }
      : { feed: "#59434B", diaper: "#534B35", sleep: "#2C4C66" };
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
  return (
    <View style={{ gap: 16 }}>
      <View style={row}>
        <Chips
          value={mode}
          options={[
            { label: "日", value: "day" },
            { label: "周", value: "week" },
          ]}
          onChange={(value) => {
            setMode(value);
            setExpandedList(false);
          }}
        />
        <Button
          secondary
          label="回到今天"
          onPress={() => {
            setChosenDay(null);
            setExpandedList(false);
          }}
        />
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
          onPress={openDatePicker}
          style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
        >
          <T style={{ textAlign: "center", fontSize: 15, fontWeight: "700" }}>
            {mode === "day"
              ? formatDate(date, {
                  month: "short",
                  day: "numeric",
                  weekday: "short",
                })
              : `${formatDate(days[0], { month: "short", day: "numeric" })} – ${formatDate(days[6], { month: "short", day: "numeric" })}`}
          </T>
          <T style={{ textAlign: "center", fontSize: 11, color: c.muted }}>
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
              value={dateDraft}
              onChangeText={setDateDraft}
              placeholder="YYYY-MM-DD"
              style={{
                padding: 12,
                minHeight: 48,
                color: c.text,
                backgroundColor: c.card,
                borderWidth: 1,
                borderColor: c.line,
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
            maximumDate={new Date(now)}
            onChange={(event, next) => {
              setDatePicker(false);
              if (event.type === "set" && next) chooseDate(next);
            }}
          />
        ))}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Chips
          value={kind}
          options={[
            { label: "全部", value: "all" },
            ...Object.entries(kindLabels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
          onChange={(value) => {
            setKind(value as CalendarKind);
            setExpandedList(false);
          }}
        />
      </ScrollView>
      <T style={{ fontSize: 13, color: c.muted }}>
        {t("{amount} mL · {nappies} 次尿布 · 睡眠 {duration}", {
          amount: totals.feedMl,
          nappies: totals.diaperCount,
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
                          fontSize: 10,
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
                            (item.lane * columnWidths[index]) / item.laneCount +
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
                          style={{ fontSize: 10, lineHeight: 15 }}
                        >{`${item.continuesBefore ? "↳ " : ""}${formatTime(item.entry.start)}${item.running ? ` · ${t("进行中")}` : !item.point ? ` · ${elapsed((item.endMinute - item.startMinute) * 60000)}` : ""}${item.continuesAfter ? " ↴" : ""}`}</T>
                      </Pressable>
                    ))}
                    {calendarDayKey(days[index]) === calendarDayKey(today) && (
                      <View
                        pointerEvents="none"
                        style={{
                          position: "absolute",
                          top: (now - today.getTime()) / 60000,
                          left: 0,
                          right: 0,
                          height: 2,
                          backgroundColor: "#D56868",
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
      <T style={{ fontSize: 12, color: c.muted }}>
        {totalWidth > width
          ? "左右滑动查看更多，点击色块查看记录。"
          : "上下滑动查看全天，点击色块查看记录。"}
      </T>
      {clockChange && (
        <T style={{ fontSize: 12, color: c.muted }}>
          {mode === "week"
            ? "本周有夏令时切换，纵轴按当地午夜后的实际小时数排列。"
            : "当天有夏令时切换，时间轴保留跳过或重复的小时。"}
        </T>
      )}
      <Card style={{ padding: 14, gap: 6 }}>
        <T style={{ fontSize: 16, fontWeight: "700" }}>
          {t("日历明细（{count}）", { count: visibleEntries.length })}
        </T>
        {(expandedList ? visibleEntries : visibleEntries.slice(0, 5)).map(
          (entry) => (
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
              <T style={{ fontSize: 13, fontWeight: "600" }}>
                {entryLabel(entry)}
              </T>
              <T
                style={{ fontSize: 12, color: c.muted }}
              >{`${formatDate(entry.start, { month: "short", day: "numeric" })} · ${formatTime(entry.start)}`}</T>
            </Pressable>
          ),
        )}
        {visibleEntries.length > 5 && (
          <Button
            secondary
            label={expandedList ? "收起日历明细" : "展开全部日历明细"}
            onPress={() => setExpandedList((value) => !value)}
          />
        )}
      </Card>
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
              backgroundColor: c.card,
              borderRadius: 22,
              padding: 20,
              maxHeight: "90%",
              gap: 16,
            }}
          >
            <View style={row}>
              <T style={{ flex: 1, fontSize: 21, fontWeight: "700" }}>
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
                <Button
                  label="编辑记录"
                  onPress={() => act(() => onEdit(selectedEntry))}
                />
                <Button
                  label="删除记录"
                  secondary
                  onPress={() => act(() => onDelete(selectedEntry))}
                />
              </>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
