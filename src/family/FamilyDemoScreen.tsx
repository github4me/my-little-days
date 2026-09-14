import React, { useContext, useState } from "react";
import { ScrollView, View } from "react-native";
import { useI18n } from "../i18n";
import { Button, T, Theme } from "../ui";
import { demoScenarios, type FamilyDemoScenario } from "./demoScenarios";
import { useFamilyDemo } from "./useFamilyDemo";
import FamilyScreenView from "./FamilyScreenView";
import OwnerSetupCard from "./OwnerSetupCard";
import { prepareOwnerSeed, summarizeOwnerSeed } from "./ownerSeed";

function SampleScreen({
  scenario,
  onBack,
}: {
  scenario: FamilyDemoScenario;
  onBack: () => void;
}) {
  const pilot = useFamilyDemo(scenario);
  return (
    <FamilyScreenView
      pilot={pilot}
      onBack={onBack}
      demo
      initialDataSummary={pilot.initialDataSummary}
      ownerSetup={
        <OwnerSetupCard
          mode="demo"
          profile={pilot.demoSource.profile}
          summary={summarizeOwnerSeed(pilot.demoSource)}
          onPrepare={async (emails) =>
            prepareOwnerSeed(pilot.demoSource, emails, pilot.user?.email ?? "")
          }
          onSave={pilot.createFamilyFromSeed}
        />
      }
    />
  );
}

export default function FamilyDemoScreen({ onBack }: { onBack: () => void }) {
  const c = useContext(Theme);
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const [scenario, setScenario] = useState<FamilyDemoScenario>("first-invite");
  const [revision, setRevision] = useState(0);
  return (
    <View
      style={{ width: "100%", maxWidth: 680, alignSelf: "center", gap: 14 }}
    >
      <View
        style={{
          backgroundColor: c.soft,
          borderRadius: 18,
          padding: 12,
          gap: 10,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <T
            raw
            accessibilityRole="header"
            style={{ fontSize: 17, fontWeight: "700", flexShrink: 1 }}
          >
            {zh ? "界面预览" : "UI preview"}
          </T>
          <Button
            label={zh ? "重置样例" : "Reset samples"}
            secondary
            onPress={() => setRevision((value) => value + 1)}
            style={{ minHeight: 44, paddingHorizontal: 12 }}
          />
        </View>
        <T raw style={{ color: c.muted, fontSize: 13 }}>
          {zh
            ? "选择场景；可左右滑动查看更多"
            : "Choose a scenario; swipe for more"}
        </T>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 2 }}
        >
          {demoScenarios.map((item) => (
            <Button
              key={item.id}
              label={item.label[zh ? "zh-CN" : "en"]}
              secondary={scenario !== item.id}
              onPress={() => {
                setScenario(item.id);
                setRevision((value) => value + 1);
              }}
              style={{ minHeight: 44, paddingHorizontal: 12 }}
            />
          ))}
        </ScrollView>
      </View>
      <SampleScreen
        key={`${scenario}:${revision}`}
        scenario={scenario}
        onBack={onBack}
      />
    </View>
  );
}
