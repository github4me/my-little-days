import React, { useContext } from "react";
import { Switch, View } from "react-native";
import { Button, T, Theme } from "../ui";
import { useI18n } from "../i18n";
import { pushCategories } from "./familyPushCore";
import type { useFamilyPush } from "./useFamilyPush";

export default function FamilyPushSettings({
  controller: p,
}: {
  controller: ReturnType<typeof useFamilyPush>;
}) {
  const c = useContext(Theme);
  const { locale } = useI18n();
  const copy = (zh: string, en: string) => (locale === "en-US" ? en : zh);
  const labels = {
    feed: copy("喂奶", "Milk feeds"),
    diaper: copy("尿布", "Nappies"),
    sleep: copy("睡眠", "Sleep"),
  };
  const disabled = !p.available || p.busy;
  return (
    <View style={{ gap: 14 }}>
      <T raw style={{ color: c.muted }}>
        {copy(
          "家人添加喂奶、尿布或睡眠记录时通知我。不会通知自己的记录。",
          "Notify me when another family member adds a milk feed, nappy or sleep record. Your own records are excluded.",
        )}
      </T>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 44,
        }}
      >
        <T raw style={{ flex: 1 }}>
          {copy("接收家人记录通知", "Family entry notifications")}
        </T>
        <Switch
          accessibilityLabel={copy(
            "接收家人记录通知",
            "Family entry notifications",
          )}
          value={p.desiredEnabled}
          disabled={disabled}
          onValueChange={(enabled) =>
            void p.change(
              enabled,
              p.categories.length ? p.categories : [...pushCategories],
            )
          }
        />
      </View>
      {p.desiredEnabled
        ? pushCategories.map((category) => (
            <View
              key={category}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 44,
              }}
            >
              <T raw style={{ flex: 1 }}>
                {labels[category]}
              </T>
              <Switch
                accessibilityLabel={labels[category]}
                disabled={disabled}
                value={p.categories.includes(category)}
                onValueChange={(enabled) => {
                  const categories = pushCategories.filter((v) =>
                    v === category ? enabled : p.categories.includes(v),
                  );
                  void p.change(categories.length > 0, categories);
                }}
              />
            </View>
          ))
        : null}
      {p.pending ? (
        <T raw accessibilityLiveRegion="polite" style={{ color: c.muted }}>
          {copy(
            "设置尚未与服务确认。如正在关闭，在联网确认前仍可能收到通知；已经发送的通知无法撤回。",
            "This setting is awaiting service confirmation. If turning notifications off, alerts may still arrive until the change is confirmed online. Already-sent alerts cannot be recalled.",
          )}
        </T>
      ) : null}
      {p.error ? (
        <T raw accessibilityRole="alert" style={{ color: c.danger }}>
          {p.error === "push_open_failed"
            ? copy(
                "暂时无法确认家庭访问权限，请联网后重试打开记录。",
                "Could not verify family access. Reconnect and retry opening the records.",
              )
            : p.error === "push_unavailable"
              ? copy(
                  "家庭通知尚未启用，请在服务配置完成后重试。",
                  "Family notifications are not enabled on the service yet. Try again after setup.",
                )
              : p.error === "push_permission_denied"
                ? copy(
                    "请在手机设置中允许小日子通知，然后重试。",
                    "Allow Little Days notifications in phone Settings, then try again.",
                  )
                : p.error === "push_previous_account"
                  ? copy(
                      "上一个账户的通知设置仍待确认。请登录该账户完成关闭后重试。",
                      "The previous account's notification request is unresolved. Sign in to that account to finish turning notifications off, then retry.",
                    )
                  : copy(
                      "未能确认通知设置，请检查连接后重试。",
                      "Could not confirm notification settings. Check the connection and retry.",
                    )}
        </T>
      ) : null}
      {p.pending || p.error ? (
        <Button
          label={copy("重试", "Retry")}
          secondary
          busy={p.busy}
          disabled={!p.available}
          onPress={() => void p.retry()}
        />
      ) : null}
      <T raw style={{ color: c.muted, fontSize: 13 }}>
        {copy(
          "通知不包含宝宝或记录详情。Apple 会根据设备状态显示在 iPhone 或 Apple Watch 上；专注模式和系统设置可能延迟或静音通知。",
          "Notifications contain no baby or record details. Apple routes alerts to iPhone or Apple Watch; Focus and system settings may delay or silence them.",
        )}
      </T>
    </View>
  );
}
