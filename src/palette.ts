// Semantic colors shared by native controls, screens and contrast checks.
// Explicit appearances also have an increased-contrast variant. Native system
// preference changes select these centrally rather than branching per screen.
export const light = {
  isDark: false,
  isHighContrast: false,
  bg: "#F2F2F7",
  card: "#FFFFFF",
  elevated: "#FFFFFF",
  input: "#F2F2F7",
  text: "#1C1C1E",
  muted: "#515159",
  line: "#D1D1D6",
  controlLine: "#7A7A80",
  primary: "#005EB8",
  onPrimary: "#FFFFFF",
  soft: "#E8F1FB",
  danger: "#AC241B",
  hero: "#E8F1FB",
  heroText: "#193B5A",
  heroMuted: "#405970",
  heroLine: "#B4CADD",
  avatar: "#FFF5E6",
  icon: "#3A5267",
  feed: "#FBE0D3",
  diaper: "#FFF0C9",
  sleep: "#E5DDF7",
  growth: "#D8EEE8",
  milestone: "#F0D7B5",
};

export const dark: typeof light = {
  isDark: true,
  isHighContrast: false,
  bg: "#101113",
  card: "#1C1C1E",
  elevated: "#2C2C2E",
  input: "#242426",
  text: "#F2F2F7",
  muted: "#B5B5BA",
  line: "#48484A",
  controlLine: "#7C7C82",
  primary: "#84B9E5",
  onPrimary: "#101C28",
  soft: "#293442",
  danger: "#FF9A91",
  hero: "#202A35",
  heroText: "#F2F2F7",
  heroMuted: "#BAC9D8",
  heroLine: "#485B6B",
  avatar: "#34343A",
  icon: "#E3E5EB",
  feed: "#382E29",
  diaper: "#353123",
  sleep: "#302A40",
  growth: "#263832",
  milestone: "#3A2C31",
};

export type Palette = typeof light;

export const lightHighContrast: Palette = {
  ...light,
  isHighContrast: true,
  bg: "#FFFFFF",
  input: "#FFFFFF",
  elevated: "#F2F2F7",
  text: "#000000",
  muted: "#303038",
  line: "#62626B",
  controlLine: "#45454F",
  primary: "#00458A",
  danger: "#8E190F",
  soft: "#E5EDF6",
  hero: "#E5EDF6",
  heroText: "#142E48",
  heroMuted: "#303F4F",
  heroLine: "#62626B",
};

export const darkHighContrast: Palette = {
  ...dark,
  isHighContrast: true,
  bg: "#000000",
  card: "#101113",
  elevated: "#1C1C1E",
  input: "#101113",
  text: "#FFFFFF",
  muted: "#E1E1E6",
  line: "#98989F",
  controlLine: "#C7C7CC",
  primary: "#B3DCFF",
  onPrimary: "#071728",
  danger: "#FFB4AA",
  soft: "#1F2A35",
  hero: "#142536",
  heroText: "#FFFFFF",
  heroMuted: "#D8E9F9",
  heroLine: "#98989F",
};

export function selectPalette(isDark: boolean, highContrast = false): Palette {
  return isDark
    ? highContrast
      ? darkHighContrast
      : dark
    : highContrast
      ? lightHighContrast
      : light;
}
