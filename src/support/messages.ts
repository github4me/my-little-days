export type SupportTranslationValues = Record<string, string | number>;

export type SupportTranslate = (
  key: string,
  values?: SupportTranslationValues,
) => string;

const englishMessages = {
  "support.back": "Back to More",
  "support.title": "Buy me a coffee",
  "support.intro": "Enjoying My Little Days? You can leave a little thanks.",
  "support.essential":
    "Optional, one-time support. No subscription or feature unlocks.",
  "support.options.title": "Choose an amount",
  "support.options.accessibilityLabel": "Support amounts",
  "support.product.small": "Small thanks",
  "support.product.coffee": "A coffee",
  "support.product.generous": "Big thanks",
  "support.product.loading": "Loading price",
  "support.product.unavailable": "Unavailable",
  "support.product.accessibilityLabel": "{name}, {price}",
  "support.product.selectHint":
    "Selects this support amount. Payment does not start yet.",
  "support.action.select": "Choose an amount",
  "support.action.support": "Support {price}",
  "support.action.loading": "Loading support options",
  "support.action.unavailable": "Support unavailable",
  "support.action.purchasing": "Opening Apple payment",
  "support.action.pending": "Waiting for approval",
  "support.action.purchaseHint": "Opens Apple's payment confirmation.",
  "support.action.reload": "Reload options",
  "support.action.checkStatus": "Check purchase status",
  "support.link.errorTitle": "Couldn’t open Apple support",
  "support.link.error": "Check your connection and try again.",
  "support.status.loading": "Loading support options…",
  "support.status.unavailable": "Support purchases aren't available right now.",
  "support.status.purchasing": "Opening Apple's payment sheet…",
  "support.status.pending": "Waiting for approval. You can keep using the app.",
  "support.status.success": "Thank you for supporting My Little Days.",
  "support.status.error":
    "The purchase couldn't be completed. You can choose an amount and try again.",
  "support.status.uncertain":
    "We couldn't confirm the result yet. Check your Apple purchase history before trying again.",
  "support.status.verification":
    "We couldn't verify this purchase, so it hasn't been acknowledged as support.",
  "support.status.processing":
    "Your purchase was confirmed, but processing isn't finished. You don't need to pay again.",
  "support.purchase.pending":
    "Waiting for approval. You can keep using the app.",
  "support.purchase.finalizing":
    "Your purchase was confirmed, but processing isn't finished. You don't need to pay again.",
  "support.purchase.success": "Thank you for supporting My Little Days.",
  "support.purchase.error.ambiguous":
    "We couldn't confirm the result yet. Check your Apple purchase history before trying again.",
  "support.about.title": "About support",
  "support.about.oneTime":
    "Each support purchase is a repeatable, one-time payment. It is not a subscription.",
  "support.about.appleBilling":
    "Apple manages billing. My Little Days doesn't receive your card or Apple Account details.",
  "support.about.noBenefits":
    "Supporting does not unlock features or change how the app works.",
  "support.about.history":
    "You can review completed payments in your Apple purchase history.",
  "support.about.historyAction": "View Apple purchase history",
  "support.about.refund":
    "You can ask Apple for refund help. Apple decides whether a purchase is eligible.",
  "support.about.refundAction": "Request refund help",
} as const;

export type SupportMessageKey = keyof typeof englishMessages;

