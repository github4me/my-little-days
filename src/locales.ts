export const SUPPORTED_LOCALES = [
  "en",
  "zh-Hans",
  "zh-Hant",
  "fr",
  "de",
  "hi",
  "it",
  "ja",
  "ko",
  "es",
  "th",
  "vi",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LanguagePreference = "system" | SupportedLocale;

export type LocaleDefinition = {
  locale: SupportedLocale;
  englishName: string;
  autonym: string;
  formattingLocale: string;
};

/**
 * Stable picker order: System is rendered separately, then languages are
 * sorted by their canonical English names. Do not derive this order from the
 * active UI locale because that would move controls after a selection.
 */
export const LOCALE_REGISTRY: readonly LocaleDefinition[] = [
  {
    locale: "zh-Hans",
    englishName: "Chinese (Simplified)",
    autonym: "中文（简体）",
    formattingLocale: "zh-CN",
  },
  {
    locale: "zh-Hant",
    englishName: "Chinese (Traditional)",
    autonym: "中文（繁體）",
    formattingLocale: "zh-TW",
  },
  {
    locale: "en",
    englishName: "English",
    autonym: "English",
    formattingLocale: "en-AU",
  },
  {
    locale: "fr",
    englishName: "French",
    autonym: "Français",
    formattingLocale: "fr-FR",
  },
  {
    locale: "de",
    englishName: "German",
    autonym: "Deutsch",
    formattingLocale: "de-DE",
  },
  {
    locale: "hi",
    englishName: "Hindi",
    autonym: "हिन्दी",
    formattingLocale: "hi-IN",
  },
  {
    locale: "it",
    englishName: "Italian",
    autonym: "Italiano",
    formattingLocale: "it-IT",
  },
  {
    locale: "ja",
    englishName: "Japanese",
    autonym: "日本語",
    formattingLocale: "ja-JP",
  },
  {
    locale: "ko",
    englishName: "Korean",
    autonym: "한국어",
    formattingLocale: "ko-KR",
  },
  {
    locale: "es",
    englishName: "Spanish",
    autonym: "Español",
    formattingLocale: "es-ES",
  },
  {
    locale: "th",
    englishName: "Thai",
    autonym: "ไทย",
    formattingLocale: "th-TH",
  },
  {
    locale: "vi",
    englishName: "Vietnamese",
    autonym: "Tiếng Việt",
    formattingLocale: "vi-VN",
  },
] as const;

export type PreferredLocale = {
  languageCode?: string | null;
  languageTag?: string | null;
  languageScriptCode?: string | null;
  regionCode?: string | null;
};

export type ResolvedLocalization = {
  catalogLocale: SupportedLocale;
  formattingLocale: string;
};

const supported = new Set<string>(SUPPORTED_LOCALES);
const traditionalChineseRegions = new Set(["HK", "MO", "TW"]);

export function normalizeLanguagePreference(
  value: unknown,
): LanguagePreference | null {
  if (value === "zh") return "zh-Hans";
  if (value === "system" || (typeof value === "string" && supported.has(value)))
    return value as LanguagePreference;
  return null;
}

export function isChineseLocale(
  locale: SupportedLocale,
): locale is "zh-Hans" | "zh-Hant" {
  return locale === "zh-Hans" || locale === "zh-Hant";
}

export function localeDefinition(locale: SupportedLocale): LocaleDefinition {
  return LOCALE_REGISTRY.find((item) => item.locale === locale)!;
}

function normalizedPart(value: string | null | undefined) {
  return value?.trim() || "";
}

function languageCode(locale: PreferredLocale) {
  const direct = normalizedPart(locale.languageCode).toLowerCase();
  if (direct) return direct;
  return normalizedPart(locale.languageTag).split(/[-_]/, 1)[0].toLowerCase();
}

function chineseLocale(locale: PreferredLocale): "zh-Hans" | "zh-Hant" {
  const tagParts = normalizedPart(locale.languageTag).split(/[-_]/);
  const script = (
    normalizedPart(locale.languageScriptCode) ||
    tagParts.find((part) => /^(hans|hant)$/i.test(part)) ||
    ""
  ).toLowerCase();
  if (script === "hant") return "zh-Hant";
  if (script === "hans") return "zh-Hans";
  const region = (
    normalizedPart(locale.regionCode) ||
    tagParts.find(
      (part) => /^[a-z]{2}$/i.test(part) && part.toLowerCase() !== "zh",
    ) ||
    ""
  ).toUpperCase();
  return traditionalChineseRegions.has(region) ? "zh-Hant" : "zh-Hans";
}

export function matchSupportedLocale(
  locale: PreferredLocale,
): SupportedLocale | null {
  const code = languageCode(locale);
  if (code === "zh") return chineseLocale(locale);
  return supported.has(code) ? (code as SupportedLocale) : null;
}

function safeFormattingLocale(locale: PreferredLocale, fallback: string) {
  const tag = normalizedPart(locale.languageTag);
  if (!tag) return fallback;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? fallback;
  } catch {
    return fallback;
  }
}

export function resolveLocalization(
  preference: LanguagePreference,
  preferredLocales: readonly PreferredLocale[],
): ResolvedLocalization {
  if (preference !== "system") {
    const definition = localeDefinition(preference);
    return {
      catalogLocale: preference,
      formattingLocale: definition.formattingLocale,
    };
  }

  for (const preferred of preferredLocales) {
    const match = matchSupportedLocale(preferred);
    if (!match) continue;
    return {
      catalogLocale: match,
      formattingLocale: safeFormattingLocale(
        preferred,
        localeDefinition(match).formattingLocale,
      ),
    };
  }

  return {
    catalogLocale: "en",
    formattingLocale: localeDefinition("en").formattingLocale,
  };
}
