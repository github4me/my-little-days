import type { SupportedLocale } from "../locales";

export const uiReviewEnglish = {
  discardTitle: "Discard unsaved changes?",
  discardDetail:
    "These changes have not been saved. Discarding them cannot be undone.",
  keepEditing: "Keep editing",
  discard: "Discard changes",
  milk: "mL milk",
  sleep: "hours sleep",
  diapers: "diapers",
  expressed: "Expressed milk",
  legend: "Break mark = compressed height; read the duration label.",
} as const;

type TextKey = keyof typeof uiReviewEnglish;
type TranslatedLocale = Exclude<SupportedLocale, "en" | "zh-Hans">;
const translations: Record<TranslatedLocale, Record<TextKey, string>> = {
  "zh-Hant": {
    discardTitle: "放棄未儲存的修改？",
    discardDetail: "這些修改尚未儲存。放棄後無法復原。",
    keepEditing: "繼續編輯",
    discard: "放棄修改",
    milk: "mL 奶量",
    sleep: "小時 睡眠",
    diapers: "次 尿布",
    expressed: "瓶餵母乳",
    legend: "斷線＝高度壓縮；以標籤時長為準。",
  },
  fr: {
    discardTitle: "Abandonner les modifications non enregistrées ?",
    discardDetail:
      "Ces modifications ne sont pas enregistrées. Leur abandon est irréversible.",
    keepEditing: "Continuer à modifier",
    discard: "Abandonner les modifications",
    milk: "mL de lait",
    sleep: "h de sommeil",
    diapers: "couches",
    expressed: "Lait maternel tiré",
    legend: "Coupure = hauteur réduite ; consultez la durée indiquée.",
  },
  de: {
    discardTitle: "Ungespeicherte Änderungen verwerfen?",
    discardDetail:
      "Diese Änderungen wurden nicht gespeichert. Das Verwerfen kann nicht rückgängig gemacht werden.",
    keepEditing: "Weiter bearbeiten",
    discard: "Änderungen verwerfen",
    milk: "mL Milch",
    sleep: "Std. Schlaf",
    diapers: "Windeln",
    expressed: "Abgepumpte Muttermilch",
    legend: "Unterbrechung = verkürzte Höhe; die angegebene Dauer gilt.",
  },
  hi: {
    discardTitle: "बिना सहेजे बदलाव छोड़ दें?",
    discardDetail:
      "ये बदलाव अभी सहेजे नहीं गए हैं। इन्हें छोड़ने के बाद वापस नहीं लाया जा सकता।",
    keepEditing: "संपादन जारी रखें",
    discard: "बदलाव छोड़ें",
    milk: "mL दूध",
    sleep: "घंटे नींद",
    diapers: "डायपर",
    expressed: "निकाला गया माँ का दूध",
    legend: "कटाव = ऊँचाई कम की गई है; अवधि का लेबल देखें।",
  },
  it: {
    discardTitle: "Scartare le modifiche non salvate?",
    discardDetail:
      "Queste modifiche non sono state salvate. Se le scarti, non potrai recuperarle.",
    keepEditing: "Continua a modificare",
    discard: "Scarta modifiche",
    milk: "mL latte",
    sleep: "ore sonno",
    diapers: "pannolini",
    expressed: "Latte materno estratto",
    legend: "Interruzione = altezza ridotta; leggi la durata indicata.",
  },
  ja: {
    discardTitle: "未保存の変更を破棄しますか？",
    discardDetail:
      "これらの変更はまだ保存されていません。破棄すると元に戻せません。",
    keepEditing: "編集を続ける",
    discard: "変更を破棄",
    milk: "mL ミルク",
    sleep: "時間 睡眠",
    diapers: "おむつ",
    expressed: "搾乳した母乳",
    legend: "省略の印＝高さを短縮。ラベルの睡眠時間をご確認ください。",
  },
  ko: {
    discardTitle: "저장하지 않은 변경 사항을 버릴까요?",
    discardDetail:
      "이 변경 사항은 아직 저장되지 않았습니다. 버리면 복구할 수 없습니다.",
    keepEditing: "계속 편집",
    discard: "변경 사항 버리기",
    milk: "mL 수유",
    sleep: "시간 수면",
    diapers: "기저귀",
    expressed: "유축 모유",
    legend: "생략 표시 = 높이 축소. 라벨의 실제 수면 시간을 확인하세요.",
  },
  es: {
    discardTitle: "¿Descartar los cambios sin guardar?",
    discardDetail:
      "Estos cambios aún no se han guardado. Si los descartas, no podrás recuperarlos.",
    keepEditing: "Seguir editando",
    discard: "Descartar cambios",
    milk: "mL leche",
    sleep: "horas sueño",
    diapers: "pañales",
    expressed: "Leche materna extraída",
    legend: "Corte = altura reducida; consulta la duración indicada.",
  },
  th: {
    discardTitle: "ละทิ้งการแก้ไขที่ยังไม่ได้บันทึกหรือไม่?",
    discardDetail:
      "การแก้ไขเหล่านี้ยังไม่ได้บันทึก หากละทิ้งจะไม่สามารถกู้คืนได้",
    keepEditing: "แก้ไขต่อ",
    discard: "ละทิ้งการแก้ไข",
    milk: "mL นม",
    sleep: "ชม. นอน",
    diapers: "ผ้าอ้อม",
    expressed: "นมแม่ที่ปั๊มออก",
    legend: "รอยตัด = ย่อความสูง ให้ดูระยะเวลาจริงจากป้ายกำกับ",
  },
  vi: {
    discardTitle: "Bỏ các thay đổi chưa lưu?",
    discardDetail:
      "Các thay đổi này chưa được lưu. Không thể khôi phục sau khi bỏ.",
    keepEditing: "Tiếp tục chỉnh sửa",
    discard: "Bỏ thay đổi",
    milk: "mL sữa",
    sleep: "giờ ngủ",
    diapers: "tã",
    expressed: "Sữa mẹ đã vắt",
    legend: "Dấu ngắt = chiều cao rút ngắn; xem thời lượng trên nhãn.",
  },
};
const keyByEnglish = new Map<string, TextKey>(
  Object.entries(uiReviewEnglish).map(([key, value]) => [
    value,
    key as TextKey,
  ]),
);
export function uiReviewEnglishOverride(
  locale: SupportedLocale,
  template: string,
): string | undefined {
  if (locale === "en" || locale === "zh-Hans") return undefined;
  const key = keyByEnglish.get(template);
  return key ? translations[locale][key] : undefined;
}