const simplifiedChineseMessages: Record<SupportMessageKey, string> = {
  "support.back": "返回我的",
  "support.title": "请我喝杯咖啡",
  "support.intro": "如果小日子对你有帮助，可以留下一点心意。",
  "support.essential": "自愿、单次支持，不会订阅或解锁额外功能。",
  "support.options.title": "选择支持金额",
  "support.options.accessibilityLabel": "支持金额",
  "support.product.small": "小小心意",
  "support.product.coffee": "一杯咖啡",
  "support.product.generous": "多一份支持",
  "support.product.loading": "正在读取价格",
  "support.product.unavailable": "暂不可用",
  "support.product.accessibilityLabel": "{name}，{price}",
  "support.product.selectHint": "选择这个支持金额；此时不会开始付款。",
  "support.action.select": "请先选择金额",
  "support.action.support": "支持 {price}",
  "support.action.loading": "正在读取支持选项",
  "support.action.unavailable": "暂时无法支持",
  "support.action.purchasing": "正在打开 Apple 付款",
  "support.action.pending": "等待批准",
  "support.action.purchaseHint": "打开 Apple 的付款确认页面。",
  "support.action.reload": "重新载入选项",
  "support.action.checkStatus": "检查购买状态",
  "support.link.errorTitle": "无法打开 Apple 支持",
  "support.link.error": "请检查网络连接后重试。",
  "support.status.loading": "正在读取支持选项…",
  "support.status.unavailable": "目前无法使用支持购买。",
  "support.status.purchasing": "正在打开 Apple 付款页面…",
  "support.status.pending": "正在等待批准。你可以继续使用应用。",
  "support.status.success": "谢谢你支持小日子。",
  "support.status.error": "购买未完成。你可以重新选择金额后再试。",
  "support.status.uncertain":
    "暂时无法确认结果。再次尝试前，请先查看 Apple 购买记录。",
  "support.status.verification": "无法验证这笔购买，因此尚未确认为支持。",
  "support.status.processing":
    "购买已经确认，但处理尚未完成。你不需要再次付款。",
  "support.purchase.pending": "正在等待批准。你可以继续使用应用。",
  "support.purchase.finalizing":
    "购买已经确认，但处理尚未完成。你不需要再次付款。",
  "support.purchase.success": "谢谢你支持小日子。",
  "support.purchase.error.ambiguous":
    "暂时无法确认结果。再次尝试前，请先查看 Apple 购买记录。",
  "support.about.title": "关于支持",
  "support.about.oneTime": "每次支持都是可重复选择的单次付款，不是订阅。",
  "support.about.appleBilling":
    "付款由 Apple 管理。小日子不会收到你的银行卡或 Apple 账户详细信息。",
  "support.about.noBenefits": "支持不会解锁功能，也不会改变应用的使用方式。",
  "support.about.history": "你可以在 Apple 购买记录中查看已完成的付款。",
  "support.about.historyAction": "查看 Apple 购买记录",
  "support.about.refund":
    "你可以向 Apple 申请退款帮助；是否符合退款条件由 Apple 决定。",
  "support.about.refundAction": "申请退款帮助",
};

export const supportMessages: Readonly<Record<string, SupportMessageCatalog>> =
  {
    "en-US": englishMessages,
    "zh-CN": simplifiedChineseMessages,
  };

export type SupportMessageCatalog = Record<string, string>;

type LocaleParts = {
  language: string;
  script: string | null;
  region: string | null;
};

function localeParts(locale: string): LocaleParts {
  const parts = locale.replaceAll("_", "-").split("-").filter(Boolean);
  const language = (parts[0] ?? "").toLowerCase();
  const scriptPart = parts.find((part) => /^[A-Za-z]{4}$/.test(part));
  const regionPart = parts.find(
    (part, index) =>
      index > 0 && (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)),
  );
  return {
    language,
    script: scriptPart
      ? `${scriptPart[0].toUpperCase()}${scriptPart.slice(1).toLowerCase()}`
      : null,
    region: regionPart?.toUpperCase() ?? null,
  };
}

function inferredScript({ language, script, region }: LocaleParts) {
  if (script) return script;
  if (language !== "zh") return null;
  if (region === "TW" || region === "HK" || region === "MO") return "Hant";
  if (region === "CN" || region === "SG") return "Hans";
  return null;
}

export function resolveSupportMessageCatalog(
  locale: string,
  catalogs: Readonly<Record<string, SupportMessageCatalog>> = supportMessages,
): SupportMessageCatalog {
  const normalized = locale.replaceAll("_", "-").toLowerCase();
  const entries = Object.entries(catalogs);
  const exact = entries.find(
    ([availableLocale]) => availableLocale.toLowerCase() === normalized,
  );
  if (exact) return exact[1];

  const requested = localeParts(locale);
  const sameLanguage = entries.filter(
    ([availableLocale]) =>
      localeParts(availableLocale).language === requested.language,
  );
  const requestedScript = inferredScript(requested);
  if (requestedScript) {
    const scriptMatch = sameLanguage.find(
      ([availableLocale]) =>
        inferredScript(localeParts(availableLocale)) === requestedScript,
    );
    if (scriptMatch) return scriptMatch[1];
    const generic = sameLanguage.find(([availableLocale]) => {
      const available = localeParts(availableLocale);
      return !available.script && !available.region;
    });
    if (generic) return generic[1];
    return catalogs["en-US"] ?? englishMessages;
  }

  if (requested.region) {
    const regionMatch = sameLanguage.find(
      ([availableLocale]) =>
        localeParts(availableLocale).region === requested.region,
    );
    if (regionMatch) return regionMatch[1];
  }
  return sameLanguage[0]?.[1] ?? catalogs["en-US"] ?? englishMessages;
}

function interpolate(
  template: string,
  values?: SupportTranslationValues,
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name] ?? ""),
  );
}

/**
 * Creates the screen's translator without coupling it to the app-wide locale
 * union. Callers can supply a complete or partial catalog for any later
 * language; missing strings fall back to English.
 */
export function createSupportTranslator(
  locale: string,
  messages: SupportMessageCatalog = {},
): SupportTranslate {
  const builtIn = resolveSupportMessageCatalog(locale);
  const catalog: SupportMessageCatalog = {
    ...englishMessages,
    ...builtIn,
    ...messages,
  };
  return (key, values) => interpolate(catalog[key] ?? key, values);
}
