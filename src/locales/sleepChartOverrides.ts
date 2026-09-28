import type { SupportedLocale } from "../locales";

// Explain display adjustments without implying that sleep records were changed.
export const sleepChartEnglish = {
  compressed:
    "Long sleep bars are shortened to the average of other sleeps; break marks and labels show the actual duration.",
  spaced:
    "Nearby sleep bars are spaced apart; bottom marks show each segment’s start time within this day.",
} as const;

type ChartText = keyof typeof sleepChartEnglish;
type TranslatedLocale = Exclude<SupportedLocale, "en" | "zh-Hans">;

const translations: Record<TranslatedLocale, Record<ChartText, string>> = {
  "zh-Hant": {
    compressed:
      "長睡眠柱已縮短至其他睡眠的平均高度；斷線標記和標籤顯示實際時長。",
    spaced: "相鄰睡眠柱已錯開；底部標記表示本日片段的開始時間。",
  },
  fr: {
    compressed:
      "Les barres des longues périodes de sommeil sont raccourcies à la hauteur moyenne des autres périodes ; les marques de coupure et les étiquettes indiquent la durée réelle.",
    spaced:
      "Les barres de sommeil proches sont espacées ; les repères du bas indiquent l’heure de début de chaque segment dans cette journée.",
  },
  de: {
    compressed:
      "Lange Schlafbalken werden auf die durchschnittliche Höhe der übrigen Schlafphasen verkürzt; Unterbrechungsmarkierungen und Beschriftungen zeigen die tatsächliche Dauer.",
    spaced:
      "Nahe beieinanderliegende Schlafbalken werden auseinandergerückt; die Markierungen unten zeigen den Beginn jedes Schlafabschnitts an diesem Tag.",
  },
  hi: {
    compressed:
      "लंबी नींद के स्तंभों को दूसरी नींदों की औसत ऊँचाई तक छोटा किया गया है; कटाव के निशान और लेबल वास्तविक अवधि दिखाते हैं।",
    spaced:
      "पास-पास की नींद के स्तंभों के बीच फ़ासला रखा गया है; नीचे के निशान इस दिन के हर नींद खंड का शुरू होने का समय दिखाते हैं।",
  },
  it: {
    compressed:
      "Le barre dei sonni lunghi sono accorciate all’altezza media degli altri sonni; i segni di interruzione e le etichette mostrano la durata effettiva.",
    spaced:
      "Le barre del sonno vicine sono distanziate; i segni in basso indicano l’orario di inizio di ciascun segmento in questa giornata.",
  },
  ja: {
    compressed:
      "長い睡眠の棒は、ほかの睡眠の平均の高さに短縮しています。省略を示す印とラベルで実際の睡眠時間を示しています。",
    spaced:
      "近接する睡眠の棒は間隔を空けています。下部の印は当日内の各睡眠区間の開始時刻を示しています。",
  },
  ko: {
    compressed:
      "긴 수면 막대는 다른 수면의 평균 높이로 줄여 표시합니다. 생략 표시와 라벨은 실제 수면 시간을 나타냅니다.",
    spaced:
      "서로 가까운 수면 막대는 간격을 벌려 표시합니다. 아래쪽 표시는 해당 날짜에 속한 각 수면 구간의 시작 시간을 나타냅니다.",
  },
  es: {
    compressed:
      "Las barras de sueño largo se acortan a la altura media de las demás sesiones; las marcas de corte y las etiquetas muestran la duración real.",
    spaced:
      "Las barras de sueño cercanas se separan; las marcas inferiores indican la hora de inicio de cada tramo dentro de este día.",
  },
  th: {
    compressed:
      "แท่งของการนอนที่ยาวนานจะย่อให้สูงเท่าค่าเฉลี่ยของการนอนครั้งอื่น เครื่องหมายตัดและป้ายกำกับแสดงระยะเวลาจริง",
    spaced:
      "แท่งการนอนที่อยู่ใกล้กันจะเว้นระยะห่าง เครื่องหมายด้านล่างแสดงเวลาเริ่มต้นของแต่ละช่วงในวันที่แสดง",
  },
  vi: {
    compressed:
      "Các cột giấc ngủ dài được rút ngắn về chiều cao trung bình của các giấc ngủ còn lại; dấu ngắt và nhãn cho biết thời lượng thực tế.",
    spaced:
      "Các cột giấc ngủ gần nhau được giãn cách; dấu ở phía dưới cho biết thời điểm bắt đầu của từng đoạn giấc ngủ trong ngày này.",
  },
};

const keyByEnglish = new Map<string, ChartText>(
  Object.entries(sleepChartEnglish).map(([key, value]) => [
    value,
    key as ChartText,
  ]),
);

export function sleepChartEnglishOverride(
  locale: SupportedLocale,
  template: string,
): string | undefined {
  if (locale === "en" || locale === "zh-Hans") return undefined;
  const key = keyByEnglish.get(template);
  return key ? translations[locale][key] : undefined;
}
