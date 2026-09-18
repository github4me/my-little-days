import SwiftUI

@main
struct LittleDaysWatchApp: App {
  @StateObject private var store = WatchStore()
  @Environment(\.scenePhase) private var scenePhase
  var body: some Scene {
    WindowGroup {
      WatchHome().environmentObject(store)
        .onChange(of: scenePhase) { phase in if phase == .active { store.reconnect() } }
    }
  }
}

private enum WatchRoute: Hashable { case milk, nappy, finishMilk, status }

private struct WatchHome: View {
  @EnvironmentObject private var store: WatchStore
  var body: some View {
    NavigationStack {
      TimelineView(.periodic(from: .now, by: 30)) { timeline in
        List {
          if let context = store.disk.context, context.isValid(at: timeline.date), let profile = context.profile {
            Section {
              Text(profile.name).font(.headline).accessibilityAddTraits(.isHeader)
              if let totals = context.totals {
                Text(summaryTitle(context, now: timeline.date))
                  .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("\(Int(totals.feedMl)) mL · \(Int(totals.sleepMinutes)) \(store.text("min sleep", "分钟睡眠")) · \(totals.diaperCount) \(store.text("nappies", "次尿布"))")
                  .font(.caption).fixedSize(horizontal: false, vertical: true)
              }
            }
            Section {
              if let feed = store.activeFeed {
                NavigationLink(value: WatchRoute.finishMilk) {
                  VStack(alignment: .leading) {
                    Label(store.text("Finish milk", "结束喂奶"), systemImage: "drop.fill")
                    elapsed(feed, now: timeline.date)
                  }
                }.disabled(feed.canControl == false)
              } else {
                NavigationLink(value: WatchRoute.milk) { Label(store.text("Milk", "喂奶"), systemImage: "drop.fill") }
              }
              NavigationLink(value: WatchRoute.nappy) { Label(store.text("Nappy", "尿布"), systemImage: "square.fill") }
              Button {
                store.toggleSleep()
              } label: {
                VStack(alignment: .leading) {
                  Label(store.activeSleep == nil ? store.text("Asleep", "睡了") : store.text("Awake", "醒了"), systemImage: "moon.fill")
                  if let sleep = store.activeSleep { elapsed(sleep, now: timeline.date) }
                }
              }.disabled(store.activeSleep?.canControl == false)
              if store.activeFeed?.canControl == false || store.activeSleep?.canControl == false {
                Text(store.text("Manage the pending or restricted timer on iPhone.", "请在 iPhone 上处理待确认或无权限更改的计时。"))
                  .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
              }
            }.disabled(!store.ready)
          } else {
            Section {
              Label(store.text("Open iPhone app", "请打开 iPhone 应用"), systemImage: "iphone")
              Text(store.text("Open Little Days on your paired iPhone to verify access and update this Watch.", "请打开配对 iPhone 上的小日子以验证访问权限并更新手表。"))
                .font(.caption).foregroundStyle(.secondary)
              Button(store.text("Try again", "重试")) { store.reconnect() }
            }
          }
          if let notice = store.notice {
            Section {
              Text(notice).font(.caption).fixedSize(horizontal: false, vertical: true)
              Button(store.text("Dismiss", "关闭")) { store.notice = nil }
            }
          }
          Section {
            NavigationLink(value: WatchRoute.status) {
              Label(store.pendingCount > 0 ? store.text("\(store.pendingCount) pending", "\(store.pendingCount) 条待同步") : store.text("Sync status", "同步状态"), systemImage: "arrow.triangle.2.circlepath")
            }
          }
        }
      }
      .navigationTitle(store.text("Little Days", "小日子"))
      .navigationDestination(for: WatchRoute.self) { route in
        switch route {
        case .milk: MilkEntryView()
        case .nappy: NappyEntryView()
        case .finishMilk: FinishMilkView()
        case .status: SyncStatusView()
        }
      }
    }
  }
  private func elapsed(_ entry: WatchEntry, now: Date) -> some View {
    Text("\(max(0, Int(now.timeIntervalSince(entry.startedAt) / 60))) \(store.text("min", "分钟"))")
      .font(.caption).foregroundStyle(.secondary)
  }
  private func summaryTitle(_ context: WatchContext, now: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    if context.totalsDate == formatter.string(from: now) {
      return store.text("Today · last iPhone update", "今日数据 · 上次手机更新")
    }
    return store.text("iPhone summary", "手机汇总") + (context.totalsDate.map { " · \($0)" } ?? "")
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
      Picker(store.text("Milk type", "喂养方式"), selection: $kind) {
        Text(store.text("Formula", "配方奶")).tag("formula")
        Text(store.text("Expressed milk", "瓶喂母乳")).tag("expressed")
        Text(store.text("Breast: left", "母乳：左侧")).tag("breast-left")
        Text(store.text("Breast: right", "母乳：右侧")).tag("breast-right")
        Text(store.text("Breast: both", "母乳：双侧")).tag("breast-both")
      }
      if bottle {
        MilkAmountPicker(amount: $amount)
        Button(store.text("Save milk feed", "保存喂奶")) {
          save(running: false)
        }.buttonStyle(.borderedProminent)
        Button(store.text("Start feed timer", "开始喂奶计时")) {
          save(running: true)
        }
      } else {
        Button(store.text("Start feed timer", "开始喂奶计时")) {
          save(running: true)
        }.buttonStyle(.borderedProminent)
      }
      if let notice = store.notice { Text(notice).font(.caption) }
    }
    .disabled(!store.ready || saving)
    .navigationTitle(store.text("Milk", "喂奶"))
  }
  private func save(running: Bool) {
    guard !saving else { return }
    saving = true
    if store.recordFeed(kind: kind, amount: running ? nil : Double(amount), running: running) { dismiss() }
    else { saving = false }
  }
}

