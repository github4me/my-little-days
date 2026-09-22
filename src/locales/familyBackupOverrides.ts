import type { SupportedLocale } from "../locales";

// Keep the member-export policy translated even before generated catalogs refresh.
export const familyBackupEnglish = {
  save: "Save a family backup",
  download: "Download and export family backup",
  contents:
    "Every active family member can download the latest confirmed server data: baby profile, all records, photo, shared reminders and play data. The JSON file is unencrypted and contains private family information; store it privately.",
  limits:
    "Downloads exclude pending local edits and unresolved conflicts, and do not change shared data. Family files are for backup or personal analysis; importing or restoring them is not supported.",
  access: "Connect and refresh family access before downloading a backup.",
  finished: "Sharing finished. Check that the file was saved.",
  care: "Download confirmed family care records in More → Backup and restore. Multiple sessions per day are supported; records do not replace medical assessment.",
  sharing:
    "Language, theme, view preferences, notification permissions and this phone’s notification opt-in are not shared. Family records are stored on the server; local cache and pending changes are not a backup and are not copied into personal offline records. Every member can download and export confirmed server data, but cannot restore a file into the shared family.",
  os: "iOS system backups exclude the app’s SQLite directory, including personal records, family cache and pending changes. Personal records can be exported manually; active family members can download confirmed server records. This exclusion does not cover files you save or share outside the app.",
  policy:
    "Personal backups can be imported; family data is download-only, with no file restore. Exports are unencrypted; a cloud destination uses your chosen service. Signing out, member removal, or family/account deletion cannot recall saved or shared copies; manage those files yourself. Uninstalling does not delete server records or your account; use My account to request account deletion.",
} as const;

type BackupText = keyof typeof familyBackupEnglish;
type TranslatedLocale = Exclude<SupportedLocale, "en" | "zh-Hans">;

