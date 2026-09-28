import React, { useContext, useState } from "react";
import {
  View,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import Svg, { Rect, Line, Text as Label } from "react-native-svg";
import { Entry, summarize } from "./domain";
import { Theme, T, Card, Chips, row } from "./ui";
import { elapsed, formatDate, formatNumber, formatTime, t } from "./i18n";
import RecordsCalendar from "./RecordsCalendar";
import RecordActionButton from "./RecordActionButton";
import type { RecordView } from "./recordCalendar";
import { layoutSleepChart, SLEEP_CHART_INSET } from "./sleepChartLayout";
import {
  chartAxisLayout,
  chartFontFamily,
  layoutBarValueLabels,
} from "./chartLayout";
import {
  recordRangeStart,
  recordChartBuckets,
  type RecordRange,
} from "./recordRange";

const ranges: { value: RecordRange; label: string; title: string }[] = [
  { value: "7d", label: "7 天", title: "近 7 天" },
  { value: "2w", label: "2 周", title: "近 2 周" },
  { value: "1m", label: "1 个月", title: "近 1 个月" },
  { value: "3m", label: "3 个月", title: "近 3 个月" },
  { value: "6m", label: "6 个月", title: "近 6 个月" },
  { value: "all", label: "全部", title: "全部记录" },
];
type Kind = "feed" | "diaper" | "sleep";
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const midnight = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());
const clock = (iso: string) => formatTime(iso);
type Bar = {
  x: number;
  value: number;
  color: string;
  label?: string;
  startLabel?: string;
};
function Bars({
  bars,
  labels,
  maxX = 24,
  unit,
  values = false,
}: {
  bars: Bar[];
  labels: { x: number; text: string }[];
  maxX?: number;
  unit: string;
  values?: boolean;
}) {
  const c = useContext(Theme),
    max = Math.max(1, ...bars.map((b) => b.value));
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(
    Math.max(220, screenWidth - 64),
  );
  const valueLabel = (bar: Bar) =>
    bar.label ??
    (unit === "小时"
      ? elapsed(Math.round(bar.value * 3600000))
      : formatNumber(bar.value, { maximumFractionDigits: 0 }));
  const yLabels = [0, 0.5, 1].map((fraction) =>
    formatNumber(max * fraction, {
      minimumFractionDigits: unit === "小时" ? 1 : 0,
      maximumFractionDigits: unit === "小时" ? 1 : 0,
    }),
  );
  const baseLayout = chartAxisLayout({
    width: availableWidth,
    fontScale,
    compact: true,
    leftLabelChars: values
      ? 0
      : Math.max(...yLabels.map((label) => label.length)),
    xLabelChars: Math.max(2, ...labels.map((label) => label.text.length)),
    xLabelCount: labels.length,
  });
  const annotations = layoutBarValueLabels(
    values && bars.length <= 12
      ? bars.map((bar) => ({
          x: baseLayout.left + (bar.x / maxX) * baseLayout.plotWidth,
          y:
            baseLayout.baseline - 7 - (bar.value / max) * baseLayout.plotHeight,
          text: valueLabel(bar),
        }))
      : [],
    baseLayout.width,
    baseLayout.fontSize,
  );
  const layout = {
    ...baseLayout,
    baseline: baseLayout.baseline + annotations.topInset,
    axisLabelY: baseLayout.axisLabelY + annotations.topInset,
    height: baseLayout.height + annotations.topInset,
  };
  const x = (v: number) => layout.left + (v / maxX) * layout.plotWidth;
  const width = Math.min(
    values ? 18 : 30,
    (layout.plotWidth / Math.max(1, bars.length)) * 0.6,
  );
  return (
    <View
      testID="record-bars"
      onLayout={(event) => {
        const measured = event.nativeEvent.layout.width;
        if (measured > 0 && Math.abs(measured - availableWidth) > 1)
          setAvailableWidth(measured);
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={layout.width > availableWidth + 1}
      >
        <Svg
          testID="record-bars-plot"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t("统计图，单位{unit}，数值见每日汇总和明细", {
            unit: t(unit),
          })}
        >
          {[0, 0.5, 1].map((f) => (
            <React.Fragment key={f}>
              <Line
                x1={layout.left}
                x2={layout.width - layout.right}
                y1={layout.baseline - f * layout.plotHeight}
                y2={layout.baseline - f * layout.plotHeight}
                stroke={c.line}
              />
              {!values ? (
                <Label
                  x={layout.left - 8}
                  y={
                    layout.baseline -
                    f * layout.plotHeight +
                    layout.fontSize * 0.35
                  }
                  fill={c.muted}
                  fontSize={layout.fontSize}
                  fontFamily={chartFontFamily(Platform.OS)}
                  textAnchor="end"
                >
                  {yLabels[Math.round(f * 2)]}
                </Label>
              ) : null}
            </React.Fragment>
          ))}
          {bars.map((b, i) => (
            <React.Fragment key={i}>
              <Rect
                x={x(b.x) - width / 2}
                testID="record-bar"
                y={layout.baseline - (b.value / max) * layout.plotHeight}
                width={width}
                height={Math.max(0, (b.value / max) * layout.plotHeight)}
                fill={b.color}
                stroke={c.controlLine}
                strokeWidth={c.isHighContrast ? 2 : 1}
                rx={3}
              />
            </React.Fragment>
          ))}
          {annotations.labels.map((label) => (
            <Line
              key={label.index}
              x1={x(bars[label.index].x)}
              y1={
                layout.baseline -
                (bars[label.index].value / max) * layout.plotHeight -
                2
              }
              x2={label.x}
              y2={label.y + 3}
              stroke={c.controlLine}
            />
          ))}
          {annotations.labels.map((label) => (
            <React.Fragment key={label.index}>
              <Rect
                x={label.x - label.width / 2}
                y={label.y - layout.fontSize}
                width={label.width}
                height={layout.fontSize * 1.4}
                fill={c.card}
                rx={2}
              />
              <Label
                testID="record-bar-value-label"
                x={label.x}
                y={label.y}
                fontSize={layout.fontSize}
                fontFamily={chartFontFamily(Platform.OS)}
                textAnchor="middle"
                fill={c.muted}
              >
                {label.text}
              </Label>
            </React.Fragment>
          ))}
          {labels.map((l, i) => (
            <Label
              key={i}
              x={x(l.x)}
              y={layout.axisLabelY}
              fill={c.muted}
              fontSize={layout.fontSize}
              fontFamily={chartFontFamily(Platform.OS)}
              textAnchor="middle"
            >
              {l.text}
            </Label>
          ))}
        </Svg>
      </ScrollView>
    </View>
  );
}

// Daily sleep charts use a separate visual layout; totals and stored durations
// remain linear and unchanged. Leaders retain the real start-time anchors when
// close records need extra space, and break marks disclose shortened long bars.
function SleepBars({ bars }: { bars: Bar[] }) {
  const c = useContext(Theme);
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(220, screenWidth - 64));
  const fontSize = 12 * fontScale;
  const layout = layoutSleepChart(
    bars.map((bar) => ({
      x: bar.x,
      value: bar.value,
      label: elapsed(Math.round(bar.value * 3600000)),
    })),
    { width, fontSize },
  );
  const barColors = [c.chartSleep, c.chartSleepAlternate];
  const explanation = [
    layout.compressed
      ? t("长睡眠柱已缩短至其他睡眠的平均高度；断线标记和标签显示实际时长。")
      : "",
    layout.clustered
      ? t("相邻睡眠柱已错开；底部标记表示本日片段的开始时间。")
      : "",
  ].filter(Boolean);
  return (
    <View
      testID="daily-sleep-chart"
      onLayout={(event) => {
        const measured = event.nativeEvent.layout.width;
        if (measured > 0 && Math.abs(measured - width) > 1) setWidth(measured);
      }}
      style={{ gap: 4 }}
    >
      {layout.compressed ? (
        <T
          testID="sleep-chart-compression-legend"
          style={{ fontSize: 12, color: c.muted }}
        >
          断线＝高度压缩；以标签时长为准。
        </T>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={layout.width > width + 1}
      >
        <Svg
          testID="sleep-chart-plot"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          accessible
          accessibilityRole="image"
          accessibilityLabel={[
            t("统计图，单位{unit}，数值见每日汇总和明细", { unit: t("小时") }),
            ...layout.bars.map(
              (bar) => `${bars[bar.index].startLabel ?? ""}: ${bar.label}`,
            ),
            ...explanation,
          ].join("; ")}
        >
          {[0, 0.5, 1].map((fraction) => (
            <Line
              key={fraction}
              x1={SLEEP_CHART_INSET}
              x2={layout.width - SLEEP_CHART_INSET}
              y1={
                layout.baseline - fraction * (layout.baseline - layout.plotTop)
              }
              y2={
                layout.baseline - fraction * (layout.baseline - layout.plotTop)
              }
              stroke={c.line}
            />
          ))}
          {layout.bars.map((bar) => (
            <React.Fragment key={bar.index}>
              <Line
                testID="sleep-chart-leader"
                x1={bar.x}
                y1={layout.baseline - bar.height - 2}
                x2={bar.labelX}
                y2={bar.labelY + 4}
                stroke={c.controlLine}
                strokeWidth={1}
              />
              {Math.abs(bar.x - bar.anchorX) > 0.5 ? (
                <Line
                  x1={bar.x}
                  y1={layout.baseline}
                  x2={bar.anchorX}
                  y2={layout.baseline + 6}
                  stroke={c.controlLine}
                />
              ) : null}
              <Line
                testID="sleep-chart-anchor"
                x1={bar.anchorX}
                x2={bar.anchorX}
                y1={layout.baseline + 3}
                y2={layout.baseline + 8}
                stroke={c.controlLine}
              />
              <Rect
                testID={
                  bar.compressed
                    ? "sleep-chart-compressed-bar"
                    : "sleep-chart-bar"
                }
                x={bar.x - bar.width / 2}
                y={layout.baseline - bar.height}
                width={bar.width}
                height={bar.height}
                rx={3}
                fill={
                  bar.compressed
                    ? c.soft
                    : barColors[bar.variant % barColors.length]
                }
                stroke={bar.compressed ? c.primary : c.chartSleepLine}
                strokeWidth={bar.compressed ? 2 : 1}
              />
              {bar.compressed ? (
                <>
                  <Line
                    x1={bar.x - bar.width / 2 - 1}
                    x2={bar.x + bar.width / 2 + 1}
                    y1={layout.baseline - bar.height / 2 + 3}
                    y2={layout.baseline - bar.height / 2 - 3}
                    stroke={c.card}
                    strokeWidth={5}
                  />
                  <Line
                    x1={bar.x - bar.width / 2 - 1}
                    x2={bar.x + bar.width / 2 + 1}
                    y1={layout.baseline - bar.height / 2 + 3}
                    y2={layout.baseline - bar.height / 2 - 3}
                    stroke={c.primary}
                    strokeWidth={1.5}
                  />
                </>
              ) : null}
            </React.Fragment>
          ))}
          {layout.bars.map((bar) => (
            <React.Fragment key={bar.index}>
              <Rect
                x={bar.labelX - bar.labelWidth / 2}
                y={bar.labelY - fontSize}
                width={bar.labelWidth}
                height={fontSize + Math.max(4, fontSize * 0.3)}
                rx={2}
                fill={c.card}
              />
              <Label
                testID="sleep-chart-label"
                x={bar.labelX}
                y={bar.labelY}
                fill={c.muted}
                fontSize={fontSize}
                fontFamily={chartFontFamily(Platform.OS)}
                textAnchor="middle"
              >
                {bar.label}
              </Label>
            </React.Fragment>
          ))}
          {[0, 6, 12, 18, 24].map((hour) => (
            <Label
              key={hour}
              x={
                SLEEP_CHART_INSET +
                (hour / 24) * (layout.width - SLEEP_CHART_INSET * 2)
              }
              y={layout.baseline + fontSize + 14}
              fill={c.muted}
              fontSize={fontSize}
              fontFamily={chartFontFamily(Platform.OS)}
              textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}
            >
              {String(hour).padStart(2, "0")}
            </Label>
          ))}
        </Svg>
      </ScrollView>
      {layout.compressed ? (
        <T
          testID="sleep-chart-compression-note"
          style={{ fontSize: 12, color: c.muted }}
        >
          长睡眠柱已缩短至其他睡眠的平均高度；断线标记和标签显示实际时长。
        </T>
      ) : null}
      {layout.clustered ? (
        <T
          testID="sleep-chart-crowding-note"
          style={{ fontSize: 12, color: c.muted }}
        >
          相邻睡眠柱已错开；底部标记表示本日片段的开始时间。
        </T>
      ) : null}
    </View>
  );
}
type RecordsProps = {
  authorLabel?: (id: string) => string;
  canEdit?: (id: string) => boolean;
  entries: Entry[];
  now: number;
  onEdit: (e: Entry) => void;
  onDelete: (e: Entry) => void;
};
export function RecordsViewToggle({
  value,
  onChange,
}: {
  value: RecordView;
  onChange: (value: RecordView) => void;
}) {
  const c = useContext(Theme);
  return (
    <View
      style={{
        flexDirection: "row",
        flexShrink: 0,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.line,
        overflow: "hidden",
      }}
    >
      {(["calendar", "bars"] as const).map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityLabel={t(option === "calendar" ? "日历视图" : "柱状图")}
          accessibilityState={{ selected: value === option }}
          aria-selected={value === option}
          onPress={() => onChange(option)}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: value === option ? c.soft : c.card,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" aria-hidden>
            {option === "calendar" ? (
              <>
                <Rect
                  x={3}
                  y={5}
                  width={18}
                  height={16}
                  rx={3}
                  fill="none"
                  stroke={value === option ? c.primary : c.muted}
                  strokeWidth={1.8}
                />
                <Line
                  x1={3}
                  y1={10}
                  x2={21}
                  y2={10}
                  stroke={value === option ? c.primary : c.muted}
                  strokeWidth={1.8}
                />
                <Line
                  x1={8}
                  y1={2}
                  x2={8}
                  y2={7}
                  stroke={value === option ? c.primary : c.muted}
                  strokeWidth={1.8}
                />
                <Line
                  x1={16}
                  y1={2}
                  x2={16}
                  y2={7}
                  stroke={value === option ? c.primary : c.muted}
                  strokeWidth={1.8}
                />
                {[7, 11, 15].map((x) => (
                  <Rect
                    key={x}
                    x={x}
                    y={14}
                    width={2}
                    height={2}
                    fill={value === option ? c.primary : c.muted}
                  />
                ))}
              </>
            ) : (
              <>
                {[8, 16, 12].map((height, index) => (
                  <Rect
                    key={index}
                    x={4 + index * 6}
                    y={21 - height}
                    width={4}
                    height={height}
                    rx={1}
                    fill={value === option ? c.primary : c.muted}
                  />
                ))}
              </>
            )}
          </Svg>
        </Pressable>
      ))}
    </View>
  );
}
export default function Records({
  view,
  ...props
}: RecordsProps & { view: RecordView }) {
  return (
    <View style={{ gap: 16 }}>
      <View
        style={{ display: view === "calendar" ? "flex" : "none" }}
        accessibilityElementsHidden={view !== "calendar"}
        importantForAccessibility={
          view !== "calendar" ? "no-hide-descendants" : "auto"
        }
      >
        <RecordsCalendar {...props} />
      </View>
      <View
        style={{ display: view === "bars" ? "flex" : "none", gap: 16 }}
        accessibilityElementsHidden={view !== "bars"}
        importantForAccessibility={
          view !== "bars" ? "no-hide-descendants" : "auto"
        }
      >
        <BarRecords {...props} />
      </View>
    </View>
  );
}
function BarRecords({
  entries,
  now,
  onEdit,
  onDelete,
  authorLabel,
  canEdit,
}: RecordsProps) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.3;
  const c = useContext(Theme),
    [kind, setKind] = useState<Kind>("feed"),
    [unit, setUnit] = useState("mL"),
    [range, setRange] = useState<RecordRange>("7d"),
    [olderDayPages, setOlderDayPages] = useState(0),
    [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set()),
    [expandedDayEntries, setExpandedDayEntries] = useState<Set<string>>(
      () => new Set(),
    );
  const selected = entries
    .filter((e) => e.type === kind)
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const value = (e: Entry) =>
    kind === "feed"
      ? unit === "mL"
        ? (e.amount ?? 0)
        : e.end
          ? (Date.parse(e.end) - Date.parse(e.start)) / 3600000
          : 0
      : kind === "sleep"
        ? (Date.parse(e.end ?? new Date(now).toISOString()) -
            Date.parse(e.start)) /
          3600000
        : 1;
  const color = (e: Entry) =>
    kind === "feed"
      ? e.feedKind?.startsWith("breast")
        ? c.chartCare
        : c.chartFeed
      : kind === "sleep"
        ? c.chartSleep
        : e.diaperKind === "wet"
          ? c.chartFeed
          : e.diaperKind === "dirty"
            ? c.chartSleep
            : c.chartCare;
  const groups = new Map<string, { date: Date; events: Entry[] }>();
  for (const e of selected) {
    const first = midnight(new Date(e.start)),
      last =
        kind === "sleep"
          ? midnight(
              new Date(
                Math.max(
                  Date.parse(e.start),
                  Date.parse(e.end ?? new Date(now).toISOString()) - 1,
                ),
              ),
            )
          : first;
    // Iterate days (not fixed 24h) so DST boundaries remain correct.
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d);
      if (!groups.has(key)) groups.set(key, { date: new Date(d), events: [] });
      groups.get(key)!.events.push(e);
    }
  }
  const days = [...groups.values()].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );
  const today = dayKey(new Date(now));
  const rangeStart = recordRangeStart(
    range,
    new Date(now),
    days[days.length - 1]?.date,
  );
  const rangeDays = days.filter(
    (day) => day.date >= rangeStart && day.date <= new Date(now),
  );
  const initialDayCount = rangeDays.some((day) => dayKey(day.date) === today)
    ? 4
    : 3;
  const visibleDayCount = initialDayCount + olderDayPages * 7;
  const visibleDays = rangeDays.slice(0, visibleDayCount);
  const nextDayCount = Math.min(7, rangeDays.length - visibleDays.length);
  const perDay = (date: Date, events: Entry[]) => {
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    const normalized = events.map((e) =>
      e.type === "sleep" && !e.end
        ? { ...e, end: new Date(now).toISOString() }
        : e,
    );
    const s = summarize(normalized, date, end);
    return {
      s,
      total:
        kind === "sleep"
          ? s.sleepMinutes / 60
          : kind === "diaper"
            ? s.diaperCount
            : unit === "mL"
              ? s.feedMl
              : events.reduce((a, e) => a + value(e), 0),
    };
  };
  const { buckets: chartDays, daysPerBar } = recordChartBuckets(
    rangeStart,
    new Date(now),
    (date) => perDay(date, groups.get(dayKey(date))?.events ?? []).total,
  );
  const chartLabelIndices = new Set(
    Array.from({ length: Math.min(7, chartDays.length) }, (_, index) =>
      Math.round(
        (index * (chartDays.length - 1)) /
          Math.max(1, Math.min(7, chartDays.length) - 1),
      ),
    ),
  );
  const displayUnit =
    kind === "feed"
      ? unit === "mL"
        ? "mL"
        : "小时"
      : kind === "sleep"
        ? "小时"
        : "次";
  return (
    <View style={{ gap: 20 }}>
      <Chips
        value={kind}
        iconized
        options={[
          { label: "喂奶", value: "feed", careIcon: "feed" },
          { label: "尿布", value: "diaper", careIcon: "diaper" },
          { label: "睡眠", value: "sleep", careIcon: "sleep" },
        ]}
        onChange={(v) => {
          setKind(v as Kind);
          setOlderDayPages(0);
          setExpandedDays(new Set());
          setExpandedDayEntries(new Set());
        }}
      />
      <Card>
        <View testID="record-range-options">
          <Chips
            value={range}
            options={ranges}
            onChange={(next) => {
              setRange(next as RecordRange);
              setOlderDayPages(0);
              setExpandedDays(new Set());
              setExpandedDayEntries(new Set());
            }}
          />
        </View>
        <View
          style={[
            row,
            largeText && { flexDirection: "column", alignItems: "stretch" },
          ]}
        >
          <T style={{ flex: 1, fontSize: 18, fontWeight: "700" }}>
            {ranges.find((option) => option.value === range)!.title}
          </T>
          {kind === "feed" ? (
            <Chips
              value={unit}
              iconized
              compact
              options={[
                { label: "mL", value: "mL", careIcon: "feed" },
                { label: "时长", value: "hours", icon: "◷" },
              ]}
              onChange={setUnit}
            />
          ) : (
            <T style={{ color: c.muted }}>{displayUnit}</T>
          )}
        </View>
        <Bars
          unit={displayUnit}
          maxX={chartDays.length}
          bars={chartDays.map((d, i) => ({
            x: i + 0.5,
            value: d.total,
            color: kind === "sleep" ? c.chartSleep : c.chartFeed,
          }))}
          labels={chartDays.flatMap((d, i) =>
            chartLabelIndices.has(i)
              ? [
                  {
                    x: i + 0.5,
                    text: `${d.date.getMonth() + 1}/${d.date.getDate()}`,
                  },
                ]
              : [],
          )}
        />
        <T style={{ fontSize: 12, color: c.muted }}>
          {`${dayKey(rangeStart)} – ${today}`}
        </T>
        {daysPerBar > 1 ? (
          <T style={{ fontSize: 12, color: c.muted }}>
            {t("每根柱为最多 {count} 天合计；下方可展开每日明细。", {
              count: daysPerBar,
            })}
          </T>
        ) : null}
        <T style={{ fontSize: 12, color: c.muted }}>
          {kind === "feed"
            ? "● 瓶喂　● 亲喂只计时长，不估算奶量"
            : kind === "sleep"
              ? "已记录睡眠，跨日拆分；重叠时段只计一次"
              : "一次混合尿布按一次更换统计"}
        </T>
      </Card>
      {!rangeDays.length ? (
        <Card>
          <T style={{ color: c.muted }}>
            {t("所选时段没有{kind}记录", {
              kind: t(
                kind === "feed" ? "喂奶" : kind === "sleep" ? "睡眠" : "尿布",
              ),
            })}
          </T>
        </Card>
      ) : null}
      {visibleDays.map(({ date, events }) => {
        const { s } = perDay(date, events);
        const key = dayKey(date);
        const detailsExpanded = key === today || expandedDays.has(key);
        const dayEntriesExpanded = expandedDayEntries.has(key);
        const recentEvents = events.slice(0, 5);
        const olderEventCount = events.length - recentEvents.length;
        const visibleEvents = dayEntriesExpanded ? events : recentEvents;
        const dayEnd = new Date(date);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const minutes = events.reduce(
          (n, e) =>
            n + (e.end ? (Date.parse(e.end) - Date.parse(e.start)) / 60000 : 0),
          0,
        );
        const dailyBars = events.map((e) => {
          const start = Math.max(date.getTime(), Date.parse(e.start));
          const d = new Date(start);
          return {
            x: d.getHours() + d.getMinutes() / 60,
            value:
              kind === "sleep"
                ? Math.max(
                    0,
                    Math.min(
                      dayEnd.getTime(),
                      Date.parse(e.end ?? new Date(now).toISOString()),
                    ) - start,
                  ) / 3600000
                : value(e),
            color: color(e),
            startLabel: Number.isFinite(start) ? formatTime(start) : undefined,
            label:
              kind === "feed" && unit === "mL"
                ? e.amount === undefined
                  ? t("亲喂")
                  : formatNumber(e.amount)
                : undefined,
          };
        });
        return (
          <View key={key} style={{ gap: 8 }}>
            <T
              raw
              accessibilityRole="header"
              style={{ fontSize: 17, fontWeight: "600" }}
            >
              {key === today ? (
                <T raw style={{ color: c.primary, fontWeight: "700" }}>
                  {t("今天")} ·{" "}
                </T>
              ) : null}
              {formatDate(date, {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}{" "}
              <T style={{ fontSize: 12, color: c.muted }}>
                {date.getFullYear()}
              </T>
            </T>
            <Card
              style={{
                padding: 16,
                gap: 8,
                borderWidth: key === today ? 2 : 1,
                borderColor: key === today ? c.primary : c.line,
              }}
            >
              <Pressable
                disabled={key === today}
                accessibilityRole="button"
                accessibilityLabel={t(
                  detailsExpanded ? "收起当日明细" : "展开当日明细",
                )}
                accessibilityState={{
                  expanded: detailsExpanded,
                  disabled: key === today,
                }}
                onPress={() =>
                  setExpandedDays((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                style={{
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <T style={{ fontSize: 16, color: c.muted, flex: 1 }}>
                  {kind === "feed"
                    ? t("{count} 次喂奶 · {amount} mL · {duration}", {
                        count: events.length,
                        amount: s.feedMl,
                        duration: elapsed(minutes * 60000),
                      })
                    : kind === "sleep"
                      ? t("{count} 段睡眠 · {duration}", {
                          count: events.length,
                          duration: elapsed(s.sleepMinutes * 60000),
                        })
                      : t("{count} 次更换 · 有尿 {wet} 次 · 有便 {dirty} 次", {
                          count: s.diaperCount,
                          wet: s.wetCount,
                          dirty: s.dirtyCount,
                        })}
                </T>
                {key !== today ? (
                  <T style={{ color: c.primary }}>
                    {detailsExpanded ? "▴" : "▾"}
                  </T>
                ) : null}
              </Pressable>
              {detailsExpanded ? (
                <>
                  {kind === "sleep" ? (
                    <SleepBars bars={dailyBars} />
                  ) : (
                    <Bars
                      values
                      unit={displayUnit}
                      bars={dailyBars}
                      labels={[0, 6, 12, 18, 24].map((x) => ({
                        x,
                        text: String(x).padStart(2, "0"),
                      }))}
                    />
                  )}
                  {visibleEvents.map((e) => {
                    const index = selected.findIndex((v) => v.id === e.id),
                      prev = selected[index + 1];
                    return (
                      <View
                        key={e.id}
                        style={{
                          borderTopWidth: 1,
                          borderColor: c.line,
                          paddingVertical: 7,
                          gap: 2,
                        }}
                      >
                        <View
                          style={[
                            row,
                            largeText && {
                              flexDirection: "column",
                              alignItems: "stretch",
                            },
                          ]}
                        >
                          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                            <View style={[row, { flexWrap: "wrap", gap: 8 }]}>
                              <T
                                style={{
                                  fontSize: 13,
                                  lineHeight: 19,
                                  fontWeight: "600",
                                }}
                              >
                                {clock(e.start)}
                                {kind === "sleep"
                                  ? `–${e.end ? clock(e.end) : t("正在睡")}`
                                  : ""}
                              </T>
                              <T style={{ fontSize: 13, lineHeight: 19 }}>
                                {kind === "feed"
                                  ? e.amount !== undefined
                                    ? `${formatNumber(e.amount)} mL`
                                    : t("亲喂")
                                  : kind === "diaper"
                                    ? t(
                                        {
                                          wet: "尿",
                                          dirty: "便",
                                          mixed: "尿＋便",
                                        }[e.diaperKind!],
                                      )
                                    : elapsed(
                                        Date.parse(
                                          e.end ?? new Date(now).toISOString(),
                                        ) - Date.parse(e.start),
                                      )}
                              </T>
                              {kind === "feed" ? (
                                <T
                                  style={{
                                    color: c.muted,
                                    fontSize: 11,
                                    lineHeight: 16,
                                  }}
                                >
                                  {e.end
                                    ? elapsed(
                                        Date.parse(e.end) - Date.parse(e.start),
                                      )
                                    : t("未记时长")}
                                </T>
                              ) : null}
                            </View>
                            {kind === "feed" ? (
                              <T
                                style={{
                                  fontSize: 11,
                                  lineHeight: 16,
                                  color: c.muted,
                                }}
                              >
                                {t("距上次 {duration}", {
                                  duration: prev
                                    ? elapsed(
                                        Date.parse(e.start) -
                                          Date.parse(prev.start),
                                      )
                                    : "—",
                                })}
                              </T>
                            ) : null}
                            {kind === "sleep" &&
                            dayKey(new Date(e.start)) !== dayKey(date) ? (
                              <T
                                style={{
                                  fontSize: 11,
                                  lineHeight: 16,
                                  color: c.muted,
                                }}
                              >
                                {t("开始于 {date}；本日时长见汇总", {
                                  date: dayKey(new Date(e.start)),
                                })}
                              </T>
                            ) : null}
                            {authorLabel ? (
                              <T raw style={{ fontSize: 11, color: c.muted }}>
                                {authorLabel(e.id)}
                              </T>
                            ) : null}
                            {e.note ? (
                              <T
                                raw
                                style={{
                                  fontSize: 15,
                                  lineHeight: 21,
                                  color: c.muted,
                                }}
                              >
                                {e.note}
                              </T>
                            ) : null}
                          </View>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <RecordActionButton
                              action="edit"
                              accessibilityLabel={`${t("编辑{kind}", {
                                kind: t(
                                  kind === "feed"
                                    ? "喂奶"
                                    : kind === "sleep"
                                      ? "睡眠"
                                      : "尿布",
                                ),
                              })} · ${formatDate(e.start)} ${formatTime(e.start)}${e.end ? `–${formatTime(e.end)}` : ""}`}
                              accessibilityHint={t("打开记录编辑界面")}
                              onPress={() => onEdit(e)}
                              disabled={canEdit && !canEdit(e.id)}
                            />
                            <RecordActionButton
                              action="delete"
                              accessibilityLabel={`${t("删除{kind}", {
                                kind: t(
                                  kind === "feed"
                                    ? "喂奶"
                                    : kind === "sleep"
                                      ? "睡眠"
                                      : "尿布",
                                ),
                              })} · ${formatDate(e.start)} ${formatTime(e.start)}${e.end ? `–${formatTime(e.end)}` : ""}`}
                              accessibilityHint={t("打开删除确认")}
                              onPress={() => onDelete(e)}
                              disabled={canEdit && !canEdit(e.id)}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {olderEventCount > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        dayEntriesExpanded
                          ? t("收起当天较早记录")
                          : t("显示 {count} 条更早记录", {
                              count: olderEventCount,
                            })
                      }
                      accessibilityState={{ expanded: dayEntriesExpanded }}
                      onPress={() =>
                        setExpandedDayEntries((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                      style={({ pressed }) => ({
                        alignSelf: "flex-start",
                        minHeight: 44,
                        minWidth: 44,
                        paddingHorizontal: 8,
                        paddingVertical: 8,
                        justifyContent: "center",
                        opacity: pressed ? 0.72 : 1,
                      })}
                    >
                      <T
                        style={{
                          color: c.primary,
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        {dayEntriesExpanded
                          ? t("收起当天较早记录")
                          : t("显示 {count} 条更早记录", {
                              count: olderEventCount,
                            })}
                      </T>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </Card>
          </View>
        );
      })}
      {nextDayCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("更多：显示前 {count} 天", {
            count: nextDayCount,
          })}
          onPress={() => setOlderDayPages((count) => count + 1)}
          style={({ pressed }) => ({
            minHeight: 44,
            minWidth: 44,
            paddingHorizontal: 12,
            paddingVertical: 8,
            alignSelf: "flex-start",
            borderRadius: 13,
            justifyContent: "center",
            backgroundColor: c.soft,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <T style={{ color: c.primary, fontSize: 13, fontWeight: "700" }}>
            {t("更多：显示前 {count} 天", { count: nextDayCount })}
          </T>
        </Pressable>
      ) : null}
      {olderDayPages > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("收起历史日期")}
          onPress={() => setOlderDayPages(0)}
          style={({ pressed }) => ({
            minHeight: 44,
            minWidth: 44,
            paddingHorizontal: 12,
            paddingVertical: 8,
            alignSelf: "flex-start",
            justifyContent: "center",
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <T style={{ color: c.primary, fontSize: 13, fontWeight: "700" }}>
            收起历史日期
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}
