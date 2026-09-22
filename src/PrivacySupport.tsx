import React, { useContext, useState } from "react";
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
        accessibilityElementsHidden
        aria-hidden
        importantForAccessibility="no-hide-descendants"
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
        <T
          accessibilityRole="header"
          style={{ fontSize: 17, fontWeight: "700" }}
        >
          {title}
        </T>
        <T style={{ color: c.muted, fontSize: 17, lineHeight: 25 }}>
          {children}
        </T>
      </View>
    </View>
  );
}

export default function PrivacySupport({ onBack }: { onBack: () => void }) {
  const c = useContext(Theme);
  const { localize: copy } = useI18n();
  const [supportError, setSupportError] = useState(false);
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
            minHeight: 44,
            minWidth: 44,
            paddingVertical: 8,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <T raw style={{ color: c.primary, fontSize: 22, lineHeight: 24 }}>
          ‹
        </T>
        <T style={{ color: c.primary, fontSize: 17, fontWeight: "600" }}>
          返回我的
        </T>
      </Pressable>

      <View style={{ gap: 4 }}>
        <T
          accessibilityRole="header"
          dynamicTypeRamp="title1"
          style={[heading, { fontSize: 28, lineHeight: 36 }]}
        >
          隐私与支持
        </T>
        <T raw style={{ color: c.muted }}>
          {copy(
            "了解本机记录与可选家庭共享",
            "Understand offline records and optional family sharing",
          )}
        </T>
      </View>

      <Card style={{ backgroundColor: c.soft }}>
        <T
          accessibilityRole="header"
          style={{ color: c.primary, fontSize: 18, fontWeight: "700" }}
        >
          你的数据，由你掌控
        </T>
        <T raw style={{ color: c.muted, fontSize: 17 }}>
          {copy(
            "离线记录无需账户，也不会自动上传。首次共享需登录并确认创建或加入家庭。已加入家庭的账户再次登录时会恢复家庭共享；仅在另一台手机登录不会执行新的个人资料清理。",
            "Offline records need no account and are not uploaded automatically. First-time sharing requires sign-in and confirmation to create or join a family. Signing back into an account already in a family resumes its sharing; signing in on another phone alone does not trigger new personal-data cleanup.",
          )}
        </T>
      </Card>

      <Card>
        <T
          raw
          accessibilityRole="header"
          style={{ fontSize: 18, fontWeight: "700" }}
        >
          {copy("家庭共享", "Family sharing")}
        </T>
        <T raw style={{ color: c.muted, fontSize: 17 }}>
          {copy(
            "家庭账户通过 Microsoft Entra External ID 登录。创建家庭会上传你审核并确认的宝宝档案、全部已保存喂养、尿布、睡眠、成长、里程碑与照护记录，以及当前宝宝头像、提醒规则与设置、早教打卡和活动选择。上传成功且家庭资料已保存到本机后，会清理原个人资料及恢复副本，之后使用家庭记录，不保留可恢复的个人副本。建议由资料最完整的成员创建。",
            "Family accounts use Microsoft Entra External ID. Creating a family uploads the baby profile, all saved feeding, nappy, sleep, growth, milestone and care records, the current baby avatar, reminder rules and settings, play check-ins and activity selections that you review and confirm. After successful upload and local saving of the family data, the original personal data and recovery copies are cleared. You then use the family records; no recoverable personal copy is retained. The member with the most complete history should create the family.",
          )}
        </T>
        <T raw style={{ color: c.muted, fontSize: 17 }}>
          {copy(
            "确认加入家庭后，会先验证并保存下载的家庭资料，再清空并替换原本机资料及恢复副本，包括原头像、提醒和早教资料；不保留可恢复的个人副本，也不会上传或合并你的原有资料。仅查看邀请或取消确认不会清理资料。",
            "After you confirm joining, the app validates and saves the downloaded family data before clearing and replacing your original on-device data and recovery copies, including your avatar, reminders and play data. No recoverable personal copy is retained, and your original data is not uploaded or merged. Viewing an invitation or cancelling confirmation does not clear data.",
          )}
        </T>
        <T raw style={{ color: c.muted, fontSize: 17 }}>
          {copy(
            "成员可以查看全部家庭记录并编辑或删除自己的记录；管理员可编辑或删除任何记录，并管理头像和早教设置。管理员可不经提前通知移除成员。离开或被移除后，服务端访问停止；本机检测到变更后会清理家庭缓存、草稿和未发送修改，离线设备需重连后才能检测。退出登录也会清理本机家庭内容；已共享的贡献仍留在家庭。",
            "Members can view all family records and edit or delete their own records. Admins can edit or delete any record and manage the avatar and play settings. Admins can remove members without advance notice. Leaving or removal ends server access; the app clears family cache, drafts and unsent changes when it detects the change, which requires reconnection on an offline device. Signing out also clears local family content; contributions already shared stay with the family.",
          )}
        </T>
        <T raw style={{ color: c.muted, fontSize: 17 }}>
          {copy(
            "语言、主题、视图偏好、通知权限和本机通知启用状态不共享。家庭模式下，记录保存在服务器；本机缓存和待同步修改不等于备份，也不会写回个人离线资料。每位成员可下载并导出服务器已确认的家庭资料，但不能从文件恢复到共享家庭。",
            "Language, theme, view preferences, notification permissions and this phone’s notification opt-in are not shared. Family records are stored on the server; local cache and pending changes are not a backup and are not copied into personal offline records. Every member can download and export confirmed server data, but cannot restore a file into the shared family.",
          )}
        </T>
        <T raw style={{ color: c.muted, fontSize: 17 }}>
          {copy(
            "iOS 系统备份不包含应用的 SQLite 数据目录，包括个人记录、家庭缓存和待同步修改。个人记录可手动导出，当前家庭成员可下载服务器已确认的记录。此排除规则不涵盖你在应用外保存或分享的文件。",
            "iOS system backups exclude the app’s SQLite directory, including personal records, family cache and pending changes. Personal records can be exported manually; active family members can download confirmed server records. This exclusion does not cover files you save or share outside the app.",
          )}
        </T>
      </Card>

      <Card style={{ gap: 16 }}>
        <PrivacySection
          icon="⌂"
          title="本机记录"
          children="未启用家庭共享时，宝宝档案、记录、头像、早教和提醒资料保存在这台设备上，不会自动上传。主题、语言和视图偏好始终由本机保存。"
        />
        <PrivacySection
          icon="◉"
          title="宝宝照片"
          children="只有在你主动选择照片时才会访问所选照片。个人模式的头像保存在本机；创建家庭时会上传确认的当前头像，供家庭成员查看，之后由管理员修改或移除。不会上传整个相册。"
        />
        <PrivacySection
          icon="◷"
          title="本地提醒"
          children="个人模式的提醒仅保存在本机。家庭模式会共享提醒规则与设置，但通知由每台手机自行安排。下载规则不会自动开启通知，需在该手机选择启用并取得系统权限；关闭本机通知不会删除家庭规则。"
        />
        <PrivacySection
          icon="⇧"
          title="备份与删除"
          children="个人备份支持导入；家庭资料仅可下载，暂不支持从文件恢复。导出文件未加密；选择云端保存位置时，由你选择的服务处理文件。退出、移除成员、删除家庭或账户不会撤回已保存或分享的副本，请自行管理这些文件。卸载应用不会删除服务端记录或账户；删除账户请使用「我的账户」中的相应流程。"
        />
        <PrivacySection
          icon="♡"
          title="可选支持"
          children="iOS 上可以选择单次支持。付款由 Apple 处理；小日子不会收到你的银行卡或 Apple 账户详情，也不会把支持与你的宝宝、家庭或应用登录关联。未完成交易仅通过 StoreKit 恢复；收据和购买记录不会上传到小日子服务器。"
        />
        <PrivacySection
          icon="↻"
          title="软件更新"
          children={copy(
            "此安全版本仅通过安装新版应用更新，不接受远程代码热更新。安装更新不会上传宝宝记录或照片。",
            "This security version is updated by installing a new app build; remote code updates are disabled. Installing an update does not upload baby records or photos.",
          )}
          last
        />
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("联系支持")}
        onPress={() => {
          setSupportError(false);
          void Linking.openURL(`mailto:${supportEmail}`).catch(() =>
            setSupportError(true),
          );
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Card>
          <View style={row}>
            <View style={{ flex: 1, gap: 3 }}>
              <T style={{ fontSize: 17, fontWeight: "700" }}>联系支持</T>
              <T style={{ color: c.muted, fontSize: 17 }}>
                这款应用可离线使用，无需账号。需要帮助？请发送邮件给我们。
              </T>
              <T
                style={{ color: c.primary, fontSize: 17, fontWeight: "600" }}
                selectable
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
      {supportError ? (
        <T raw accessibilityRole="alert" style={{ color: c.danger }}>
          {copy(
            "无法打开邮件应用。请复制上方邮箱地址，在你的邮件应用中联系我们。",
            "Could not open your email app. Copy the address above and contact us using your email app.",
          )}
        </T>
      ) : null}
    </View>
  );
}
