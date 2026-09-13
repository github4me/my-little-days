import React, { useContext } from "react";
import app from "../app.json";
import { T, Theme } from "./ui";
import { t } from "./i18n";

export default function AppVersion() {
  const c = useContext(Theme);
  return (
    <T
      accessibilityLabel={t("应用版本")}
      style={{ fontSize: 11, color: c.muted, textAlign: "center" }}
    >
      {t("版本 {version} · 更新 {build}", {
        version: app.expo.version,
        build: app.expo.ios.buildNumber,
      })}
    </T>
  );
}
