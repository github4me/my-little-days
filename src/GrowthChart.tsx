import React, { useContext, useState } from "react";
import { Platform, ScrollView, View, useWindowDimensions } from "react-native";
import Svg, { Path, Line, Circle, Text as SvgText } from "react-native-svg";
import { Entry, State } from "./domain";
import { referenceSeries, type GrowthMetric } from "./growth";
import { T, Theme } from "./ui";
import { t, formatDate, formatNumber, useI18n } from "./i18n";
import { chartAxisLayout, chartFontFamily } from "./chartLayout";

export type Metric = GrowthMetric | "all";

const labels: Record<GrowthMetric, string> = {
  weight: "体重 kg",
  length: "身长 cm",
  head: "头围 cm",
};

function ageMonths(birth: string, instant: string) {
  const d = new Date(instant);
  const days =
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.parse(birth + "T00:00:00Z")) /
    86400000;
  return days / 30.4375;
}

function pointsFor(entries: Entry[], birth: string, metric: GrowthMetric) {
  return entries
    .filter((e) => e.type === "growth" && e[metric] !== undefined)
    .map((e) => ({
      month: ageMonths(birth, e.start),
      value: e[metric]!,
      id: e.id,
      date: e.start,
    }))
    .filter((e) => e.month >= 0)
    .sort((a, b) => a.month - b.month);
}

function GrowthPlot({
  entries,
  profile,
  metric,
  color,
  compact = false,
  showReferences = true,
}: {
  entries: Entry[];
  profile: State["profile"];
  metric: GrowthMetric;
  color: string;
  compact?: boolean;
  showReferences?: boolean;
}) {
  const c = useContext(Theme);
  const { localize } = useI18n();
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(
    Math.max(220, screenWidth - 64),
  );
  const points = pointsFor(entries, profile.birthDate, metric);
  const maxMonth = Math.max(
    3,
    Math.ceil(Math.max(0, ...points.map((point) => point.month))),
  );
  const refs = showReferences
    ? referenceSeries(metric, profile.sex, Math.min(24, maxMonth))
    : [];
  const values = [
    ...points.map((point) => point.value),
    ...refs.flatMap((point) => [point.p3, point.p97]),
  ];
  if (!values.length)
    return (
      <View
        style={{
          minHeight: compact ? 94 : undefined,
          justifyContent: "center",
        }}
      >
        <T style={{ color: c.muted, fontSize: 12 }}>
          {t("还没有{metric}记录", { metric: t(labels[metric]) })}
        </T>
      </View>
    );

  const min = Math.floor(Math.min(...values) * 0.9);
  const max = Math.ceil(Math.max(...values) * 1.08);
  const range = Math.max(1, max - min);
  const axisValues = [0, 1, 2, 3].map((index) =>
    formatNumber(min + (index * range) / 3, {
      minimumFractionDigits: metric === "weight" ? 1 : 0,
      maximumFractionDigits: metric === "weight" ? 1 : 0,
    }),
  );
  const axisMonths = [0, 1, 2, 3].map((index) =>
    t("{months}月", {
      months: formatNumber((index * maxMonth) / 3, {
        maximumFractionDigits: 0,
      }),
    }),
  );
  const layout = chartAxisLayout({
    width: availableWidth,
    fontScale,
    compact,
    leftLabelChars: Math.max(...axisValues.map((label) => label.length)),
    xLabelChars: Math.max(...axisMonths.map((label) => label.length)),
    xLabelCount: axisMonths.length,
  });
  const x = (month: number) =>
    layout.left + (month / maxMonth) * layout.plotWidth;
  const y = (value: number) =>
    layout.baseline - ((value - min) / range) * layout.plotHeight;
  const curve = (items: { month: number; value: number }[]) =>
    items
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${x(point.month)},${y(point.value)}`,
      )
      .join(" ");
  const latest = points.reduce<(typeof points)[number] | undefined>(
    (current, point) =>
      !current || Date.parse(point.date) > Date.parse(current.date)
        ? point
        : current,
    undefined,
  );
  const summary = latest
    ? localize(
        "{count} 条实测记录。最新：{date}，{value} {unit}。准确数值可在下方成长记录中查看。",
        "{count} recorded measurements. Latest: {value} {unit}, {date}. Exact measurements are listed in the growth records below.",
        {
          count: points.length,
          date: formatDate(latest.date),
          value: formatNumber(latest.value),
          unit: metric === "weight" ? "kg" : "cm",
        },
      )
    : localize(
        "尚无实测记录；当前只显示参考曲线。",
        "No recorded measurements; only reference curves are shown.",
      );

  return (
    <View
      testID="growth-chart"
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
          testID="growth-chart-plot"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${t(labels[metric])} ${t("成长曲线")}. ${summary}`}
        >
          {[0, 1, 2, 3].map((index) => {
            const value = min + (index * range) / 3;
            return (
              <React.Fragment key={index}>
                <Line
                  x1={layout.left}
                  x2={layout.width - layout.right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke={c.line}
                />
                <SvgText
                  x={layout.left - 8}
                  y={y(value) + layout.fontSize * 0.35}
                  textAnchor="end"
                  fill={c.muted}
                  fontSize={layout.fontSize}
                  fontFamily={chartFontFamily(Platform.OS)}
                >
                  {axisValues[index]}
                </SvgText>
              </React.Fragment>
            );
          })}
          {showReferences
            ? (["p3", "p15", "p50", "p85", "p97"] as const).map((key) => (
                <Path
                  key={key}
                  d={curve(
                    refs.map((point) => ({
                      month: point.months,
                      value: point[key],
                    })),
                  )}
                  fill="none"
                  stroke={c.controlLine}
                  strokeWidth={
                    key === "p50"
                      ? c.isHighContrast
                        ? 3
                        : 2
                      : c.isHighContrast
                        ? 2
                        : 1.2
                  }
                  strokeDasharray={key === "p50" ? undefined : "4 4"}
                />
              ))
            : null}
          <Path d={curve(points)} fill="none" stroke={color} strokeWidth={3} />
          {points.map((point) => (
            <Circle
              key={point.id}
              cx={x(point.month)}
              cy={y(point.value)}
              r={4}
              fill={color}
              stroke={c.card}
              strokeWidth={2}
            />
          ))}
          {[0, 1, 2, 3].map((index) => (
            <SvgText
              key={index}
              x={x((index * maxMonth) / 3)}
              y={layout.axisLabelY}
              fill={c.muted}
              fontSize={layout.fontSize}
              fontFamily={chartFontFamily(Platform.OS)}
              textAnchor="middle"
            >
              {axisMonths[index]}
            </SvgText>
          ))}
        </Svg>
      </ScrollView>
    </View>
  );
}

