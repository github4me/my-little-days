import type { SupportedLocale } from "../locales";

export type ConflictMessageKey =
  | "title"
  | "explanation"
  | "familyVersion"
  | "yourChange"
  | "changedBy"
  | "feed"
  | "sleep"
  | "start"
  | "end"
  | "ongoing"
  | "amount"
  | "notes"
  | "noteChanged"
  | "keep"
  | "replace"
  | "later"
  | "review"
  | "savedPending"
  | "unavailable"
  | "changedAgain"
  | "replacementAudit"
  | "previousVersion"
  | "currentVersion"
  | "unknownMember";

type Messages = Record<ConflictMessageKey, string>;

const catalogs: Record<SupportedLocale, Messages> = {
  en: {
    title: "Review conflicting change",
    explanation:
      "This record changed before your save. Compare both versions, then keep the family version or replace it with your change.",
    familyVersion: "Current family version",
    yourChange: "Your change",
    changedBy: "Changed by {name}",
    feed: "Feed",
    sleep: "Sleep",
    start: "Start",
    end: "End",
    ongoing: "Ongoing",
    amount: "Amount",
    notes: "Notes",
    noteChanged: "Notes also changed",
    keep: "Keep family version · discard mine",
    replace: "Replace with my change",
    later: "Decide later",
    review: "Review conflict",
    savedPending:
      "Replacement saved on this device. The family record and charts update only after the server confirms it.",
    unavailable:
      "This conflict can no longer be replaced. Refresh and review the latest family record.",
    changedAgain:
      "The family record changed again. Review the new version before replacing it.",
    replacementAudit: "{replacer} replaced {previous}'s version · {date}",
    previousVersion: "Previous: {detail}",
    currentVersion: "Now: {detail}",
    unknownMember: "Former family member",
  },
  "zh-Hans": {
    title: "检查冲突修改",
    explanation:
      "你保存前，这条家庭记录已被修改。请比较两个版本，再选择保留家庭版本或用你的修改替换。",
    familyVersion: "当前家庭版本",
    yourChange: "你的修改",
    changedBy: "修改人：{name}",
    feed: "喂奶",
    sleep: "睡眠",
    start: "开始",
    end: "结束",
    ongoing: "进行中",
    amount: "奶量",
    notes: "备注",
    noteChanged: "备注也有变化",
    keep: "保留家庭版本 · 放弃我的修改",
    replace: "用我的修改替换",
    later: "稍后决定",
    review: "检查冲突",
    savedPending:
      "替换已保存在此设备；服务器确认后，家庭记录和柱状图才会更新。",
    unavailable: "这个冲突已不能替换。请刷新并检查最新家庭记录。",
    changedAgain: "家庭记录又有变化。请先检查新版本，再决定是否替换。",
    replacementAudit: "{replacer} 已替换 {previous} 的版本 · {date}",
    previousVersion: "替换前：{detail}",
    currentVersion: "当前：{detail}",
    unknownMember: "曾加入的家庭成员",
  },
  "zh-Hant": {
    title: "檢查衝突修改",
    explanation:
      "你儲存前，這筆家庭記錄已被修改。請比較兩個版本，再選擇保留家庭版本或用你的修改取代。",
    familyVersion: "目前家庭版本",
    yourChange: "你的修改",
    changedBy: "修改者：{name}",
    feed: "餵奶",
    sleep: "睡眠",
    start: "開始",
    end: "結束",
    ongoing: "進行中",
    amount: "奶量",
    notes: "備註",
    noteChanged: "備註也有變更",
    keep: "保留家庭版本 · 放棄我的修改",
    replace: "用我的修改取代",
    later: "稍後決定",
    review: "檢查衝突",
    savedPending:
      "取代內容已儲存在此裝置；伺服器確認後，家庭記錄與長條圖才會更新。",
    unavailable: "此衝突已無法取代。請重新整理並檢查最新家庭記錄。",
    changedAgain: "家庭記錄再次變更。請先檢查新版本，再決定是否取代。",
    replacementAudit: "{replacer} 已取代 {previous} 的版本 · {date}",
    previousVersion: "取代前：{detail}",
    currentVersion: "目前：{detail}",
    unknownMember: "曾加入的家庭成員",
  },
  fr: {
    title: "Vérifier la modification en conflit",
    explanation:
      "Cette fiche a changé avant votre enregistrement. Comparez les deux versions, puis conservez celle de la famille ou remplacez-la par la vôtre.",
    familyVersion: "Version familiale actuelle",
    yourChange: "Votre modification",
    changedBy: "Modifiée par {name}",
    feed: "Repas",
    sleep: "Sommeil",
    start: "Début",
    end: "Fin",
    ongoing: "En cours",
    amount: "Quantité",
    notes: "Notes",
    noteChanged: "Les notes ont aussi changé",
    keep: "Garder la version familiale · abandonner la mienne",
    replace: "Remplacer par ma modification",
    later: "Décider plus tard",
    review: "Vérifier le conflit",
    savedPending:
      "Le remplacement est enregistré sur cet appareil. La fiche et les graphiques seront mis à jour après confirmation du serveur.",
    unavailable:
      "Ce conflit ne peut plus être remplacé. Actualisez et vérifiez la dernière fiche familiale.",
    changedAgain:
      "La fiche familiale a encore changé. Vérifiez la nouvelle version avant de la remplacer.",
    replacementAudit: "{replacer} a remplacé la version de {previous} · {date}",
    previousVersion: "Avant : {detail}",
    currentVersion: "Maintenant : {detail}",
    unknownMember: "Ancien membre de la famille",
  },
  de: {
    title: "Konflikt prüfen",
    explanation:
      "Dieser Eintrag wurde vor dem Speichern geändert. Vergleiche beide Versionen und behalte die Familienversion oder ersetze sie durch deine Änderung.",
    familyVersion: "Aktuelle Familienversion",
    yourChange: "Deine Änderung",
    changedBy: "Geändert von {name}",
    feed: "Füttern",
    sleep: "Schlaf",
    start: "Beginn",
    end: "Ende",
    ongoing: "Läuft",
    amount: "Menge",
    notes: "Notizen",
    noteChanged: "Notizen wurden ebenfalls geändert",
    keep: "Familienversion behalten · meine verwerfen",
    replace: "Durch meine Änderung ersetzen",
    later: "Später entscheiden",
    review: "Konflikt prüfen",
    savedPending:
      "Der Ersatz ist auf diesem Gerät gespeichert. Eintrag und Diagramme werden erst nach Serverbestätigung aktualisiert.",
    unavailable:
      "Dieser Konflikt kann nicht mehr ersetzt werden. Aktualisiere und prüfe den neuesten Familieneintrag.",
    changedAgain:
      "Der Familieneintrag wurde erneut geändert. Prüfe die neue Version vor dem Ersetzen.",
    replacementAudit:
      "{replacer} hat die Version von {previous} ersetzt · {date}",
    previousVersion: "Vorher: {detail}",
    currentVersion: "Jetzt: {detail}",
    unknownMember: "Ehemaliges Familienmitglied",
  },
  hi: {
    title: "टकराव वाला बदलाव जाँचें",
    explanation:
      "आपके सहेजने से पहले यह रिकॉर्ड बदल गया था। दोनों संस्करणों की तुलना करें, फिर परिवार वाला रखें या अपने बदलाव से बदलें।",
    familyVersion: "मौजूदा परिवार संस्करण",
    yourChange: "आपका बदलाव",
    changedBy: "{name} ने बदला",
    feed: "दूध",
    sleep: "नींद",
    start: "शुरू",
    end: "समाप्त",
    ongoing: "जारी",
    amount: "मात्रा",
    notes: "नोट्स",
    noteChanged: "नोट्स भी बदले हैं",
    keep: "परिवार संस्करण रखें · मेरा छोड़ें",
    replace: "मेरे बदलाव से बदलें",
    later: "बाद में तय करें",
    review: "टकराव जाँचें",
    savedPending:
      "बदलाव इस डिवाइस पर सहेजा गया है। सर्वर की पुष्टि के बाद ही रिकॉर्ड और चार्ट अपडेट होंगे।",
    unavailable:
      "इस टकराव को अब बदला नहीं जा सकता। रीफ़्रेश करके नवीनतम परिवार रिकॉर्ड जाँचें।",
    changedAgain:
      "परिवार रिकॉर्ड फिर बदल गया है। बदलने से पहले नया संस्करण जाँचें।",
    replacementAudit: "{replacer} ने {previous} का संस्करण बदला · {date}",
    previousVersion: "पहले: {detail}",
    currentVersion: "अब: {detail}",
    unknownMember: "पूर्व परिवार सदस्य",
  },
  it: {
    title: "Controlla la modifica in conflitto",
    explanation:
      "Questo record è cambiato prima del salvataggio. Confronta le due versioni, poi mantieni quella della famiglia o sostituiscila con la tua.",
    familyVersion: "Versione attuale della famiglia",
    yourChange: "La tua modifica",
    changedBy: "Modificato da {name}",
    feed: "Poppata",
    sleep: "Sonno",
    start: "Inizio",
    end: "Fine",
    ongoing: "In corso",
    amount: "Quantità",
    notes: "Note",
    noteChanged: "Sono cambiate anche le note",
    keep: "Mantieni versione famiglia · scarta la mia",
    replace: "Sostituisci con la mia modifica",
    later: "Decidi più tardi",
    review: "Controlla conflitto",
    savedPending:
      "La sostituzione è salvata su questo dispositivo. Record e grafici si aggiorneranno dopo la conferma del server.",
    unavailable:
      "Questo conflitto non può più essere sostituito. Aggiorna e controlla l'ultimo record della famiglia.",
    changedAgain:
      "Il record della famiglia è cambiato di nuovo. Controlla la nuova versione prima di sostituirla.",
    replacementAudit:
      "{replacer} ha sostituito la versione di {previous} · {date}",
    previousVersion: "Prima: {detail}",
    currentVersion: "Ora: {detail}",
    unknownMember: "Ex membro della famiglia",
  },
  ja: {
    title: "競合する変更を確認",
    explanation:
      "保存前にこの記録が変更されました。両方を比較し、家族の版を残すか、自分の変更で置き換えてください。",
    familyVersion: "現在の家族版",
    yourChange: "自分の変更",
    changedBy: "変更者：{name}",
    feed: "授乳",
    sleep: "睡眠",
    start: "開始",
    end: "終了",
    ongoing: "進行中",
    amount: "量",
    notes: "メモ",
    noteChanged: "メモも変更されています",
    keep: "家族版を残す・自分の変更を破棄",
    replace: "自分の変更で置き換える",
    later: "後で決める",
    review: "競合を確認",
    savedPending:
      "置き換えをこのデバイスに保存しました。サーバー確認後に記録とグラフが更新されます。",
    unavailable:
      "この競合は置き換えできなくなりました。更新して最新の家族記録を確認してください。",
    changedAgain:
      "家族記録が再び変更されました。置き換える前に新しい版を確認してください。",
    replacementAudit: "{replacer} が {previous} の版を置き換えました · {date}",
    previousVersion: "置き換え前：{detail}",
    currentVersion: "現在：{detail}",
    unknownMember: "以前の家族メンバー",
  },
  ko: {
    title: "충돌한 변경사항 확인",
    explanation:
      "저장하기 전에 이 기록이 변경되었습니다. 두 버전을 비교한 뒤 가족 버전을 유지하거나 내 변경사항으로 대체하세요.",
    familyVersion: "현재 가족 버전",
    yourChange: "내 변경사항",
    changedBy: "변경한 사람: {name}",
    feed: "수유",
    sleep: "수면",
    start: "시작",
    end: "종료",
    ongoing: "진행 중",
    amount: "양",
    notes: "메모",
    noteChanged: "메모도 변경됨",
    keep: "가족 버전 유지 · 내 변경 폐기",
    replace: "내 변경사항으로 대체",
    later: "나중에 결정",
    review: "충돌 확인",
    savedPending:
      "대체 내용이 이 기기에 저장되었습니다. 서버 확인 후 기록과 차트가 업데이트됩니다.",
    unavailable:
      "이 충돌은 더 이상 대체할 수 없습니다. 새로 고친 뒤 최신 가족 기록을 확인하세요.",
    changedAgain:
      "가족 기록이 다시 변경되었습니다. 대체하기 전에 새 버전을 확인하세요.",
    replacementAudit: "{replacer} 님이 {previous} 님의 버전을 대체함 · {date}",
    previousVersion: "이전: {detail}",
    currentVersion: "현재: {detail}",
    unknownMember: "이전 가족 구성원",
  },
  es: {
    title: "Revisar cambio en conflicto",
    explanation:
      "Este registro cambió antes de guardarlo. Compara las dos versiones y conserva la familiar o sustitúyela por tu cambio.",
    familyVersion: "Versión familiar actual",
    yourChange: "Tu cambio",
    changedBy: "Modificado por {name}",
    feed: "Toma",
    sleep: "Sueño",
    start: "Inicio",
    end: "Fin",
    ongoing: "En curso",
    amount: "Cantidad",
    notes: "Notas",
    noteChanged: "Las notas también cambiaron",
    keep: "Conservar versión familiar · descartar la mía",
    replace: "Sustituir por mi cambio",
    later: "Decidir más tarde",
    review: "Revisar conflicto",
    savedPending:
      "La sustitución está guardada en este dispositivo. El registro y los gráficos se actualizarán tras la confirmación del servidor.",
    unavailable:
      "Este conflicto ya no se puede sustituir. Actualiza y revisa el último registro familiar.",
    changedAgain:
      "El registro familiar volvió a cambiar. Revisa la nueva versión antes de sustituirla.",
    replacementAudit: "{replacer} sustituyó la versión de {previous} · {date}",
    previousVersion: "Antes: {detail}",
    currentVersion: "Ahora: {detail}",
    unknownMember: "Antiguo miembro de la familia",
  },
  th: {
    title: "ตรวจสอบการแก้ไขที่ขัดแย้ง",
    explanation:
      "มีผู้อื่นแก้ไขบันทึกนี้ก่อนที่คุณจะบันทึก โปรดเปรียบเทียบทั้งสองเวอร์ชัน แล้วเก็บเวอร์ชันครอบครัวหรือแทนที่ด้วยการแก้ไขของคุณ",
    familyVersion: "เวอร์ชันครอบครัวปัจจุบัน",
    yourChange: "การแก้ไขของคุณ",
    changedBy: "แก้ไขโดย {name}",
    feed: "ให้นม",
    sleep: "นอน",
    start: "เริ่ม",
    end: "สิ้นสุด",
    ongoing: "กำลังดำเนินอยู่",
    amount: "ปริมาณ",
    notes: "หมายเหตุ",
    noteChanged: "หมายเหตุก็เปลี่ยนด้วย",
    keep: "เก็บเวอร์ชันครอบครัว · ทิ้งของฉัน",
    replace: "แทนที่ด้วยการแก้ไขของฉัน",
    later: "ตัดสินใจภายหลัง",
    review: "ตรวจสอบข้อขัดแย้ง",
    savedPending:
      "บันทึกการแทนที่ไว้ในอุปกรณ์นี้แล้ว บันทึกและแผนภูมิจะอัปเดตหลังเซิร์ฟเวอร์ยืนยัน",
    unavailable:
      "แทนที่ข้อขัดแย้งนี้ไม่ได้แล้ว โปรดรีเฟรชและตรวจสอบบันทึกครอบครัวล่าสุด",
    changedAgain:
      "บันทึกครอบครัวเปลี่ยนอีกครั้ง โปรดตรวจสอบเวอร์ชันใหม่ก่อนแทนที่",
    replacementAudit: "{replacer} แทนที่เวอร์ชันของ {previous} · {date}",
    previousVersion: "ก่อนหน้า: {detail}",
    currentVersion: "ปัจจุบัน: {detail}",
    unknownMember: "อดีตสมาชิกครอบครัว",
  },
  vi: {
    title: "Xem lại thay đổi xung đột",
    explanation:
      "Bản ghi này đã thay đổi trước khi bạn lưu. Hãy so sánh hai phiên bản, rồi giữ bản gia đình hoặc thay bằng thay đổi của bạn.",
    familyVersion: "Bản gia đình hiện tại",
    yourChange: "Thay đổi của bạn",
    changedBy: "Do {name} sửa",
    feed: "Cho bú",
    sleep: "Giấc ngủ",
    start: "Bắt đầu",
    end: "Kết thúc",
    ongoing: "Đang diễn ra",
    amount: "Lượng",
    notes: "Ghi chú",
    noteChanged: "Ghi chú cũng đã thay đổi",
    keep: "Giữ bản gia đình · bỏ bản của tôi",
    replace: "Thay bằng thay đổi của tôi",
    later: "Quyết định sau",
    review: "Xem lại xung đột",
    savedPending:
      "Bản thay thế đã được lưu trên thiết bị này. Bản ghi và biểu đồ chỉ cập nhật sau khi máy chủ xác nhận.",
    unavailable:
      "Xung đột này không thể thay thế nữa. Hãy làm mới và xem bản ghi gia đình mới nhất.",
    changedAgain:
      "Bản ghi gia đình lại thay đổi. Hãy xem phiên bản mới trước khi thay thế.",
    replacementAudit:
      "{replacer} đã thay thế phiên bản của {previous} · {date}",
    previousVersion: "Trước: {detail}",
    currentVersion: "Hiện tại: {detail}",
    unknownMember: "Thành viên cũ của gia đình",
  },
};

export function conflictMessage(
  locale: SupportedLocale,
  key: ConflictMessageKey,
  values: Record<string, string | number> = {},
) {
  return catalogs[locale][key].replace(/\{([^}]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}
