import React from "react";
import Svg, { Path } from "react-native-svg";

// Fixed vector bounds avoid font-baseline clipping on iOS.
export default function CareIcon({
  kind,
  size = 26,
  color,
}: {
  kind: "feed" | "sleep" | "diaper";
  size?: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessible={false}>
      {kind === "feed" ? (
        <>
          <Path
            d="M13 8V6h1V4.5a2 2 0 0 1 4 0V6h1v2M11 8h10v3H11Z"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M11 11h10l1 3v11a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V14l1-3ZM10 16h12M18 20h3M18 23h3"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : kind === "sleep" ? (
        <Path d="M13 4A12 12 0 1 0 28 19A11 11 0 0 1 13 4Z" fill={color} />
      ) : (
        <>
          <Path
            d="M4 7Q16 10 28 7L27 18Q25 27 16 28Q7 27 5 18Z"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <Path
            d="M4.5 12Q16 15 27.5 12M5 17Q12 17 12 26M27 17Q20 17 20 26M5 10L9 11M23 11L27 10"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}
