import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

export default function GrowthMetricIcon({
  kind,
  color,
  size = 24,
}: {
  kind: "length" | "head";
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessible={false}>
      {kind === "length" ? (
        <>
          <Path
            d="M4 6h24M4 6l3-3M4 6l3 3M28 6l-3-3M28 6l-3 3"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle
            cx={7.5}
            cy={19}
            r={3.2}
            fill="none"
            stroke={color}
            strokeWidth={1.8}
          />
          <Path
            d="M11 17.5c3-2.5 8-2 10.5.5l5 3M11 20.5c4 3 9 3 12 .5l4 3M18 22.5l2 4M23 21.5l3.5 4"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <Path
            d="M10 28v-4c-4-2-6-6-6-11A10 10 0 0 1 24 11l4 6h-4v4c0 3-3 5-7 5v2"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M5 11.5Q15 7.5 24 10.5M5 14.5Q15 10.5 25.5 13.5M10 10l.8 3M15 8.8l.8 3M20 9l.8 3"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </Svg>
  );
}
