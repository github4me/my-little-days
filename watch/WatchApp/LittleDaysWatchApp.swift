import SwiftUI

@main
struct LittleDaysWatchApp: App {
  @StateObject private var store = WatchStore()
  @Environment(\.scenePhase) private var scenePhase
  var body: some Scene {
    WindowGroup {
      WatchHome().environmentObject(store)
        .environment(\.locale, store.locale)
        .onChange(of: scenePhase) { phase in if phase == .active { store.reconnect() } }
    }
  }
}

private enum WatchRoute: Hashable { case milk, nappy, finishMilk, status, notifications }

private struct WatchHome: View {
  @EnvironmentObject private var store: WatchStore
  var body: some View {
    NavigationStack {
      TimelineView(.periodic(from: .now, by: 30)) { timeline in
        List {
          if let context = store.disk.context, context.isValid(at: timeline.date), let profile = context.profile {
            Section {
              Text(profile.name).font(.headline).accessibilityAddTraits(.isHeader)
              if let summary = store.disk.summary(at: timeline.date) {
                VStack(alignment: .leading, spacing: 8) {
                  Text(store.text("summary.today")).font(.headline)
                  Label(store.text("summary.milk", Int64(summary.totals.feedMl)), systemImage: "drop.fill")
                  Label(store.text("summary.nappies", Int64(summary.totals.diaperCount)), systemImage: "square.fill")
                  Label(store.text("summary.sleep", Int64(summary.totals.sleepMinutes)), systemImage: "moon.fill")
                  if summary.includesLocalChanges {
                    Text(store.text("summary.includes_watch_pending"))
                      .foregroundStyle(.secondary)
                  }
                  if summary.needsPhoneUpdate {
                    Text(store.text("summary.iphone_pending"))
                      .foregroundStyle(.secondary)
                  }
                  if let date = summary.phoneUpdatedAt.flatMap(WatchClock.date) {
                    PhoneUpdateLabel(date: date)
                  }
                }.font(.caption).fixedSize(horizontal: false, vertical: true)
              }
            }
            Section {
              if let feed = store.activeFeed {
                NavigationLink(value: WatchRoute.finishMilk) {
                  VStack(alignment: .leading) {
                    Label(store.text("action.finish_milk"), systemImage: "drop.fill")
                    elapsed(feed, now: timeline.date)
                  }
                }.disabled(feed.canControl == false)
              } else {
                NavigationLink(value: WatchRoute.milk) { Label(store.text("action.milk"), systemImage: "drop.fill") }
              }
              NavigationLink(value: WatchRoute.nappy) { Label(store.text("action.nappy"), systemImage: "square.fill") }
              Button {
                store.toggleSleep()
              } label: {
                VStack(alignment: .leading) {
                  Label(store.activeSleep == nil ? store.text("action.asleep") : store.text("action.awake"), systemImage: "moon.fill")
                  if let sleep = store.activeSleep { elapsed(sleep, now: timeline.date) }
                }
              }.disabled(store.activeSleep?.canControl == false)
              if store.activeFeed?.canControl == false || store.activeSleep?.canControl == false {
                Text(store.text("timer.manage_on_iphone"))
                  .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
              }
            }.disabled(!store.ready)
          } else {
            Section {
              Label(store.text("setup.open_iphone.title"), systemImage: "iphone")
              Text(store.text("setup.open_iphone.body"))
                .font(.caption).foregroundStyle(.secondary)
              Button(store.text("action.try_again")) { store.reconnect() }
            }
          }
          if let notice = store.notice {
            Section {
              Text(notice).font(.caption).fixedSize(horizontal: false, vertical: true)
              Button(store.text("action.dismiss")) { store.notice = nil }
            }
          }
          Section {
            NavigationLink(value: WatchRoute.status) {
              Label(store.pendingCount > 0 ? store.text("sync.pending.short", Int64(store.pendingCount)) : store.text("sync.status"), systemImage: "arrow.triangle.2.circlepath")
            }
            NavigationLink(value: WatchRoute.notifications) {
              Label(store.text("notifications.title"), systemImage: "bell")
            }
          }
        }
      }
      .navigationTitle(store.text("app.name"))
      .navigationDestination(for: WatchRoute.self) { route in
        switch route {
        case .milk: MilkEntryView()
        case .nappy: NappyEntryView()
        case .finishMilk: FinishMilkView()
        case .status: SyncStatusView()
        case .notifications: NotificationsView()
        }
      }
    }
  }
  private func elapsed(_ entry: WatchEntry, now: Date) -> some View {
    Text(store.text("elapsed.minutes", Int64(max(0, Int(now.timeIntervalSince(entry.startedAt) / 60)))))
      .font(.caption).foregroundStyle(.secondary)
  }
}

