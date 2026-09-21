export const SUPPORT_APP_BUNDLE_ID = "com.littledays.babylog" as const;

export const SUPPORT_PURCHASE_PLATFORM = "ios" as const;
export const SUPPORT_PRODUCT_KIND = "consumable" as const;
export const SUPPORT_PURCHASE_IS_REPEATABLE = true as const;

export const SUPPORT_PRODUCT_IDS = [
  "com.littledays.babylog.tip.small",
  "com.littledays.babylog.tip.coffee",
  "com.littledays.babylog.tip.generous",
] as const;

export type SupportProductId = (typeof SUPPORT_PRODUCT_IDS)[number];

export type SupportTranslationKey =
  | "support.product.small"
  | "support.product.small.description"
  | "support.product.coffee"
  | "support.product.coffee.description"
  | "support.product.generous"
  | "support.product.generous.description";

export interface SupportTier {
  id: SupportProductId;
  labelKey: SupportTranslationKey;
  descriptionKey: SupportTranslationKey;
}

export const SUPPORT_TIERS: readonly SupportTier[] = [
  {
    id: "com.littledays.babylog.tip.small",
    labelKey: "support.product.small",
    descriptionKey: "support.product.small.description",
  },
  {
    id: "com.littledays.babylog.tip.coffee",
    labelKey: "support.product.coffee",
    descriptionKey: "support.product.coffee.description",
  },
  {
    id: "com.littledays.babylog.tip.generous",
    labelKey: "support.product.generous",
    descriptionKey: "support.product.generous.description",
  },
];

const SUPPORT_PRODUCT_ID_SET = new Set<string>(SUPPORT_PRODUCT_IDS);

export function isSupportProductId(value: unknown): value is SupportProductId {
  return typeof value === "string" && SUPPORT_PRODUCT_ID_SET.has(value);
}
