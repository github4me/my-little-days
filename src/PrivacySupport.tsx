import React, { useContext } from "react";
import { Linking, Pressable, View } from "react-native";
import { Card, Theme, T, heading, row } from "./ui";
import { t, useI18n } from "./i18n";

const supportEmail = "contact@reticle.com.au";

function PrivacySection({
  icon,
  title,
  children,
  last = false,
}: {
  icon: string;
  title: string;
  children: string;
  last?: boolean;
}) {
  const c = useContext(Theme);
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        paddingBottom: last ? 0 : 16,
        borderBottomWidth: last ? 0 : 1,
        borderColor: c.line,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: c.soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <T raw style={{ color: c.primary, fontSize: 17, lineHeight: 20 }}>
          {icon}
        </T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontSize: 15, fontWeight: "700" }}>{title}</T>
        <T style={{ color: c.muted, fontSize: 12, lineHeight: 19 }}>
          {children}
        </T>
      </View>
    </View>
  );
}

export default function PrivacySupport({ onBack }: { onBack: () => void }) {
  const c = useContext(Theme);
  const { locale } = useI18n();
  const copy = (zh: string, en: string) => (locale === "zh-CN" ? zh : en);
  return (
    <View style={{ gap: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("返回我的")}
        onPress={onBack}
        style={({ pressed }) => [
          {
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minHeight: 34,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <T raw style={{ color: c.primary, fontSize: 22, lineHeight: 24 }}>
          ‹
        </T>
        <T style={{ color: c.primary, fontSize: 13, fontWeight: "700" }}>
          返回我的
        </T>
      </Pressable>

      <View style={{ gap: 4 }}>
        <T style={[heading, { fontSize: 28, lineHeight: 36 }]}>隐私与支持</T>
        <T raw style={{ color: c.muted }}>
          {copy(
            "了解本机记录与可选家庭共享",
            "Understand offline records and optional family sharing",
          )}
        </T>
      </View>

      <Card style={{ backgroundColor: c.soft }}>
        <T style={{ color: c.primary, fontSize: 18, fontWeight: "700" }}>
          你的数据，由你掌控
        </T>
        <T raw style={{ color: c.muted, fontSize: 13 }}>
          {copy(
            "离线记录无需账户，也不会自动上传。只有登录并确认创建或加入家庭，才会启用共享。",
            "Offline records need no account and are not uploaded automatically. Sharing begins only after you sign in and confirm creating or joining a family.",
          )}
        </T>
      </Card>

      <Card>
        <T raw style={{ fontSize: 18, fontWeight: "700" }}>
          {copy("家庭共享", "Family sharing")}
        </T>
        <T raw style={{ color: c.muted, fontSize: 13 }}>
          {copy(
            "家庭账户通过 Microsoft Entra External ID 登录。首次创建会上传你审核并确认的宝宝档案和全部已保存喂养、尿布、睡眠、成长、里程碑与照护记录。加入家庭会下载管理员的完整资料，你的个人记录不会合并。激活成功后会清理原离线资料与恢复副本。",
            "Family accounts use Microsoft Entra External ID. Creating a family uploads the profile and all saved feeding, nappy, sleep, growth, milestone and care records you review and confirm. Joining downloads the admin’s complete records without merging personal records. Successful activation clears the original offline data and recovery copies.",
          )}
        </T>
        <T raw style={{ color: c.muted, fontSize: 13 }}>
          {copy(
            "家庭成员可以查看全部记录并编辑自己的记录；管理员可编辑任意记录。离开、被移除或退出登录会清理本机家庭数据和草稿；已经共享的贡献仍留在家庭。照片、设备偏好、提醒和早教打卡不上传，共享期间不提供本机备份导出或导入。",
            "Members can view all records and edit their own; admins can edit any record. Leaving, removal or sign-out clears family data and drafts from this device; shared contributions remain with the family. Photos, device preferences, reminders and play check-ins are not uploaded. Local backup export and import are unavailable while sharing.",
          )}
        </T>
      </Card>

      <Card style={{ gap: 16 }}>
        <PrivacySection
          icon="⌂"
          title="本机记录"
          children="宝宝档案、照护记录、主题、语言和提醒设定都保存在这台设备上。"
        />
        <PrivacySection
          icon="◉"
          title="宝宝照片"
          children="只有在你主动选择照片时才会请求相册权限。头像会复制到本机，可随时在宝宝档案中移除。"
        />
        <PrivacySection
          icon="◷"
          title="本地提醒"
          children="照护提醒由手机本地安排，不会将提醒内容上传到服务器。"
        />
        <PrivacySection
          icon="⇧"
          title="备份与删除"
          children="备份文件只会在你主动导出和分享时离开应用。删除应用会移除设备上的本机数据，请先导出备份。"
        />
        <PrivacySection
          icon="↻"
          title="软件更新"
          children="应用会安全检查更新。更新服务可能收到设备系统版本和随机安装标记，但不包含宝宝记录或照片。"
          last
        />
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("联系支持")}
        onPress={() => {
          void Linking.openURL(`mailto:${supportEmail}`).catch(() => {});
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Card>
          <View style={row}>
            <View style={{ flex: 1, gap: 3 }}>
              <T style={{ fontSize: 17, fontWeight: "700" }}>联系支持</T>
              <T style={{ color: c.muted, fontSize: 13 }}>
                这款应用可离线使用，无需账号。需要帮助？请发送邮件给我们。
              </T>
              <T
                style={{ color: c.primary, fontSize: 13, fontWeight: "700" }}
                raw
              >
                {supportEmail}
              </T>
            </View>
            <T raw style={{ color: c.primary, fontSize: 22 }}>
              ✉
            </T>
          </View>
        </Card>
      </Pressable>
    </View>
  );
}