private struct PhoneUpdateLabel: View {
  @EnvironmentObject private var store: WatchStore
  let date: Date
  var body: some View {
    // A fixed wall-clock time, not SwiftUI's live relative counter. Phone
    // heartbeats may refresh the snapshot but cannot reset a seconds timer.
    Text(store.text("summary.phone_updated", date.formatted(
      .dateTime.locale(store.locale).month(.twoDigits).day(.twoDigits).hour().minute())))
      .font(.caption).foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
  }
}

private struct MilkEntryView: View {
  @EnvironmentObject private var store: WatchStore
  @Environment(\.dismiss) private var dismiss
  @State private var kind = "formula"
  @State private var amount = 120
  @State private var saving = false
  private var bottle: Bool { ["formula", "expressed"].contains(kind) }
  var body: some View {
    List {
      Picker(store.text("milk.type"), selection: $kind) {
        Text(store.text("milk.formula")).tag("formula")
        Text(store.text("milk.expressed")).tag("expressed")
        Text(store.text("milk.breast_left")).tag("breast-left")
        Text(store.text("milk.breast_right")).tag("breast-right")
        Text(store.text("milk.breast_both")).tag("breast-both")
      }
      if bottle {
        MilkAmountPicker(amount: $amount, title: store.text("milk.amount"))
        Button(store.text("milk.save")) {
          save(running: false)
        }.buttonStyle(.borderedProminent)
        Button(store.text("milk.start_timer")) {
          save(running: true)
        }
      } else {
        Button(store.text("milk.start_timer")) {
          save(running: true)
        }.buttonStyle(.borderedProminent)
      }
      if let notice = store.notice { Text(notice).font(.caption) }
    }
    .disabled(!store.ready || saving)
    .navigationTitle(store.text("action.milk"))
  }
  private func save(running: Bool) {
    guard !saving else { return }
    saving = true
    if store.recordFeed(kind: kind, amount: bottle ? Double(amount) : nil, running: running) { dismiss() }
    else { saving = false }
  }
}

private struct MilkAmountPicker: View {
  @EnvironmentObject private var store: WatchStore
  @Binding var amount: Int
  let title: String
  @ScaledMetric(relativeTo: .body) private var pickerHeight: CGFloat = 110
  var body: some View {
    Section {
      Picker(title, selection: $amount) {
        ForEach(0...2_000, id: \.self) { value in
          Text("\(value) mL").monospacedDigit().tag(value)
        }
      }
      .pickerStyle(.wheel)
      .labelsHidden()
      .frame(height: pickerHeight)
      .accessibilityLabel(title)
      .accessibilityValue("\(amount) mL")
      .accessibilityHint(store.text("crown.hint"))
    } header: {
      Text(title)
    } footer: {
      Text(store.text("crown.footer"))
    }
  }
}

private struct FinishMilkView: View {
  @EnvironmentObject private var store: WatchStore
  var body: some View {
    Group {
      if let feed = store.activeFeed {
        FinishMilkForm(feed: feed, initialAmount: store.disk.initialMilkAmount(for: feed))
          .id("\(store.disk.context?.bridgeId ?? ""):\(store.disk.context?.workspaceKey ?? ""):\(store.disk.context?.generation ?? 0):\(feed.id)")
      } else {
        Text(store.text("milk.none_running"))
      }
    }.navigationTitle(store.text("action.finish_milk"))
  }
}