export default function GrowthChart({
  entries,
  profile,
  metric,
}: {
  entries: Entry[];
  profile: State["profile"];
  metric: Metric;
}) {
  const c = useContext(Theme);
  if (!profile.birthDate)
    return (
      <T style={{ color: c.muted }}>
        先在「我的」设置出生日期，即可按月龄查看曲线。
      </T>
    );

  const colors = c.isDark
    ? { weight: "#A8D6F5", length: "#F2AF94", head: "#C7B7FF" }
    : { weight: "#34759D", length: "#9F4935", head: "#7565A5" };

  if (metric === "all")
    return (
      <View style={{ gap: 10 }}>
        {(["weight", "length", "head"] as GrowthMetric[]).map((item) => (
          <View
            key={item}
            style={{
              backgroundColor: c.bg,
              borderRadius: 14,
              paddingHorizontal: 10,
              paddingTop: 7,
            }}
          >
            <T style={{ color: colors[item], fontSize: 13, fontWeight: "700" }}>
              ● {t(labels[item])}
            </T>
            <GrowthPlot
              entries={entries}
              profile={profile}
              metric={item}
              color={colors[item]}
              compact
              showReferences={false}
            />
          </View>
        ))}
        <T style={{ color: c.muted, fontSize: 12 }}>
          三项曲线按各自单位缩放；切换到单项可查看 WHO 参考。
        </T>
      </View>
    );

  return (
    <View>
      <GrowthPlot
        entries={entries}
        profile={profile}
        metric={metric}
        color={c.primary}
      />
      <T style={{ color: c.muted, fontSize: 12 }}>
        ● 宝宝实测　— WHO P50　┄ P3 / P15 / P85 / P97
      </T>
      <T style={{ color: c.muted, fontSize: 12 }}>
        {t("{reference} 曲线用于记录趋势，不作诊断。", {
          reference: t(
            profile.sex === "unspecified"
              ? "设置性别后显示参考线。"
              : "WHO 0–24月参考；月龄按天数 ÷ 30.4375 展示。",
          ),
        })}
      </T>
    </View>
  );
}
