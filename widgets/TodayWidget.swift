import SwiftUI
import WidgetKit

struct TodayEntry: TimelineEntry {
  let date: Date
  let snapshot: TodayWidgetSnapshot?
  var current: TodayWidgetSnapshot? {
    guard let snapshot, snapshot.isCurrent(at: date) else { return nil }
    return snapshot
  }
  var chinese: Bool {
    snapshot.map { $0.language == "zh" } ?? (Locale.current.languageCode == "zh")
  }
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry { example() }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    completion(context.isPreview ? example() : TodayEntry(date: Date(), snapshot: TodayWidgetSnapshot.read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    let now = Date()
    let snapshot = TodayWidgetSnapshot.read()
    let calendar = TodayWidgetSnapshot.localCalendar
    let nextDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!
    // A pre-rendered boundary entry cannot mislabel yesterday's totals as today
    // while iOS defers the next provider invocation.
    let boundary = min(nextDay, snapshot?.expiresAt ?? nextDay)
    var entries = [TodayEntry(date: now, snapshot: snapshot)]
    if boundary > now { entries.append(TodayEntry(date: boundary, snapshot: snapshot)) }
    completion(Timeline(entries: entries, policy: .after(max(now, boundary).addingTimeInterval(900))))
  }

  private func example() -> TodayEntry {
    let now = Date()
    return TodayEntry(date: now, snapshot: TodayWidgetSnapshot(schemaVersion: 1,
      binding: "gallery-example", day: TodayWidgetSnapshot.dayKey(now),
      timeZone: TimeZone.current.identifier, language: Locale.current.languageCode == "zh" ? "zh" : "en",
      feedMl: 450, diaperCount: 4, sleepMinutes: 180, updatedAt: now,
      expiresAt: now.addingTimeInterval(86400)))
  }
}

struct TodayWidgetView: View {
  let entry: TodayEntry
  @Environment(\.widgetFamily) private var family
  private var zh: Bool { entry.chinese }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(zh ? "今日" : "Today").font(.headline).widgetAccentable()
        Spacer(minLength: 4)
        if family == .systemMedium {
          Text(entry.date, format: .dateTime.month(.abbreviated).day())
            .font(.caption).foregroundStyle(.secondary)
        }
      }
      if let snapshot = entry.current {
        if family == .systemSmall {
          VStack(spacing: 5) {
            compactMetric(zh ? "奶量" : "Milk", symbol: "drop.fill", value: milk(snapshot), unit: "mL")
            compactMetric(zh ? "尿布" : "Nappies", symbol: "square.stack", value: "\(snapshot.diaperCount)", unit: zh ? "次" : "")
            compactMetric(zh ? "睡眠" : "Sleep", symbol: "moon.fill", value: sleep(snapshot), unit: zh ? "小时" : "h")
          }.privacySensitive()
        } else {
          HStack(alignment: .top, spacing: 12) {
            metric(zh ? "奶量" : "Milk", symbol: "drop.fill", value: milk(snapshot), unit: "mL")
            metric(zh ? "尿布" : "Nappies", symbol: "square.stack", value: "\(snapshot.diaperCount)", unit: zh ? "次" : "changes")
            metric(zh ? "已记录睡眠" : "Recorded sleep", symbol: "moon.fill", value: sleep(snapshot), unit: zh ? "小时" : "hours")
          }.privacySensitive()
        }
        Spacer(minLength: 0)
        (Text(zh ? "更新于 " : "Updated ") + Text(snapshot.updatedAt, style: .time))
          .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
      } else {
        Spacer(minLength: 0)
        Text(zh ? "打开小日子\n查看今日记录" : "Open Little Days\nto update today")
          .font(.subheadline).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      }
    }
    .widgetURL(URL(string: "mylittledays://today"))
    .modifier(WidgetSurface())
    .environment(\.locale, Locale(identifier: zh ? "zh-Hans" : "en"))
  }

  private func milk(_ snapshot: TodayWidgetSnapshot) -> String {
    snapshot.feedMl.formatted(.number.precision(.fractionLength(0...1)))
  }
  private func sleep(_ snapshot: TodayWidgetSnapshot) -> String {
    snapshot.displaySleepHours.formatted(.number.precision(.fractionLength(1)))
  }

  private func compactMetric(_ title: String, symbol: String, value: String, unit: String) -> some View {
    HStack(spacing: 4) {
      Image(systemName: symbol).font(.caption).frame(width: 14).accessibilityHidden(true)
      Text(title).font(.caption).foregroundStyle(.secondary)
      Spacer(minLength: 2)
      Text(value).font(.headline).monospacedDigit().minimumScaleFactor(0.8)
      if !unit.isEmpty { Text(unit).font(.caption2).foregroundStyle(.secondary) }
    }
    .lineLimit(1)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(title), \(value) \(unit)")
  }

  private func metric(_ title: String, symbol: String, value: String, unit: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Label(title, systemImage: symbol).font(.caption).foregroundStyle(.secondary).lineLimit(2)
      Text(value).font(.title2.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.75)
      Text(unit).font(.caption).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(title), \(value) \(unit)")
  }
}

private struct WidgetSurface: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      content.containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
    } else {
      content.padding().background(Color(uiColor: .systemBackground))
    }
  }
}

@main
struct LittleDaysTodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: TodayWidgetSnapshot.kind, provider: TodayProvider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName("Today's care")
    .description("Today's recorded milk, nappy changes and sleep. Tap to open Today.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct TodayWidgetPreviews: PreviewProvider {
  static var previews: some View {
    TodayWidgetView(entry: TodayEntry(date: Date(), snapshot: nil))
      .previewContext(WidgetPreviewContext(family: .systemSmall))
  }
}
