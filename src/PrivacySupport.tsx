import React, { useContext } from "react";
import { Linking, Pressable, View } from "react-native";
import { Card, Theme, T, heading, row } from "./ui";
import { t } from "./i18n";

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
        <T style={{ color: c.muted }}>了解数据如何留在本机</T>
      </View>

      <Card style={{ backgroundColor: c.soft }}>
        <T style={{ color: c.primary, fontSize: 18, fontWeight: "700" }}>
          你的数据，由你掌控
        </T>
        <T style={{ color: c.muted, fontSize: 13 }}>
          小日子是一款离线记录工具：我们不提供账号、服务器或云同步。
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
