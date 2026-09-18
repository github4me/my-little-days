import React, { useContext, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { T, Theme } from "./ui";

/** Secondary help only: keep safety, errors and consent outside this disclosure. */
export default function HelpDisclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const c = useContext(Theme);
  const [expanded, setExpanded] = useState(false);
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: c.line,
        gap: expanded ? 8 : 0,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => ({
          minHeight: 44,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <T
          raw
          style={{ color: c.primary, flex: 1, fontSize: 15, fontWeight: "600" }}
        >
          {title}
        </T>
        <Svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          accessible={false}
          aria-hidden
        >
          <Path
            d={expanded ? "M3 10l5-5 5 5" : "M3 6l5 5 5-5"}
            fill="none"
            stroke={c.primary}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      {expanded ? (
        <View style={{ gap: 12, paddingBottom: 8 }}>{children}</View>
      ) : null}
    </View>
  );
}