const translations: Record<TranslatedLocale, Record<BackupText, string>> = {
  "zh-Hant": {
    save: "儲存家庭記錄備份",
    download: "下載並匯出家庭備份",
    contents:
      "每位目前家庭成員都可下載伺服器已確認的最新資料，包括寶寶檔案、全部記錄、照片、共享提醒和早教資料。JSON 檔案未加密，含家庭私人資訊，請妥善保存。",
    limits:
      "下載不包含本機待同步修改或未解決的衝突，也不會改動共享資料。家庭檔案僅供備份或個人分析，暫不支援匯入或還原。",
    access: "請先連線並重新整理家庭存取權限，才能下載備份。",
    finished: "分享操作已結束，請確認檔案已儲存。",
    care: "已同步的家庭照護記錄可在「我的 → 備份與還原」下載。每天可記多次，記錄不替代醫療評估。",
    sharing:
      "語言、主題、檢視偏好、通知權限及這台手機的通知啟用狀態不會共享。家庭記錄儲存在伺服器；本機快取和待同步修改不等於備份，也不會寫回個人離線記錄。每位成員可下載並匯出伺服器已確認的資料，但不能從檔案還原至共享家庭。",
    os: "iOS 系統備份不包含應用程式的 SQLite 資料目錄，包括個人記錄、家庭快取和待同步修改。個人記錄可手動匯出，目前家庭成員可下載伺服器已確認的記錄。此排除規則不涵蓋你在應用程式外儲存或分享的檔案。",
    policy:
      "個人備份支援匯入；家庭資料僅可下載，暫不支援從檔案還原。匯出檔案未加密；選擇雲端儲存位置時，由你選擇的服務處理檔案。登出、移除成員、刪除家庭或帳戶不會撤回已儲存或分享的副本，請自行管理這些檔案。解除安裝不會刪除伺服器記錄或帳戶；刪除帳戶請使用「我的帳戶」中的相應流程。",
  },
  fr: {
    save: "Enregistrer une sauvegarde familiale",
    download: "Télécharger et exporter la sauvegarde familiale",
    contents:
      "Chaque membre actif peut télécharger les dernières données confirmées par le serveur : profil du bébé, tous les enregistrements, photo, rappels partagés et activités de jeu. Le fichier JSON n’est pas chiffré et contient des informations familiales privées ; conservez-le en lieu sûr.",
    limits:
      "Le téléchargement exclut les modifications locales en attente et les conflits non résolus, et ne modifie pas les données partagées. Les fichiers familiaux servent à la sauvegarde ou à l’analyse personnelle ; leur importation et leur restauration ne sont pas prises en charge.",
    access:
      "Connectez-vous et actualisez l’accès à la famille avant de télécharger une sauvegarde.",
    finished:
      "Le partage est terminé. Vérifiez que le fichier a été enregistré.",
    care: "Téléchargez les soins familiaux confirmés dans Plus → Sauvegarde et restauration. Plusieurs séances par jour sont possibles ; ces données ne remplacent pas une évaluation médicale.",
    sharing:
      "La langue, le thème, les préférences d’affichage, les autorisations et l’activation des notifications sur ce téléphone ne sont pas partagés. Les données familiales sont stockées sur le serveur ; le cache local et les modifications en attente ne constituent pas une sauvegarde et ne sont pas copiés dans les données personnelles hors ligne. Chaque membre peut télécharger et exporter les données confirmées, mais pas restaurer un fichier dans la famille partagée.",
    os: "Les sauvegardes système iOS excluent le dossier SQLite de l’app, y compris les données personnelles, le cache familial et les modifications en attente. Les données personnelles peuvent être exportées manuellement ; les membres actifs peuvent télécharger les données familiales confirmées. Cette exclusion ne couvre pas les fichiers enregistrés ou partagés hors de l’app.",
    policy:
      "Les sauvegardes personnelles peuvent être importées ; les données familiales peuvent seulement être téléchargées, sans restauration de fichier. Les exports ne sont pas chiffrés ; une destination cloud utilise le service de votre choix. La déconnexion, le retrait d’un membre ou la suppression de la famille ou du compte ne peuvent pas rappeler les copies enregistrées ou partagées ; gérez vous-même ces fichiers. Désinstaller l’app ne supprime ni les données du serveur ni votre compte ; demandez la suppression dans Mon compte.",
  },
  de: {
    save: "Familiensicherung speichern",
    download: "Familiensicherung herunterladen und exportieren",
    contents:
      "Jedes aktive Familienmitglied kann die neuesten vom Server bestätigten Daten herunterladen: Babyprofil, alle Einträge, Foto, gemeinsame Erinnerungen und Spieldaten. Die JSON-Datei ist unverschlüsselt und enthält private Familiendaten; bewahre sie geschützt auf.",
    limits:
      "Downloads enthalten keine ausstehenden lokalen Änderungen oder ungelösten Konflikte und ändern keine gemeinsamen Daten. Familiendateien dienen der Sicherung oder persönlichen Auswertung; Import und Wiederherstellung werden nicht unterstützt.",
    access:
      "Stelle eine Verbindung her und aktualisiere den Familienzugriff, bevor du eine Sicherung herunterlädst.",
    finished: "Teilen beendet. Prüfe, ob die Datei gespeichert wurde.",
    care: "Bestätigte familiäre Pflegeeinträge kannst du unter Mehr → Sicherung und Wiederherstellung herunterladen. Mehrere Einträge pro Tag sind möglich; sie ersetzen keine medizinische Beurteilung.",
    sharing:
      "Sprache, Design, Ansichtseinstellungen, Benachrichtigungsberechtigungen und die Benachrichtigungsaktivierung dieses Telefons werden nicht geteilt. Familiendaten liegen auf dem Server; lokaler Cache und ausstehende Änderungen sind keine Sicherung und werden nicht in persönliche Offline-Einträge kopiert. Jedes Mitglied kann bestätigte Serverdaten herunterladen und exportieren, aber keine Datei in der gemeinsamen Familie wiederherstellen.",
    os: "iOS-Systemsicherungen schließen das SQLite-Verzeichnis der App aus, einschließlich persönlicher Einträge, Familiencache und ausstehender Änderungen. Persönliche Einträge können manuell exportiert werden; aktive Familienmitglieder können bestätigte Serverdaten herunterladen. Dieser Ausschluss gilt nicht für Dateien, die du außerhalb der App speicherst oder teilst.",
    policy:
      "Persönliche Sicherungen lassen sich importieren; Familiendaten können nur heruntergeladen, nicht aus einer Datei wiederhergestellt werden. Exporte sind unverschlüsselt; bei einem Cloud-Ziel wird dein gewählter Dienst verwendet. Abmelden, Entfernen eines Mitglieds oder Löschen der Familie oder des Kontos ruft gespeicherte oder geteilte Kopien nicht zurück; verwalte diese Dateien selbst. Eine Deinstallation löscht keine Serverdaten und kein Konto; beantrage die Kontolöschung unter Mein Konto.",
  },
  hi: {
    save: "परिवार का बैकअप सहेजें",
    download: "परिवार का बैकअप डाउनलोड और एक्सपोर्ट करें",
    contents:
      "परिवार का हर सक्रिय सदस्य सर्वर पर पुष्टि किए गए नवीनतम डेटा को डाउनलोड कर सकता है: बच्चे की प्रोफ़ाइल, सभी रिकॉर्ड, फ़ोटो, साझा रिमाइंडर और खेल का डेटा। JSON फ़ाइल एन्क्रिप्ट नहीं होती और उसमें परिवार की निजी जानकारी होती है; इसे सुरक्षित रखें।",
    limits:
      "डाउनलोड में लंबित स्थानीय बदलाव और अनसुलझे टकराव शामिल नहीं होते, और इससे साझा डेटा नहीं बदलता। पारिवारिक फ़ाइलें बैकअप या व्यक्तिगत विश्लेषण के लिए हैं; इन्हें इम्पोर्ट या पुनर्स्थापित करना समर्थित नहीं है।",
    access:
      "बैकअप डाउनलोड करने से पहले इंटरनेट से जुड़ें और परिवार की पहुँच रीफ़्रेश करें।",
    finished:
      "साझा करने की प्रक्रिया समाप्त हुई। जाँच लें कि फ़ाइल सहेजी गई है।",
    care: "पुष्टि किए गए पारिवारिक देखभाल रिकॉर्ड अधिक → बैकअप और पुनर्स्थापना में डाउनलोड करें। एक दिन में कई रिकॉर्ड रख सकते हैं; ये चिकित्सकीय मूल्यांकन का विकल्प नहीं हैं।",
    sharing:
      "भाषा, थीम, दृश्य प्राथमिकताएँ, नोटिफ़िकेशन अनुमतियाँ और इस फ़ोन पर नोटिफ़िकेशन चालू करने की पसंद साझा नहीं होतीं। परिवार के रिकॉर्ड सर्वर पर रहते हैं; स्थानीय कैश और लंबित बदलाव बैकअप नहीं हैं और व्यक्तिगत ऑफ़लाइन रिकॉर्ड में कॉपी नहीं होते। हर सदस्य पुष्टि किए गए सर्वर डेटा को डाउनलोड और एक्सपोर्ट कर सकता है, लेकिन किसी फ़ाइल को साझा परिवार में पुनर्स्थापित नहीं कर सकता।",
    os: "iOS सिस्टम बैकअप में ऐप की SQLite डायरेक्टरी शामिल नहीं होती, जिसमें व्यक्तिगत रिकॉर्ड, परिवार का कैश और लंबित बदलाव होते हैं। व्यक्तिगत रिकॉर्ड मैन्युअल रूप से एक्सपोर्ट किए जा सकते हैं; परिवार के सक्रिय सदस्य पुष्टि किए गए सर्वर रिकॉर्ड डाउनलोड कर सकते हैं। यह अपवर्जन ऐप के बाहर सहेजी या साझा की गई फ़ाइलों पर लागू नहीं होता।",
    policy:
      "व्यक्तिगत बैकअप इम्पोर्ट किए जा सकते हैं; पारिवारिक डेटा केवल डाउनलोड किया जा सकता है, फ़ाइल से पुनर्स्थापित नहीं। एक्सपोर्ट एन्क्रिप्ट नहीं होते; क्लाउड में सहेजने पर आपकी चुनी सेवा इस्तेमाल होती है। साइन आउट, सदस्य हटाने या परिवार/खाता मिटाने से सहेजी या साझा की गई प्रतियाँ वापस नहीं ली जा सकतीं; उन फ़ाइलों का प्रबंधन स्वयं करें। ऐप हटाने से सर्वर रिकॉर्ड या खाता नहीं मिटता; खाता मिटाने का अनुरोध मेरा खाता में करें।",
  },
  it: {
    save: "Salva un backup familiare",
    download: "Scarica ed esporta il backup familiare",
    contents:
      "Ogni membro attivo può scaricare gli ultimi dati confermati dal server: profilo del bambino, tutti i registri, foto, promemoria condivisi e dati di gioco. Il file JSON non è crittografato e contiene informazioni familiari private; conservalo in modo sicuro.",
    limits:
      "Il download esclude le modifiche locali in attesa e i conflitti irrisolti e non modifica i dati condivisi. I file familiari servono per backup o analisi personali; importazione e ripristino non sono supportati.",
    access:
      "Connettiti e aggiorna l’accesso alla famiglia prima di scaricare un backup.",
    finished: "Condivisione terminata. Verifica che il file sia stato salvato.",
    care: "Scarica i registri di cura familiari confermati in Altro → Backup e ripristino. Sono possibili più registrazioni al giorno; non sostituiscono una valutazione medica.",
    sharing:
      "Lingua, tema, preferenze di visualizzazione, autorizzazioni e attivazione delle notifiche su questo telefono non sono condivisi. I registri familiari sono sul server; la cache locale e le modifiche in attesa non sono un backup e non vengono copiate nei registri personali offline. Ogni membro può scaricare ed esportare i dati confermati dal server, ma non ripristinare un file nella famiglia condivisa.",
    os: "I backup di sistema iOS escludono la cartella SQLite dell’app, inclusi registri personali, cache familiare e modifiche in attesa. I registri personali possono essere esportati manualmente; i membri attivi possono scaricare i registri confermati dal server. Questa esclusione non riguarda i file salvati o condivisi fuori dall’app.",
    policy:
      "I backup personali possono essere importati; i dati familiari possono solo essere scaricati, senza ripristino da file. Le esportazioni non sono crittografate; una destinazione cloud usa il servizio scelto. Uscire dall’account, rimuovere un membro o eliminare la famiglia o l’account non ritira le copie salvate o condivise; gestisci tu questi file. Disinstallare non elimina i registri del server o l’account; richiedi l’eliminazione in Il mio account.",
  },
  ja: {
    save: "ファミリーバックアップを保存",
    download: "ファミリーバックアップをダウンロード・書き出し",
    contents:
      "現在のファミリーメンバーは全員、サーバーで確定した最新データをダウンロードできます。赤ちゃんのプロフィール、全記録、写真、共有リマインダー、あそびのデータが含まれます。JSON ファイルは暗号化されず、家族の個人情報を含むため、安全に保管してください。",
    limits:
      "ダウンロードには未同期の端末内の変更や未解決の競合は含まれず、共有データも変更されません。ファミリーファイルは保管や個人的な分析用で、読み込みや復元には対応していません。",
    access:
      "バックアップをダウンロードする前に、ネットに接続してファミリーへのアクセスを更新してください。",
    finished:
      "共有操作が終了しました。ファイルが保存されたか確認してください。",
    care: "確定済みのファミリーのお世話記録は「その他 → バックアップと復元」からダウンロードできます。1日に複数回記録できますが、医療評価の代わりにはなりません。",
    sharing:
      "言語、テーマ、表示設定、通知の許可、この端末での通知の有効化状態は共有されません。ファミリーの記録はサーバーに保存されます。端末内のキャッシュや未同期の変更はバックアップではなく、個人のオフライン記録にもコピーされません。全メンバーが確定済みデータをダウンロード・書き出しできますが、共有ファミリーにファイルから復元することはできません。",
    os: "iOS のシステムバックアップには、個人記録、ファミリーのキャッシュ、未同期の変更を含むアプリの SQLite フォルダーは含まれません。個人記録は手動で書き出せ、現在のファミリーメンバーはサーバーで確定した記録をダウンロードできます。この除外は、アプリ外に保存・共有したファイルには適用されません。",
    policy:
      "個人バックアップは読み込めます。ファミリーデータはダウンロード専用で、ファイルからの復元には対応していません。書き出しファイルは暗号化されず、クラウドに保存する場合は選択したサービスで処理されます。サインアウト、メンバーの削除、ファミリーやアカウントの削除で、保存・共有済みのコピーを回収することはできません。ご自身で管理してください。アンインストールしてもサーバーの記録やアカウントは削除されません。アカウントの削除は「マイアカウント」から申請してください。",
  },
  ko: {
    save: "가족 백업 저장",
    download: "가족 백업 다운로드 및 내보내기",
    contents:
      "현재 가족 구성원은 누구나 서버에서 확인된 최신 데이터를 다운로드할 수 있습니다. 아기 프로필, 모든 기록, 사진, 공유 알림, 놀이 데이터가 포함됩니다. JSON 파일은 암호화되지 않으며 가족의 개인 정보를 포함하므로 안전하게 보관하세요.",
    limits:
      "다운로드에는 동기화 대기 중인 로컬 수정이나 해결되지 않은 충돌이 포함되지 않으며 공유 데이터를 변경하지 않습니다. 가족 파일은 백업 또는 개인 분석용이며 가져오기나 복원은 지원하지 않습니다.",
    access:
      "백업을 다운로드하기 전에 인터넷에 연결하고 가족 접근 권한을 새로고침하세요.",
    finished: "공유가 종료되었습니다. 파일이 저장되었는지 확인하세요.",
    care: "확인된 가족 돌봄 기록은 더 보기 → 백업 및 복원에서 다운로드할 수 있습니다. 하루에 여러 번 기록할 수 있으며 의료 평가를 대신하지 않습니다.",
    sharing:
      "언어, 테마, 보기 설정, 알림 권한 및 이 휴대폰의 알림 활성화 상태는 공유되지 않습니다. 가족 기록은 서버에 저장됩니다. 로컬 캐시와 동기화 대기 중인 변경은 백업이 아니며 개인 오프라인 기록으로 복사되지 않습니다. 모든 구성원은 서버에서 확인된 데이터를 다운로드하고 내보낼 수 있지만 공유 가족에 파일을 복원할 수는 없습니다.",
    os: "iOS 시스템 백업에는 개인 기록, 가족 캐시, 동기화 대기 중인 변경이 있는 앱의 SQLite 폴더가 포함되지 않습니다. 개인 기록은 수동으로 내보낼 수 있으며 현재 가족 구성원은 서버에서 확인된 기록을 다운로드할 수 있습니다. 이 제외 규칙은 앱 외부에 저장하거나 공유한 파일에는 적용되지 않습니다.",
    policy:
      "개인 백업은 가져올 수 있지만 가족 데이터는 다운로드만 가능하며 파일 복원은 지원하지 않습니다. 내보낸 파일은 암호화되지 않으며 클라우드에 저장하면 선택한 서비스가 파일을 처리합니다. 로그아웃, 구성원 제거, 가족 또는 계정 삭제로 이미 저장하거나 공유한 사본을 회수할 수 없으므로 직접 관리하세요. 앱을 삭제해도 서버 기록이나 계정은 삭제되지 않습니다. 내 계정에서 계정 삭제를 요청하세요.",
  },
  es: {
    save: "Guardar una copia de seguridad familiar",
    download: "Descargar y exportar la copia de seguridad familiar",
    contents:
      "Cada miembro activo puede descargar los últimos datos confirmados por el servidor: perfil del bebé, todos los registros, foto, recordatorios compartidos y datos de juego. El archivo JSON no está cifrado y contiene información familiar privada; guárdalo de forma segura.",
    limits:
      "La descarga excluye los cambios locales pendientes y los conflictos sin resolver, y no modifica los datos compartidos. Los archivos familiares sirven para copias de seguridad o análisis personales; no se admite importarlos ni restaurarlos.",
    access:
      "Conéctate y actualiza el acceso a la familia antes de descargar una copia de seguridad.",
    finished:
      "El proceso de compartir ha terminado. Comprueba que el archivo se haya guardado.",
    care: "Descarga los cuidados familiares confirmados en Más → Copia de seguridad y restauración. Puedes registrar varias sesiones al día; los registros no sustituyen una evaluación médica.",
    sharing:
      "El idioma, el tema, las preferencias de vista, los permisos y la activación de notificaciones de este teléfono no se comparten. Los registros familiares se guardan en el servidor; la caché local y los cambios pendientes no son una copia de seguridad ni se copian a los registros personales sin conexión. Cada miembro puede descargar y exportar los datos confirmados, pero no restaurar un archivo en la familia compartida.",
    os: "Las copias del sistema iOS excluyen la carpeta SQLite de la app, incluidos los registros personales, la caché familiar y los cambios pendientes. Los registros personales se pueden exportar manualmente; los miembros activos pueden descargar los registros confirmados del servidor. Esta exclusión no cubre los archivos que guardes o compartas fuera de la app.",
    policy:
      "Se pueden importar copias personales; los datos familiares solo se descargan y no se restauran desde archivos. Las exportaciones no están cifradas; un destino en la nube usa el servicio que elijas. Cerrar sesión, retirar a un miembro o eliminar la familia o la cuenta no permite recuperar las copias guardadas o compartidas; gestiona esos archivos tú mismo. Desinstalar no elimina los registros del servidor ni tu cuenta; solicita eliminarla en Mi cuenta.",
  },
  th: {
    save: "บันทึกข้อมูลสำรองของครอบครัว",
    download: "ดาวน์โหลดและส่งออกข้อมูลสำรองของครอบครัว",
    contents:
      "สมาชิกปัจจุบันทุกคนดาวน์โหลดข้อมูลล่าสุดที่เซิร์ฟเวอร์ยืนยันแล้วได้ ได้แก่ โปรไฟล์เด็ก บันทึกทั้งหมด รูปภาพ การเตือนที่แชร์ และข้อมูลการเล่น ไฟล์ JSON ไม่ได้เข้ารหัสและมีข้อมูลส่วนตัวของครอบครัว โปรดเก็บรักษาอย่างปลอดภัย",
    limits:
      "ข้อมูลที่ดาวน์โหลดไม่รวมการแก้ไขในเครื่องที่รอซิงค์และข้อขัดแย้งที่ยังไม่แก้ไข และไม่เปลี่ยนข้อมูลที่แชร์ ไฟล์ครอบครัวใช้สำหรับสำรองหรือวิเคราะห์ส่วนตัว ยังไม่รองรับการนำเข้าหรือกู้คืนจากไฟล์",
    access:
      "เชื่อมต่ออินเทอร์เน็ตและรีเฟรชสิทธิ์เข้าถึงครอบครัวก่อนดาวน์โหลดข้อมูลสำรอง",
    finished: "การแชร์สิ้นสุดแล้ว โปรดตรวจสอบว่าได้บันทึกไฟล์แล้ว",
    care: "ดาวน์โหลดบันทึกการดูแลของครอบครัวที่ยืนยันแล้วได้ที่ เพิ่มเติม → สำรองและกู้คืนข้อมูล บันทึกได้หลายครั้งต่อวัน แต่ไม่ใช้แทนการประเมินทางการแพทย์",
    sharing:
      "ภาษา ธีม การตั้งค่ามุมมอง สิทธิ์แจ้งเตือน และการเปิดแจ้งเตือนบนโทรศัพท์เครื่องนี้จะไม่แชร์ บันทึกครอบครัวเก็บบนเซิร์ฟเวอร์ แคชในเครื่องและการแก้ไขที่รอซิงค์ไม่ใช่ข้อมูลสำรองและไม่คัดลอกไปยังบันทึกส่วนตัวออฟไลน์ สมาชิกทุกคนดาวน์โหลดและส่งออกข้อมูลที่เซิร์ฟเวอร์ยืนยันแล้วได้ แต่กู้คืนไฟล์เข้าครอบครัวที่แชร์ไม่ได้",
    os: "ข้อมูลสำรองของระบบ iOS ไม่รวมโฟลเดอร์ SQLite ของแอป ซึ่งมีบันทึกส่วนตัว แคชครอบครัว และการแก้ไขที่รอซิงค์ คุณส่งออกบันทึกส่วนตัวเองได้ และสมาชิกปัจจุบันดาวน์โหลดบันทึกที่เซิร์ฟเวอร์ยืนยันแล้วได้ การยกเว้นนี้ไม่ครอบคลุมไฟล์ที่คุณบันทึกหรือแชร์นอกแอป",
    policy:
      "นำเข้าข้อมูลสำรองส่วนตัวได้ แต่ข้อมูลครอบครัวดาวน์โหลดได้เท่านั้นและยังกู้คืนจากไฟล์ไม่ได้ ไฟล์ส่งออกไม่ได้เข้ารหัส หากบันทึกบนคลาวด์จะใช้บริการที่คุณเลือก การออกจากระบบ นำสมาชิกออก หรือลบครอบครัวหรือบัญชี ไม่สามารถเรียกคืนสำเนาที่บันทึกหรือแชร์ไปแล้วได้ โปรดจัดการไฟล์เหล่านั้นเอง การถอนการติดตั้งไม่ลบบันทึกบนเซิร์ฟเวอร์หรือบัญชี ให้ขอลบบัญชีผ่าน บัญชีของฉัน",
  },
  vi: {
    save: "Lưu bản sao lưu gia đình",
    download: "Tải xuống và xuất bản sao lưu gia đình",
    contents:
      "Mỗi thành viên hiện tại đều có thể tải dữ liệu mới nhất đã được máy chủ xác nhận: hồ sơ bé, toàn bộ bản ghi, ảnh, lời nhắc chung và dữ liệu hoạt động chơi. Tệp JSON không được mã hóa và chứa thông tin riêng tư của gia đình; hãy lưu giữ an toàn.",
    limits:
      "Bản tải xuống không gồm thay đổi cục bộ đang chờ đồng bộ hoặc xung đột chưa giải quyết và không thay đổi dữ liệu chung. Tệp gia đình dùng để sao lưu hoặc phân tích cá nhân; chưa hỗ trợ nhập hay khôi phục từ tệp.",
    access:
      "Kết nối mạng và làm mới quyền truy cập gia đình trước khi tải bản sao lưu.",
    finished: "Đã kết thúc chia sẻ. Hãy kiểm tra xem tệp đã được lưu chưa.",
    care: "Tải các bản ghi chăm sóc gia đình đã xác nhận tại Thêm → Sao lưu và khôi phục. Có thể ghi nhiều lần mỗi ngày; bản ghi không thay thế đánh giá y tế.",
    sharing:
      "Ngôn ngữ, giao diện, tùy chọn hiển thị, quyền thông báo và trạng thái bật thông báo trên điện thoại này không được chia sẻ. Bản ghi gia đình được lưu trên máy chủ; bộ nhớ đệm cục bộ và thay đổi chờ đồng bộ không phải bản sao lưu và không được chép vào bản ghi cá nhân ngoại tuyến. Mỗi thành viên có thể tải xuống và xuất dữ liệu đã xác nhận, nhưng không thể khôi phục tệp vào gia đình dùng chung.",
    os: "Bản sao lưu hệ thống iOS không chứa thư mục SQLite của ứng dụng, gồm bản ghi cá nhân, bộ nhớ đệm gia đình và thay đổi chờ đồng bộ. Có thể xuất bản ghi cá nhân thủ công; thành viên hiện tại có thể tải bản ghi đã được máy chủ xác nhận. Việc loại trừ này không áp dụng cho các tệp bạn lưu hoặc chia sẻ bên ngoài ứng dụng.",
    policy:
      "Có thể nhập bản sao lưu cá nhân; dữ liệu gia đình chỉ được tải xuống, chưa hỗ trợ khôi phục từ tệp. Tệp xuất không được mã hóa; khi lưu lên đám mây, dịch vụ bạn chọn sẽ xử lý tệp. Đăng xuất, xóa thành viên, gia đình hoặc tài khoản không thu hồi được các bản sao đã lưu hay chia sẻ; bạn cần tự quản lý các tệp đó. Gỡ ứng dụng không xóa bản ghi trên máy chủ hay tài khoản; hãy yêu cầu xóa tài khoản trong Tài khoản của tôi.",
  },
};

const keyByEnglish = new Map<string, BackupText>(
  Object.entries(familyBackupEnglish).map(([key, value]) => [
    value,
    key as BackupText,
  ]),
);

export function familyBackupEnglishOverride(
  locale: SupportedLocale,
  template: string,
): string | undefined {
  if (locale === "en" || locale === "zh-Hans") return undefined;
  const key = keyByEnglish.get(template);
  return key ? translations[locale][key] : undefined;
}