private struct FinishMilkForm: View {
  @EnvironmentObject private var store: WatchStore
  @Environment(\.dismiss) private var dismiss
  let feed: WatchEntry
  @State private var stoppedAt = Date()
  @State private var amount: Int
  @State private var saving = false

  init(feed: WatchEntry, initialAmount: Int) {
    self.feed = feed
    _amount = State(initialValue: initialAmount)
  }

  var body: some View {
    List {
      if feed.isBottle {
        MilkAmountPicker(amount: $amount, title: store.text("milk.consumed"))
      }
      Button(store.text("milk.confirm_finish")) {
        guard !saving else { return }
        saving = true
        if store.finishFeed(feed, stoppedAt: stoppedAt, amount: feed.isBottle ? Double(amount) : nil) { dismiss() }
        else { saving = false }
      }.buttonStyle(.borderedProminent).disabled(!store.ready || feed.canControl == false || saving)
      Text(store.text("milk.end_time_note"))
        .font(.caption).foregroundStyle(.secondary)
      if let notice = store.notice { Text(notice).font(.caption) }
    }
  }
}

private struct NappyEntryView: View {
  @EnvironmentObject private var store: WatchStore
  @Environment(\.dismiss) private var dismiss
  @State private var saving = false
  var body: some View {
    List {
      nappy("wet", "nappy.wet", "drop")
      nappy("dirty", "nappy.dirty", "circle.fill")
      nappy("mixed", "nappy.mixed", "drop.circle")
      if let notice = store.notice { Text(notice).font(.caption) }
    }.navigationTitle(store.text("action.nappy")).disabled(!store.ready || saving)
  }
  private func nappy(_ kind: String, _ key: String, _ symbol: String) -> some View {
    Button {
      guard !saving else { return }
      saving = true
      if store.recordNappy(kind) { dismiss() } else { saving = false }
    } label: { Label(store.text(key), systemImage: symbol).frame(minHeight: 44) }
  }
}

private struct SyncStatusView: View {
  @EnvironmentObject private var store: WatchStore
  var body: some View {
    List {
      if let context = store.disk.context, let publishedAt = context.publishedAt,
         let updated = WatchClock.date(publishedAt) {
        Section { PhoneUpdateLabel(date: updated) }
      }
      Section {
        Text(store.plural("sync.records_waiting", count: store.pendingCount))
        if store.pendingCount > 0 {
          Text(store.text("sync.pending.detail"))
            .font(.caption).foregroundStyle(.secondary)
        }
        if store.rejectedCount > 0 {
          Text(store.text("sync.attention"))
        }
        Button(store.text("sync.retry")) { store.reconnect() }
      }
      if !store.rejectedItems.isEmpty {
        Section(store.text("sync.not_applied")) {
          ForEach(store.rejectedItems) { item in
            VStack(alignment: .leading) {
              if let date = WatchClock.date(item.command.createdAt) { Text(date, style: .time).font(.caption) }
              Text(store.rejectionMessage(item.receipt?.error)).font(.caption)
            }.fixedSize(horizontal: false, vertical: true)
          }
        }
      }
    }.navigationTitle(store.text("sync.status"))
  }
}

private struct NotificationsView: View {
  @EnvironmentObject private var store: WatchStore
  var body: some View {
    List {
      Section(store.text("notifications.care.title")) {
        Text(store.text("notifications.care.body"))
          .font(.caption).fixedSize(horizontal: false, vertical: true)
      }
      Section(store.text("notifications.family.title")) {
        Text(store.text("notifications.family.body"))
          .font(.caption).fixedSize(horizontal: false, vertical: true)
      }
      Section(store.text("notifications.delivery.title")) {
        Text(store.text("notifications.delivery.body"))
          .font(.caption).fixedSize(horizontal: false, vertical: true)
      }
    }.navigationTitle(store.text("notifications.title"))
  }
}
