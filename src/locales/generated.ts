// Generated translation drafts are split by locale so only the selected
// catalog is evaluated during application hydration.
import type { LoadedGeneratedCatalog } from "./generated/shared";

export const GENERATED_LOCALES = [
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

export type GeneratedLocale = (typeof GENERATED_LOCALES)[number];

type CatalogModule = { default: LoadedGeneratedCatalog };
type CatalogLoader = () => CatalogModule;

// Keep every locale in the exported app for offline language changes, while
// deferring each Metro module factory (and its arrays/maps) until selection.
const loaders: Record<GeneratedLocale, CatalogLoader> = {
  "zh-Hant": () => require("./generated/zh-Hant"),
  fr: () => require("./generated/fr"),
  de: () => require("./generated/de"),
  hi: () => require("./generated/hi"),
  it: () => require("./generated/it"),
  ja: () => require("./generated/ja"),
  ko: () => require("./generated/ko"),
  es: () => require("./generated/es"),
  th: () => require("./generated/th"),
  vi: () => require("./generated/vi"),
};

const loadedCatalogs: Partial<Record<GeneratedLocale, LoadedGeneratedCatalog>> =
  {};
const pendingCatalogs: Partial<
  Record<GeneratedLocale, Promise<LoadedGeneratedCatalog>>
> = {};

function isGeneratedLocale(locale: string): locale is GeneratedLocale {
  return Object.prototype.hasOwnProperty.call(loaders, locale);
}

export async function loadGeneratedCatalog(
  locale: string,
): Promise<LoadedGeneratedCatalog | undefined> {
  if (!isGeneratedLocale(locale)) return undefined;
  const loaded = loadedCatalogs[locale];
  if (loaded) return loaded;

  let pending = pendingCatalogs[locale];
  if (!pending) {
    pending = Promise.resolve().then(() => {
      const module = loaders[locale]();
      loadedCatalogs[locale] = module.default;
      return module.default;
    });
    pendingCatalogs[locale] = pending;
  }

  try {
    return await pending;
  } finally {
    if (pendingCatalogs[locale] === pending) delete pendingCatalogs[locale];
  }
}

export function getGeneratedEnglishCatalog(
  locale: string,
): Readonly<Record<string, string>> | undefined {
  return isGeneratedLocale(locale)
    ? loadedCatalogs[locale]?.english
    : undefined;
}

export function getGeneratedCatalog(
  locale: string,
): Readonly<Record<string, string>> | undefined {
  return isGeneratedLocale(locale)
    ? loadedCatalogs[locale]?.canonical
    : undefined;
}

/** Diagnostic surface used to verify that hydration evaluates only requested locales. */
export function getLoadedGeneratedLocales(): readonly GeneratedLocale[] {
  return GENERATED_LOCALES.filter((locale) => loadedCatalogs[locale]);
}
