import React from "react";
import Svg, { Path } from "react-native-svg";

// Subject-specific outlines with fixed bounds, independent of emoji fonts.
const paths = {
  activities:
    "M3 13h8v8H3z M13 13h8v8h-8z M8 3h8v8H8z M6 17h2 M16 17h2 M11 7h2",
  care: "M12 12S5 8 5 5.5C5 2 9 1.5 12 5c3-3.5 7-3 7 .5C19 8 12 12 12 12Z M2 15h3l4 3h5c2 0 2-3 0-3h-3 M5 15l3-2h3 M2 20h4l4 2 11-6c1-1 0-3-2-2l-4 2",
  choose:
    "M6 3h14v18H4V3h2 M8 2h8v3H8z M7 10l1 1 2-2 M13 10h4 M7 16l1 1 2-2 M13 16h4",
  temperature:
    "M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z M12 8v10 M11 18h2 M17 5h3 M17 9h2",
  bath: "M2 12h20 M3 12v3a5 5 0 0 0 5 5h8a5 5 0 0 0 5-5v-3 M6 20v2 M18 20v2 M5 12V5a3 3 0 0 1 6 0 M9 6h4",
  wash: "M7 2C7 2 3 7 3 9a4 4 0 0 0 8 0C11 7 7 2 7 2Z M2 17h3l4 3h5l7-4c1-1 0-3-2-2l-4 2 M5 17l3-3h5c2 0 2 3 0 3h-3 M15 4h6 M18 1v6",
  oral: "M12 4C5-1 2 4 5 12c1 3 1 9 4 9 2 0 1-7 3-7s1 7 3 7c3 0 3-6 4-9 3-8 0-13-7-8Z M12 4l3 1",
  nails:
    "M8 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M22 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M7 15 19 2 M17 15 5 2",
  supplement: "M9 3h6v4H9z M9 7l-2 3v10h10V10l-2-3 M7 12h10 M10 16h4 M12 14v4",
  forehead:
    "M8 22v-4c-3-2-4-5-4-8a7 7 0 0 1 14 0l3 4h-3v3c0 2-2 3-5 3v2 M16 7a.7.7 0 1 0 0 .01",
  armpit:
    "M3 22v-6c0-3 3-4 5-4V9a4 4 0 1 1 7 0v3l4-5-4-4 M18 2l4 5-6 9v6 M7 18v4 M13 15a.8.8 0 1 0 0 .01",
  ear: "M5 9a7 7 0 0 1 14 0c0 5-5 5-6 9-1 5-6 4-7 1 M8 9a4 4 0 0 1 8 0c0 3-3 3-4 5 M9 11c3 0 3 4 0 4",
  rectal: "M3 19 16 3a3 3 0 0 1 5 4L7 22H3z M12 12l6-7 2 2-6 7z M3 19l4 3",
  other: "M5 12a1 1 0 1 0 0 .01 M12 12a1 1 0 1 0 0 .01 M19 12a1 1 0 1 0 0 .01",
  check: "M5 12l4 4L19 6",
} as const;

export type PlayIconKind = keyof typeof paths;
export default function PlayIcon({
  kind,
  color,
  size = 24,
}: {
  kind: PlayIconKind;
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={paths[kind]}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
