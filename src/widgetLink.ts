// Exact route only: never treat an auth callback or arbitrary external URL as navigation.
export const isTodayWidgetLink = (url: string | null) =>
  url === "mylittledays://today" || url === "mylittledays://today/";