private struct MilkAmountPicker: View {
  @EnvironmentObject private var store: WatchStore
  @Binding var amount: Int
  var body: some View {
    Section(store.text("Actually consumed · mL", "实际喝奶量 · mL")) {
      LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())]) {
        ForEach([60, 90, 120, 150], id: \.self) { value in
          Button("\(value) mL") { amount = value }
            .frame(minHeight: 44)
            .accessibilityLabel(store.text("Set consumed volume to \(value) millilitres", "将实际喝奶量设为 \(value) 毫升"))
        }
      }
      Picker(store.text("Adjust amount", "调整奶量"), selection: $amount) {
        ForEach(0...2_000, id: \.self) { value in Text("\(value) mL").tag(value) }
      }
      .accessibilityLabel(store.text("Actually consumed, millilitres", "实际喝奶量，毫升"))
      .accessibilityValue("\(amount)")
      .accessibilityHint(store.text("Turn the Digital Crown to adjust.", "转动数码表冠调整。"))
    }
  }
}

private struct FinishMilkView: View {
  @EnvironmentObject private var store: WatchStore
  @Environment(\.dismiss) private var dismiss
  @State private var stoppedAt = Date()
  @State private var amount = 120
  @State private var saving = false
  var body: some View {
    List {
      if let feed = store.activeFeed {
        if feed.isBottle { MilkAmountPicker(amount: $amount) }
        Text(store.text("The end time was captured when you opened this screen.", "结束时间按打开此页面的时刻记录。"))
          .font(.caption).foregroundStyle(.secondary)
        Button(store.text("Finish feed", "完成喂奶")) {
          guard !saving else { return }
          saving = true
          if store.finishFeed(feed, stoppedAt: stoppedAt, amount: feed.isBottle ? Double(amount) : nil) { dismiss() }
          else { saving = false }
        }.buttonStyle(.borderedProminent).disabled(!store.ready || feed.canControl == false || saving)
      } else { Text(store.text("No feed is running.", "没有正在计时的喂奶。")) }
      if let notice = store.notice { Text(notice).font(.caption) }
    }.navigationTitle(store.text("Finish milk", "结束喂奶"))
  }
}

private struct NappyEntryView: View {
  @EnvironmentObject private var store: WatchStore
  @Environment(\.dismiss) private var dismiss
  @State private var saving = false
  var body: some View {
    List {
      nappy("wet", "Wet", "尿湿", "drop")
      nappy("dirty", "Dirty", "便便", "circle.fill")
      nappy("mixed", "Mixed", "混合", "drop.circle")
      if let notice = store.notice { Text(notice).font(.caption) }
    }.navigationTitle(store.text("Nappy", "尿布")).disabled(!store.ready || saving)
  }
  private func nappy(_ kind: String, _ en: String, _ zh: String, _ symbol: String) -> some View {
    Button {
      guard !saving else { return }
      saving = true
      if store.recordNappy(kind) { dismiss() } else { saving = false }
    } label: { Label(store.text(en, zh), systemImage: symbol).frame(minHeight: 44) }
  }
}

private struct SyncStatusView: View {
  @EnvironmentObject private var store: WatchStore
  var body: some View {
    List {
      if let context = store.disk.context, let publishedAt = context.publishedAt,
         let updated = WatchClock.date(publishedAt) {
        Section(store.text("Last phone update", "上次手机更新")) { Text(updated, style: .relative) }
      }
      Section {
        Text(store.text("\(store.pendingCount) records waiting", "\(store.pendingCount) 条记录待同步"))
        if store.pendingCount > 0 {
          Text(store.text("Saved on this Watch. Open Little Days on iPhone to finish syncing. Received by iPhone does not mean shared with your family.", "记录已保存在此手表。打开 iPhone 上的小日子以完成同步。手机收到记录不代表已共享给家庭。"))
            .font(.caption).foregroundStyle(.secondary)
        }
        if store.rejectedCount > 0 {
          Text(store.text("Some records need attention on iPhone.", "部分记录需要在 iPhone 上处理。"))
        }
        Button(store.text("Retry sync", "重试同步")) { store.reconnect() }
      }
      if !store.rejectedItems.isEmpty {
        Section(store.text("Not applied", "未应用的记录")) {
          ForEach(store.rejectedItems) { item in
            VStack(alignment: .leading) {
              if let date = WatchClock.date(item.command.createdAt) { Text(date, style: .time).font(.caption) }
              Text(store.rejectionMessage(item.receipt?.error)).font(.caption)
            }.fixedSize(horizontal: false, vertical: true)
          }
        }
      }
      Section {
        Text(store.text("Family alerts follow your iPhone notification preferences and Apple's notification routing.", "家庭提醒遵循 iPhone 的通知设置及 Apple 的通知分发规则。"))
          .font(.caption).foregroundStyle(.secondary)
      }
    }.navigationTitle(store.text("Sync status", "同步状态"))
  }
}
