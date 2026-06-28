import { OfflineDatabase } from './db.js';

const db = new OfflineDatabase();
let map;
let markerLayer = [];
let userLocationMarker = null;
let currentStallsCache = [];

let isGpsMockActive = false;
let watchId = null;
let currentCoords = null; // { lat, lon }
let lastTriggeredStallId = null;
let selectedStallId = null;

const deviceId = getOrCreateDeviceId();
const LANG_STORAGE_KEY = 'uiLanguage';
const SUPPORTED_LANGUAGES = ['vi', 'en', 'ja', 'ko', 'zh'];

function getSavedLanguage() {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
    return saved;
  }
  const browserLang = (navigator.language || navigator.userLanguage || '').substring(0, 2).toLowerCase();
  if (SUPPORTED_LANGUAGES.includes(browserLang)) {
    return browserLang;
  }
  return 'vi';
}

function getTrans(langCode = langPicker?.value) {
  return uiTranslations[langCode] || uiTranslations.vi;
}

function applyDocumentLanguage(lang) {
  document.documentElement.lang = lang;
  document.body.setAttribute('data-lang', lang);
}

function updateI18nElements(lang) {
  const trans = getTrans(lang);
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const value = trans[key];
    if (typeof value === 'string') {
      el.textContent = value;
    }
  });
}

// UI Elements
let serverUrlInput;
let langPicker;
let syncBtn;
let gpsSwitch;
let stallCard;
let stallName;
let stallDistance;
let stallAddress;
let stallDescription;
let stallList;
let chatLog;
let chatInput;
let chatSendBtn;
let syncStatus;
let gpsStatus;
let simWalkBtn;
let stallSearchInput;
let stallSearchType;
let stallSearchBtn;
let showProfileBtn;
let profileModal;
let profileCloseBtn;
let profileUsername;
let profileFullname;
let profileEmail;
let profilePhone;
let profileRole;
let profileUserId;
let profileDevice;
let profileAvatarImg;
let profileAvatarInput;
let profileAvatarUploadBtn;
let profileLogoutBtn;

// HTML5 Audio Elements & States
let audioPlayer;
let playAudioBtn;
let playBtnIcon;
let playBtnText;
let audioStatus;

let viewMenuBtn;
let directionsBtn;
let menuModal;
let menuImagesContainer;
let menuModalMessage;
let menuModalClose;
let currentAudioUrl = '';
let syncInProgress = false;
let syncRetryTimerId = null;

// Walk simulation variables (Vĩnh Khánh street route District 4)
const fallbackSimulatedRoute = [
  { lat: 10.761400, lng: 106.699700 }, // Start near West end
  { lat: 10.761245, lng: 106.700124 }, // Bánh Mì Kẹp Thịt nướng Cô Lệ (Trigger)
  { lat: 10.760900, lng: 106.701000 },
  { lat: 10.760600, lng: 106.701800 },
  { lat: 10.760300, lng: 106.702500 },
  { lat: 10.760124, lng: 106.702958 }, // Ốc Oanh (Trigger)
  { lat: 10.759700, lng: 106.703800 },
  { lat: 10.759200, lng: 106.704500 },
  { lat: 10.758364, lng: 106.705291 }, // Phá Lẩu Bò Cô Thảo (Trigger)
  { lat: 10.758000, lng: 106.705600 }  // End
];
let simulationRoutePoints = [];
let simIntervalId = null;
let simRouteIndex = 0;

// Default API Server URL fallback (pointing to port 5080 on the same host)
let defaultServerUrl;

function getBackendServerUrl() {
  const url = (serverUrlInput?.value || defaultServerUrl).trim();
  return url || defaultServerUrl;
}

function resolveAudioUrl(audioUrl) {
  if (!audioUrl) return '';
  const normalizedAudioUrl = audioUrl.trim();
  if (normalizedAudioUrl.startsWith('http://') || normalizedAudioUrl.startsWith('https://')) {
    return normalizedAudioUrl;
  }
  const serverUrl = getBackendServerUrl();
  if (!serverUrl) return normalizedAudioUrl;
  if (normalizedAudioUrl.startsWith('/')) {
    return `${serverUrl}${normalizedAudioUrl}`;
  }
  return `${serverUrl}/${normalizedAudioUrl}`;
}

function isTranslatedTextValid(stall) {
  if (!stall || !stall.translatedText) return false;
  const langCode = langPicker.value;
  if (langCode === 'vi') return true;

  const original = normalizeSearchText(stall.originalHistory || '');
  const translated = normalizeSearchText(stall.translatedText || '');
  if (!translated) return false;
  if (!original) return true;
  if (translated === original) return false;
  if (translated.includes(original)) return false;

  return true;
}

function getDisplayedStallName(stall) {
  if (!stall) return '';
  const langCode = langPicker.value;
  if (langCode === 'vi') return stall.name || '';
  return stall.translatedName || stall.name || '';
}

function getDisplayedStallAddress(stall) {
  if (!stall) return '';
  const langCode = langPicker.value;
  if (langCode === 'vi') return stall.address || '';
  return stall.translatedAddress || stall.address || '';
}

function getDisplayedStallDescription(stall) {
  if (!stall) return '';

  const langCode = langPicker.value;
  const trans = getTrans(langCode);
  const waitingForTranslation = syncInProgress ||
    syncRetryTimerId != null ||
    syncStatus?.dataset?.state === 'partial' ||
    syncStatus?.dataset?.state === 'running';

  if (langCode === 'vi') {
    return stall.originalHistory || stall.translatedText || '';
  }

  if (isTranslatedTextValid(stall)) {
    return stall.translatedText;
  }

  return waitingForTranslation ? trans.descPlaceholder : '';
}

window.resolveAudioUrl = resolveAudioUrl;

function updateMapMarkerPopups() {
  if (!markerLayer.length || !currentStallsCache.length) return;
  markerLayer.forEach(marker => {
    const stall = currentStallsCache.find(s => s.id === marker.stallId);
    if (stall) {
      marker.bindPopup(`<b>${getDisplayedStallName(stall)}</b><br>${getDisplayedStallAddress(stall)}`);
    }
  });
}

function setProfileButtonLabel(label, avatarUrl = '') {
  if (!showProfileBtn) return;
  if (avatarUrl) {
    showProfileBtn.innerHTML = `<img src="${avatarUrl}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" alt=""> ${label}`;
  } else {
    showProfileBtn.innerText = label;
  }
}

const uiTranslations = {
  vi: {
    subtitle: "OFFLINE AUDIO GUIDE & AI TOUR GUIDE",
    gpsLabel: "GPS Mocking / Real",
    syncBtn: "Đồng Bộ",
    chatHeader: "TRỢ LÝ TOUR HƯỚNG DẪN VIÊN AI",
    chatWelcome: "Xin chào! Tôi là Trợ Lý AI của phố ẩm thực Quận 4. Hãy đặt bất kỳ câu hỏi nào về các quán ăn, gợi ý món ăn, hoặc nhờ tôi lên lịch trình food tour Quận 4 cho bạn nhé!",
    chatPlaceholder: "Hỏi AI (Ví dụ: gợi ý quán ốc ngon...)",
    chatSendBtn: "Gửi",
    addressPlaceholder: "Địa chỉ",
    descPlaceholder: "Đang tải thuyết minh...",
    descUnavailable: "Chưa có bản dịch.",
    playBtn: "Bắt đầu nghe thuyết minh",
    pauseBtn: "Tạm dừng",
    audioStatusReady: "Sẵn sàng",
    audioStatusLoading: "Đang tải âm thanh...",
    audioStatusPlaying: "Đang phát...",
    audioStatusPaused: "Tạm dừng",
    audioStatusEnded: "Kết thúc",
    audioStatusNoAudio: "Không có thuyết minh âm thanh.",
    audioStatusNoFile: "Không có file âm thanh",
    listenBtn: "Nghe",
    searchPlaceholder: "Tìm quán theo tên hoặc loại món...",
    searchTypeName: "Tên quán",
    searchTypeType: "Loại món",
    searchBtn: "Tìm",
    filterLabel: "Bộ lọc quán",
    viewMenuBtn: "Mở xem menu chi tiết",
    directionsBtn: "Chỉ Đường",
    syncStatusReady: "Hệ thống sẵn sàng. Vui lòng Đồng bộ để cập nhật dữ liệu.",
    syncStatusRunning: "Đang đồng bộ dữ liệu từ server...",
    syncStatusSuccess: (count) => `Đồng bộ thành công! Đã tải ${count} quán ăn.`,
    syncStatusFailed: "Đồng bộ thất bại. Vui lòng kiểm tra kết nối hoặc URL.",
    syncStatusPartial: (ready, pending) => `Đã tải ${ready} quán. Đang dịch thêm ${pending} quán ở nền — hệ thống sẽ tự cập nhật...`,
    syncRequiresAccess: "Vui lòng đăng nhập và mở khóa quyền truy cập trước khi đồng bộ.",
    serverUrlMissing: "Không tìm thấy URL Server.",
    syncRequestFailed: "Yêu cầu đồng bộ thất bại.",
    audioStatusPlaybackError: "Lỗi phát âm thanh.",
    audioStatusTapPlay: "Bấm Phát Thuyết Minh để nghe",
    chatErrorNoServer: "Lỗi: Không tìm thấy URL Server.",
    chatThinking: "Đang suy nghĩ...",
    chatNoResponse: "Không nhận được câu trả lời từ AI.",
    chatServerConnectionError: "Lỗi kết nối server: ",
    chatUnableConnect: "Không thể kết nối đến máy chủ AI. Vui lòng kiểm tra lại mạng.",
    profileBtnLoggedIn: "👤 Hồ sơ",
    stallPlaceholderName: "Tên Quán",
    gpsStatusOff: "GPS: Tắt",
    gpsStatusTracking: "GPS: Đang theo dõi...",
    gpsStatusMock: (lat, lng) => `GPS: Giả lập (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsStatusReal: (lat, lng) => `GPS: Đã xác định (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsNoSupport: "Thiết bị không hỗ trợ định vị GPS.",
    gpsError: "Lỗi GPS. Sử dụng chế độ giả lập bằng click bản đồ.",
    simWalkStart: "🚶 Mô phỏng đi bộ",
    simWalkStop: "⏹ Dừng mô phỏng",
    stallListTitle: "Danh sách quán",
    stallListEmpty: "Không có quán nào trong dữ liệu.",
    profileEntryBtn: "Mở trang đăng nhập",
    appTitle: "ỐC QUẬN 4",
    profileModalTitle: "Thông tin người dùng",
    profileAvatarLabel: "Ảnh đại diện",
    profileUploadBtn: "Tải lên",
    profileLabelUsername: "Tên đăng nhập:",
    profileLabelFullname: "Họ & tên:",
    profileLabelEmail: "Email:",
    profileLabelPhone: "Điện thoại:",
    profileLabelRole: "Vai trò:",
    profileLabelUserId: "ID người dùng:",
    profileLabelDevice: "Device ID:",
    profileLogoutBtn: "Đăng xuất",
    profileSelectImageAlert: "Vui lòng chọn file ảnh.",
    profileLoginRequiredAlert: "Bạn phải đăng nhập để tải ảnh lên.",
    profileUploadFailed: "Tải lên thất bại: ",
    profileUploadSuccess: "Ảnh đại diện đã được tải lên.",
    profileUploadError: "Lỗi khi tải ảnh lên.",
    simWalkStep: (step, total) => `(Bước ${step}/${total})`
  },
  en: {
    subtitle: "OFFLINE AUDIO GUIDE & AI TOUR GUIDE",
    gpsLabel: "GPS Mocking / Real",
    syncBtn: "Sync",
    chatHeader: "AI TOUR ASSISTANT",
    chatWelcome: "Hello! I am the AI Assistant for District 4 Street Food. Ask me anything about stalls, food recommendations, or let me plan a food tour for you!",
    chatPlaceholder: "Ask AI (e.g., recommend delicious snails...)",
    chatSendBtn: "Send",
    addressPlaceholder: "Address",
    descPlaceholder: "Loading narration...",
    descUnavailable: "Translation unavailable.",
    playBtn: "Play Narration",
    pauseBtn: "Pause",
    audioStatusReady: "Ready",
    audioStatusLoading: "Loading audio...",
    audioStatusPlaying: "Playing...",
    audioStatusPaused: "Paused",
    audioStatusEnded: "Finished",
    audioStatusNoAudio: "No narration audio.",
    audioStatusNoFile: "No audio file",
    listenBtn: "Listen",
    searchPlaceholder: "Search by stall name or food type...",
    searchTypeName: "Stall Name",
    searchTypeType: "Food Type",
    searchBtn: "Search",
    filterLabel: "Stall Filter",
    viewMenuBtn: "Open detailed menu",
    directionsBtn: "Get Directions",
    syncStatusReady: "System ready. Please click Sync to download data.",
    syncStatusRunning: "Synchronizing data from server...",
    syncStatusSuccess: (count) => `Sync success! Downloaded ${count} food stalls.`,
    syncStatusFailed: "Sync failed. Please check network connection or server URL.",
    syncStatusPartial: (ready, pending) => `Loaded ${ready} stalls. Translating ${pending} more in background — auto-refreshing...`,
    syncRequiresAccess: "Please log in and unlock access before syncing.",
    serverUrlMissing: "Server URL not found.",
    syncRequestFailed: "Sync request failed.",
    audioStatusPlaybackError: "Audio playback error.",
    audioStatusTapPlay: "Tap Play Narration to listen",
    chatErrorNoServer: "Error: Server URL not found.",
    chatThinking: "Thinking...",
    chatNoResponse: "No response from AI.",
    chatServerConnectionError: "Server connection error: ",
    chatUnableConnect: "Unable to connect to AI server. Please check your network.",
    profileBtnLoggedIn: "👤 Profile",
    stallPlaceholderName: "Stall Name",
    gpsStatusOff: "GPS: Off",
    gpsStatusTracking: "GPS: Tracking...",
    gpsStatusMock: (lat, lng) => `GPS: Mocked (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsStatusReal: (lat, lng) => `GPS: Located (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsNoSupport: "Device does not support GPS geolocation.",
    gpsError: "GPS error. Using map click mocking mode.",
    simWalkStart: "🚶 Simulate Walk",
    simWalkStop: "⏹ Stop Sim",
    stallListTitle: "Food Stalls",
    stallListEmpty: "No food stalls available.",
    profileEntryBtn: "Open login page",
    appTitle: "DISTRICT 4 SNAILS",
    profileModalTitle: "User Profile",
    profileAvatarLabel: "Profile photo",
    profileUploadBtn: "Upload",
    profileLabelUsername: "Username:",
    profileLabelFullname: "Full name:",
    profileLabelEmail: "Email:",
    profileLabelPhone: "Phone:",
    profileLabelRole: "Role:",
    profileLabelUserId: "User ID:",
    profileLabelDevice: "Device ID:",
    profileLogoutBtn: "Log out",
    profileSelectImageAlert: "Please select an image file.",
    profileLoginRequiredAlert: "You must be logged in to upload a photo.",
    profileUploadFailed: "Upload failed: ",
    profileUploadSuccess: "Profile photo uploaded successfully.",
    profileUploadError: "Error uploading photo.",
    simWalkStep: (step, total) => `(Step ${step}/${total})`
  },
  ja: {
    subtitle: "オフライン音声ガイド＆AIツアーガイド",
    gpsLabel: "GPSモック / リアル",
    syncBtn: "同期する",
    chatHeader: "AIツアーアシスタント",
    chatWelcome: "こんにちは！第4区ストリートフードのAIアシスタントです。おすすめのお店やメニュー、フードツアーの計画など、何でも聞いてください！",
    chatPlaceholder: "AIに聞く（例：美味しい貝のお店を教えて...）",
    chatSendBtn: "送信",
    addressPlaceholder: "住所",
    descPlaceholder: "解説を読み込み中...",
    descUnavailable: "翻訳がまだありません。",
    playBtn: "ナレーションを開始",
    pauseBtn: "一時停止",
    audioStatusReady: "準備完了",
    audioStatusLoading: "音声を読み込み中...",
    audioStatusPlaying: "再生中...",
    audioStatusPaused: "一時停止中",
    audioStatusEnded: "再生終了",
    audioStatusNoAudio: "音声解説はありません。",
    audioStatusNoFile: "音声ファイルがありません",
    listenBtn: "聴く",
    searchPlaceholder: "店舗名または料理の種類で検索...",
    searchTypeName: "店舗名",
    searchTypeType: "料理の種類",
    searchBtn: "検索",
    filterLabel: "店舗フィルター",
    viewMenuBtn: "詳細メニューを開く",
    syncStatusReady: "システム準備完了。同期ボタンを押してデータを更新してください。",
    syncStatusRunning: "サーバーからデータを同期中...",
    syncStatusSuccess: (count) => `同期完了！${count}件の店舗情報をダウンロードしました。`,
    syncStatusFailed: "同期に失敗しました。接続またはサーバーURLを確認してください。",
    syncStatusPartial: (ready, pending) => `${ready}件読み込み済み。残り${pending}件をバックグラウンドで翻訳中 — 自動更新します...`,
    syncRequiresAccess: "同期する前にログインしてアクセス権限を有効にしてください。",
    serverUrlMissing: "サーバー URL が見つかりません。",
    syncRequestFailed: "同期リクエストに失敗しました。",
    audioStatusPlaybackError: "音声再生エラー。",
    audioStatusTapPlay: "再生ボタンを押してナレーションを聞いてください",
    chatErrorNoServer: "エラー: サーバー URL が見つかりません。",
    chatThinking: "考えています...",
    chatNoResponse: "AI からの応答がありません。",
    chatServerConnectionError: "サーバー接続エラー: ",
    chatUnableConnect: "AI サーバーに接続できません。ネットワークを確認してください。",
    profileBtnLoggedIn: "👤 プロフィール",
    stallPlaceholderName: "店舗名",
    gpsStatusOff: "GPS: オフ",
    gpsStatusTracking: "GPS: 追跡中...",
    gpsStatusMock: (lat, lng) => `GPS: シミュレーション (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsStatusReal: (lat, lng) => `GPS: 位置特定 (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsNoSupport: "デバイスはGPS位置情報をサポートしていません。",
    gpsError: "GPSエラー。マップクリック模擬モードを使用中。",
    simWalkStart: "🚶 歩行シミュレーション",
    simWalkStop: "⏹ シミュレーション停止",
    stallListTitle: "店舗一覧",
    stallListEmpty: "店舗情報がありません。",
    profileEntryBtn: "ログインページを開く",
    appTitle: "第4区 グルメ",
    profileModalTitle: "ユーザー情報",
    profileAvatarLabel: "プロフィール写真",
    profileUploadBtn: "アップロード",
    profileLabelUsername: "ユーザー名:",
    profileLabelFullname: "氏名:",
    profileLabelEmail: "メール:",
    profileLabelPhone: "電話番号:",
    profileLabelRole: "役割:",
    profileLabelUserId: "ユーザーID:",
    profileLabelDevice: "デバイスID:",
    profileLogoutBtn: "ログアウト",
    profileSelectImageAlert: "画像ファイルを選択してください。",
    profileLoginRequiredAlert: "写真をアップロードするにはログインが必要です。",
    profileUploadFailed: "アップロード失敗: ",
    profileUploadSuccess: "プロフィール写真をアップロードしました。",
    profileUploadError: "写真のアップロード中にエラーが発生しました。",
    simWalkStep: (step, total) => `(ステップ ${step}/${total})`
  },
  ko: {
    subtitle: "오프라인 음성 가이드 & AI 투어 가이드",
    gpsLabel: "GPS 모의 / 실제",
    syncBtn: "동기화",
    chatHeader: "AI 투어 어시스턴트",
    chatWelcome: "안녕하세요! 저는 4구 스트리트 푸드 AI 어시스턴트입니다. 맛집 추천, 메뉴 정보, 푸드 투어 계획 등 무엇이든 물어보세요!",
    chatPlaceholder: "AI에게 물어보기 (예: 맛있는 꼬막집 추천해줘...)",
    chatSendBtn: "보내기",
    addressPlaceholder: "주소",
    descPlaceholder: "오디오 가이드 로딩 중...",
    descUnavailable: "번역이 아직 없습니다.",
    playBtn: "해설 듣기 시작",
    pauseBtn: "일시정지",
    audioStatusReady: "준비 완료",
    audioStatusLoading: "음성을 불러오는 중...",
    audioStatusPlaying: "재생 중...",
    audioStatusPaused: "일시 정지됨",
    audioStatusEnded: "재생 완료",
    audioStatusNoAudio: "가이드 오디오가 없습니다.",
    audioStatusNoFile: "오디오 파일이 없음",
    listenBtn: "듣기",
    searchPlaceholder: "가게 이름 또는 음식 종류로 검색...",
    searchTypeName: "가게 이름",
    searchTypeType: "음식 종류",
    searchBtn: "검색",
    filterLabel: "가게 필터",
    viewMenuBtn: "상세 메뉴 열기",
    syncStatusReady: "시스템이 준비되었습니다. 데이터를 업데이트하려면 동기화하십시오.",
    syncStatusRunning: "서버에서 데이터를 동기화하는 중...",
    syncStatusSuccess: (count) => `동기화 완료! ${count}개 맛집을 다운로드했습니다.`,
    syncStatusFailed: "동기화 실패. 네트워크 또는 서버 URL을 확인하십시오.",
    syncStatusPartial: (ready, pending) => `${ready}개 로드됨. ${pending}개 번역 진행 중 — 자동 새로고침...`,
    syncRequiresAccess: "동기화하기 전에 로그인하고 접근 권한을 열어주세요.",
    serverUrlMissing: "서버 URL을 찾을 수 없습니다.",
    syncRequestFailed: "동기화 요청에 실패했습니다.",
    audioStatusPlaybackError: "오디오 재생 오류입니다.",
    audioStatusTapPlay: "재생 버튼을 눌러 내레이션을 들어보세요",
    chatErrorNoServer: "오류: 서버 URL을 찾을 수 없습니다.",
    chatThinking: "생각 중...",
    chatNoResponse: "AI의 응답을 받지 못했습니다.",
    chatServerConnectionError: "서버 연결 오류: ",
    chatUnableConnect: "AI 서버에 연결할 수 없습니다. 네트워크를 확인하세요.",
    profileBtnLoggedIn: "👤 프로필",
    stallPlaceholderName: "가게 이름",
    gpsStatusOff: "GPS: 꺼짐",
    gpsStatusTracking: "GPS: 추적 중...",
    gpsStatusMock: (lat, lng) => `GPS: 시뮬레이션 (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsStatusReal: (lat, lng) => `GPS: 위치 확인 (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsNoSupport: "기기가 GPS 위치 정보를 지원하지 않습니다.",
    gpsError: "GPS 오류. 지도 클릭 모의 모드를 사용 중입니다.",
    simWalkStart: "🚶 걷기 시뮬레이션",
    simWalkStop: "⏹ 시뮬레이션 중지",
    stallListTitle: "가게 목록",
    stallListEmpty: "가게 정보가 없습니다.",
    profileEntryBtn: "로그인 페이지 열기",
    appTitle: "4구 미식",
    profileModalTitle: "사용자 정보",
    profileAvatarLabel: "프로필 사진",
    profileUploadBtn: "업로드",
    profileLabelUsername: "사용자 이름:",
    profileLabelFullname: "이름:",
    profileLabelEmail: "이메일:",
    profileLabelPhone: "전화번호:",
    profileLabelRole: "역할:",
    profileLabelUserId: "사용자 ID:",
    profileLabelDevice: "기기 ID:",
    profileLogoutBtn: "로그아웃",
    profileSelectImageAlert: "이미지 파일을 선택해 주세요.",
    profileLoginRequiredAlert: "사진을 업로드하려면 로그인해야 합니다.",
    profileUploadFailed: "업로드 실패: ",
    profileUploadSuccess: "프로필 사진이 업로드되었습니다.",
    profileUploadError: "사진 업로드 중 오류가 발생했습니다.",
    simWalkStep: (step, total) => `(단계 ${step}/${total})`
  },
  zh: {
    subtitle: "离线语音导览与 AI 导游",
    gpsLabel: "GPS 模拟 / 实时",
    syncBtn: "同步",
    chatHeader: "AI 旅游助手",
    chatWelcome: "你好！我是第4区街头美食的 AI 助手。欢迎询问小吃摊、推荐美食，或让我帮你规划美食之旅！",
    chatPlaceholder: "向 AI 提问（例如：推荐美味的螺蛳店...）",
    chatSendBtn: "发送",
    addressPlaceholder: "地址",
    descPlaceholder: "正在加载讲解...",
    descUnavailable: "暂无翻译。",
    playBtn: "播放旁白",
    pauseBtn: "暂停",
    audioStatusReady: "准备就绪",
    audioStatusLoading: "正在加载音频...",
    audioStatusPlaying: "播放中...",
    audioStatusPaused: "已暂停",
    audioStatusEnded: "播放结束",
    audioStatusNoAudio: "没有旁白音频。",
    audioStatusNoFile: "没有音频文件",
    listenBtn: "收听",
    searchPlaceholder: "按店名或菜品类型搜索...",
    searchTypeName: "店铺名称",
    searchTypeType: "菜品类型",
    searchBtn: "搜索",
    filterLabel: "店铺筛选",
    syncStatusReady: "系统已准备就绪。请点击同步以下载数据。",
    syncStatusRunning: "正在从服务器同步数据...",
    syncStatusSuccess: (count) => `同步成功！已下载 ${count} 个美食店铺。`,
    syncStatusFailed: "同步失败。请检查网络连接或服务器 URL。",
    syncStatusPartial: (ready, pending) => `已加载 ${ready} 个店铺，另有 ${pending} 个正在后台翻译 — 自动刷新中...`,
    syncRequiresAccess: "请先登录并解锁访问权限，再进行同步。",
    serverUrlMissing: "未找到服务器 URL。",
    syncRequestFailed: "同步请求失败。",
    audioStatusPlaybackError: "音频播放错误。",
    audioStatusTapPlay: "点击播放旁白以收听",
    chatErrorNoServer: "错误：未找到服务器 URL。",
    chatThinking: "正在思考...",
    chatNoResponse: "未收到 AI 响应。",
    chatServerConnectionError: "服务器连接错误： ",
    chatUnableConnect: "无法连接到 AI 服务器。请检查网络。",
    profileBtnLoggedIn: "👤 个人资料",
    stallPlaceholderName: "店铺名称",
    gpsStatusOff: "GPS：关闭",
    gpsStatusTracking: "GPS：跟踪中...",
    gpsStatusMock: (lat, lng) => `GPS：模拟 (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsStatusReal: (lat, lng) => `GPS：已定位 (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    gpsNoSupport: "设备不支持 GPS 定位。",
    gpsError: "GPS 错误。正在使用地图点击模拟模式。",
    simWalkStart: "🚶 模拟步行",
    simWalkStop: "⏹ 停止模拟",
    stallListTitle: "店铺列表",
    stallListEmpty: "暂无店铺信息。",
    profileEntryBtn: "打开登录页面",
    appTitle: "第4区 美食",
    profileModalTitle: "用户信息",
    profileAvatarLabel: "头像",
    profileUploadBtn: "上传",
    profileLabelUsername: "用户名:",
    profileLabelFullname: "姓名:",
    profileLabelEmail: "邮箱:",
    profileLabelPhone: "电话:",
    profileLabelRole: "角色:",
    profileLabelUserId: "用户 ID:",
    profileLabelDevice: "设备 ID:",
    profileLogoutBtn: "退出登录",
    profileSelectImageAlert: "请选择图片文件。",
    profileLoginRequiredAlert: "上传照片前请先登录。",
    profileUploadFailed: "上传失败: ",
    profileUploadSuccess: "头像上传成功。",
    profileUploadError: "上传照片时出错。",
    simWalkStep: (step, total) => `(步骤 ${step}/${total})`
  }
};

// Update UI elements texts based on selected language
function updateUiLanguage(lang) {
  const trans = getTrans(lang);
  applyDocumentLanguage(lang);
  updateI18nElements(lang);

  const portalBtn = document.getElementById('portal-btn');
  if (portalBtn) portalBtn.innerText = trans.portalBtn || "🔑 Portal";

  const appTitleEl = document.getElementById('app-title');
  if (appTitleEl) appTitleEl.innerText = trans.appTitle || appTitleEl.innerText;

  if (stallSearchInput) stallSearchInput.placeholder = trans.searchPlaceholder || stallSearchInput.placeholder;
  if (stallSearchType) {
    const nameOpt = stallSearchType.querySelector('option[value="name"]');
    const typeOpt = stallSearchType.querySelector('option[value="type"]');
    if (nameOpt) nameOpt.innerText = trans.searchTypeName || 'Tên quán';
    if (typeOpt) typeOpt.innerText = trans.searchTypeType || 'Loại món';
  }
  const stallFilterLabel = document.querySelector('.stall-filter-label');
  if (stallFilterLabel) stallFilterLabel.innerText = trans.filterLabel || stallFilterLabel.innerText;
  if (stallSearchBtn) stallSearchBtn.innerText = trans.searchBtn || stallSearchBtn.innerText;
  const subtitleEl = document.querySelector('.title-section span');
  if (subtitleEl) subtitleEl.innerText = trans.subtitle;

  const gpsSwitchLabelEl = document.getElementById('gps-switch-label');
  if (gpsSwitchLabelEl) gpsSwitchLabelEl.innerText = trans.gpsLabel;

  if (syncBtn) syncBtn.innerText = trans.syncBtn;
  if (viewMenuBtn) viewMenuBtn.innerHTML = '<span>☰</span> <span>' + (trans.viewMenuBtn || "Xem Menu") + '</span>';
  if (directionsBtn) directionsBtn.innerHTML = '<span>📍</span> <span>' + (trans.directionsBtn || "Chỉ Đường") + '</span>';
  const stallListTitleEl = document.getElementById('stall-list-title');
  if (stallListTitleEl) stallListTitleEl.innerText = trans.stallListTitle || 'Danh sách quán';

  const chatHeaderEl = document.querySelector('.chat-header h3');
  if (chatHeaderEl) chatHeaderEl.innerText = trans.chatHeader;

  if (chatSendBtn) chatSendBtn.innerText = trans.chatSendBtn;
  if (chatInput) chatInput.placeholder = trans.chatPlaceholder;
  if (chatLog) {
    const welcomeBubble = chatLog.querySelector('.bubble.ai:first-child');
    if (welcomeBubble) {
      welcomeBubble.innerText = trans.chatWelcome;
    }
  }

  if (stallCard && !stallCard.classList.contains('visible')) {
    if (stallName) stallName.innerText = trans.stallPlaceholderName || stallName.innerText;
    if (stallAddress) stallAddress.innerText = trans.addressPlaceholder;
    if (stallDescription) stallDescription.innerText = trans.descPlaceholder;
  }

  if (simWalkBtn) {
    simWalkBtn.innerText = simIntervalId ? trans.simWalkStop : trans.simWalkStart;
  }
  updatePlayButtonState(!audioPlayer.paused && !audioPlayer.ended && audioPlayer.src);
  if (syncStatus) {
    const state = syncStatus.dataset.state || 'ready';
    if (state === 'ready') syncStatus.innerText = trans.syncStatusReady;
    else if (state === 'running') syncStatus.innerText = trans.syncStatusRunning;
    else if (state === 'partial') syncStatus.innerText = syncStatus.innerText;
    else if (state === 'failed') syncStatus.innerText = trans.syncStatusFailed;
    else if (state === 'access') syncStatus.innerText = trans.syncRequiresAccess;
  }

  if (gpsStatus) {
    const gpsState = gpsStatus.dataset.state || 'off';
    if (gpsState === 'off') gpsStatus.innerText = trans.gpsStatusOff;
    else if (gpsState === 'tracking') gpsStatus.innerText = trans.gpsStatusTracking;
    else if (gpsState === 'mock' && currentCoords) {
      gpsStatus.innerText = trans.gpsStatusMock(currentCoords.lat, currentCoords.lon);
    } else if (gpsState === 'real' && currentCoords) {
      gpsStatus.innerText = trans.gpsStatusReal(currentCoords.lat, currentCoords.lon);
    }
  }

  updateHeaderAuthState();
  updateMapMarkerPopups();
  updateCustomLangPicker(lang);
}

function updateCustomLangPicker(lang) {
  const currentFlag = document.getElementById('current-lang-flag');
  const currentText = document.getElementById('current-lang-text');
  const mobileFlag = document.getElementById('mobile-lang-flag');

  const flagUrls = {
    vi: 'https://flagcdn.com/w40/vn.png',
    en: 'https://flagcdn.com/w40/gb.png',
    ja: 'https://flagcdn.com/w40/jp.png',
    ko: 'https://flagcdn.com/w40/kr.png',
    zh: 'https://flagcdn.com/w40/cn.png'
  };

  const langNames = {
    vi: 'Tiếng Việt',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    zh: '中文'
  };

  const flagUrl = flagUrls[lang] || flagUrls.vi;
  const langName = langNames[lang] || langNames.vi;

  if (currentFlag) currentFlag.src = flagUrl;
  if (currentText) currentText.textContent = langName;
  if (mobileFlag) mobileFlag.src = flagUrl;
}

function initCustomLangPicker() {
  const btnCurrent = document.getElementById('lang-btn-current');
  const mobileBtn = document.getElementById('mobile-lang-btn');
  const dropdownMenu = document.getElementById('lang-dropdown-menu');

  if (btnCurrent && dropdownMenu) {
    btnCurrent.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('show');
      dropdownMenu.classList.remove('mobile-show');
    });
  }

  if (mobileBtn && dropdownMenu) {
    mobileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('mobile-show');
      dropdownMenu.classList.remove('show');
    });
  }

  const langItems = document.querySelectorAll('.lang-item');
  langItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const selectedVal = item.getAttribute('data-value');
      if (selectedVal && langPicker) {
        langPicker.value = selectedVal;
        langPicker.dispatchEvent(new Event('change'));
      }
      if (dropdownMenu) {
        dropdownMenu.classList.remove('show');
        dropdownMenu.classList.remove('mobile-show');
      }
    });
  });

  document.addEventListener('click', () => {
    if (dropdownMenu) {
      dropdownMenu.classList.remove('show');
      dropdownMenu.classList.remove('mobile-show');
    }
  });
}

// Global error handler to help debug mobile devices
window.onerror = function (message, source, lineno, colno, error) {
  const status = document.getElementById('sync-status');
  if (status) {
    status.style.color = '#FF3333';
    status.innerText = `Lỗi JS: ${message} (dòng ${lineno})`;
  }
  console.error('Global Error:', message, 'at', source, ':', lineno);
  return false;
};

// Initialize app immediately since type="module" runs after DOM is ready
async function initApp() {
  // Initialize ALL DOM elements first (must do this before any DOM operations)
  serverUrlInput = document.getElementById('server-url');
  langPicker = document.getElementById('lang-picker');
  syncBtn = document.getElementById('sync-btn');
  gpsSwitch = document.getElementById('gps-switch');
  stallCard = document.getElementById('stall-card');
  stallName = document.getElementById('stall-name');
  stallDistance = document.getElementById('stall-distance');
  stallAddress = document.getElementById('stall-address');
  stallDescription = document.getElementById('stall-description');
  stallList = document.getElementById('stall-list');
  chatLog = document.getElementById('chat-log');
  chatInput = document.getElementById('chat-input');
  chatSendBtn = document.getElementById('chat-send-btn');
  syncStatus = document.getElementById('sync-status');
  gpsStatus = document.getElementById('gps-status');
  simWalkBtn = document.getElementById('sim-walk-btn');
  stallSearchInput = document.getElementById('stall-search-input');
  stallSearchType = document.getElementById('stall-search-type');
  stallSearchBtn = document.getElementById('stall-search-btn');
  showProfileBtn = document.getElementById('show-profile-btn');
  profileModal = document.getElementById('profile-modal');
  profileCloseBtn = document.getElementById('profile-close-btn');
  profileUsername = document.getElementById('profile-username');
  profileFullname = document.getElementById('profile-fullname');
  profileEmail = document.getElementById('profile-email');
  profilePhone = document.getElementById('profile-phone');
  profileRole = document.getElementById('profile-role');
  profileUserId = document.getElementById('profile-userid');
  profileDevice = document.getElementById('profile-device');
  profileAvatarImg = document.getElementById('profile-avatar-img');
  profileAvatarInput = document.getElementById('profile-avatar-input');
  profileAvatarUploadBtn = document.getElementById('profile-avatar-upload-btn');
  profileLogoutBtn = document.getElementById('profile-logout-btn');

  audioPlayer = document.getElementById('audio-player');
  playAudioBtn = document.getElementById('play-audio-btn');
  playBtnIcon = document.getElementById('play-btn-icon');
  playBtnText = document.getElementById('play-btn-text');
  audioStatus = document.getElementById('audio-status');
  viewMenuBtn = document.getElementById('view-menu-btn');
  directionsBtn = document.getElementById('directions-btn');
  menuModal = document.getElementById('menu-modal');
  menuImagesContainer = document.getElementById('menu-images-container');
  menuModalMessage = document.getElementById('menu-modal-message');
  menuModalClose = document.getElementById('menu-modal-close');

  if (window.paymentGateReadyPromise && typeof window.paymentGateReadyPromise.then === 'function') {
    try {
      await window.paymentGateReadyPromise;
    } catch (err) {
      console.warn('Payment gate readiness check failed', err);
    }
  }

  // Set default server URL after DOM ready
  defaultServerUrl = (() => {
    if (window.location.protocol === 'file:') {
      return 'http://localhost:5080';
    }
    if (window.location.port === '5080' || window.location.port === '7089') {
      return window.location.origin;
    }
    if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '5241') {
      return `${window.location.protocol}//${window.location.hostname}:5080`;
    }
    if (window.location.port === '3000' || window.location.port === '4173' || window.location.port === '4200') {
      return `${window.location.protocol}//${window.location.hostname}:5080`;
    }
    if (window.location.protocol === 'https:') {
      return `${window.location.protocol}//${window.location.hostname}:7089`;
    }
    return `${window.location.protocol}//${window.location.hostname}:5080`;
  })();
  serverUrlInput.value = defaultServerUrl;

  console.debug('All DOM elements initialized', {
    viewMenuBtn: !!viewMenuBtn,
    menuModal: !!menuModal,
    serverUrlInput: !!serverUrlInput,
    langPicker: !!langPicker
  });
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      console.log('Service Worker registered successfully.');
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (err) {
      console.error('Service Worker registration failed:', err);
    }
  }

  try {
    // Initialize DB
    await db.init();

    // Restore saved language before rendering UI/data
    const savedLang = getSavedLanguage();
    if (langPicker) langPicker.value = savedLang;
    initCustomLangPicker();
    updateUiLanguage(savedLang);

    // Initialize Map
    initMap();

    // Load stalls from local DB
    await loadStallPins();

    // Wire events
    syncBtn.addEventListener('click', onSync);
    gpsSwitch.addEventListener('change', onGpsToggle);
    chatSendBtn.addEventListener('click', onSendChat);
    chatInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') onSendChat();
    });

    if (stallSearchInput) {
      stallSearchInput.addEventListener('input', () => renderStallListCache());
    }
    if (stallSearchType) {
      stallSearchType.addEventListener('change', () => renderStallListCache());
    }
    if (stallSearchBtn) {
      stallSearchBtn.addEventListener('click', () => renderStallListCache());
    }

    simWalkBtn.addEventListener('click', toggleSimulationWalk);

    // Profile button wiring
    if (showProfileBtn) showProfileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleProfileModal();
    });
    if (profileCloseBtn) profileCloseBtn.addEventListener('click', () => { profileModal.style.display = 'none'; });
    if (profileLogoutBtn) profileLogoutBtn.addEventListener('click', onLogout);
    if (profileAvatarUploadBtn) profileAvatarUploadBtn.addEventListener('click', uploadAvatar);

    // Update header auth state (show login vs profile)
    updateHeaderAuthState();
    // fetch profile to display avatar and fullname asap
    fetchProfileIfLoggedIn();

    // Wire language change event
    langPicker.addEventListener('change', async () => {
      const lang = langPicker.value;
      localStorage.setItem(LANG_STORAGE_KEY, lang);
      updateUiLanguage(lang);

      if (selectedStallId && stallCard.classList.contains('visible')) {
        const trans = getTrans(lang);
        stallDescription.innerText = trans.descPlaceholder;
        audioStatus.innerText = trans.audioStatusLoading;
        audioPlayer.pause();
        updatePlayButtonState(false);
      }

      renderStallListCache();
      await onSync();
      refreshSelectedStallCard();
    });

    // Wire audio control events
    // Start Heartbeat loop every 30s
    sendHeartbeat();
    setInterval(sendHeartbeat, 30000);
    if (playAudioBtn) {
      playAudioBtn.addEventListener('click', () => {
        const activeStallId = stallCard?.dataset?.stallId || lastTriggeredStallId || '';
        if (activeStallId) {
          void recordUserAction(activeStallId, 'START_AUDIO');
        }
        onToggleAudio();
      });
    }

    if (viewMenuBtn) {
      viewMenuBtn.addEventListener('click', async () => {
        const activeStallId = stallCard?.dataset?.stallId || lastTriggeredStallId || '';
        console.debug('view-menu-btn clicked', { activeStallId });
        if (!activeStallId) {
          showMenuModalMessage('Vui lòng đứng gần một quán để xem menu.');
          return;
        }
        void recordUserAction(activeStallId, 'VIEW_MENU');
        await openMenuModal(activeStallId);
      });
    }

    if (directionsBtn) {
      directionsBtn.addEventListener('click', () => {
        const activeStallId = stallCard?.dataset?.stallId || lastTriggeredStallId || '';
        if (!activeStallId) {
          alert('Vui lòng chọn một quán trước.');
          return;
        }
        const stall = currentStallsCache.find(s => s.id === activeStallId);
        if (stall && stall.latitude && stall.longitude) {
          const url = `https://www.google.com/maps/dir/?api=1&destination=${stall.latitude},${stall.longitude}`;
          window.open(url, '_blank');
        }
      });
    }
    if (menuModalClose) {
      menuModalClose.addEventListener('click', () => {
        if (menuModal) menuModal.style.display = 'none';
      });
    }

    if (menuModal) {
      menuModal.addEventListener('click', (event) => {
        if (event.target === menuModal) {
          menuModal.style.display = 'none';
        }
      });
    }


    audioPlayer.addEventListener('ended', () => {
      const trans = getTrans();
      updatePlayButtonState(false);
      audioStatus.innerText = trans.audioStatusEnded;
    });

    if (hasUnlockedAccess()) {
      onSync().catch(err => console.warn('Auto sync on load failed', err));
    }
  } catch (err) {
    console.error('App init failed:', err);
    const status = document.getElementById('sync-status');
    if (status) {
      status.style.color = '#FF3333';
      status.innerText = `Lỗi khởi chạy: ${err.message || err}`;
    }
  }
}

function isUserLoggedIn() {
  const token = localStorage.getItem('authToken');
  const role = localStorage.getItem('userRole');
  return !!token && !!role;
}

function updateHeaderAuthState() {
  const loggedIn = isUserLoggedIn();
  const trans = getTrans();
  if (showProfileBtn) {
    showProfileBtn.style.display = 'inline-flex';
    const label = loggedIn
      ? (trans.profileBtnLoggedIn || '👤 Hồ sơ')
      : (trans.profileEntryBtn || 'Mở trang đăng nhập');
    const existingAvatar = showProfileBtn.querySelector('img');
    setProfileButtonLabel(label, existingAvatar?.src || '');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
async function sendHeartbeat() {
  const serverUrl = getBackendServerUrl();
  if (!serverUrl) return;

  let lat = null, lon = null;
  if (currentCoords) {
    lat = currentCoords.lat;
    lon = currentCoords.lon;
  }

  try {
    await fetch(`${serverUrl}/api/admin/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deviceUniqueId: deviceId,
        latitude: lat,
        longitude: lon,
        action: 'HEARTBEAT'
      })
    });
  } catch (err) {
    console.warn('Heartbeat failed', err);
  }
}

async function sendStallVisitTelemetry(action, stallId) {
  const serverUrl = getBackendServerUrl();
  if (!serverUrl || !stallId) return;

  let lat = null, lon = null;
  if (currentCoords) {
    lat = currentCoords.lat;
    lon = currentCoords.lon;
  }

  try {
    await fetch(`${serverUrl}/api/admin/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deviceUniqueId: deviceId,
        latitude: lat,
        longitude: lon,
        action: action,
        stallId: stallId
      })
    });
  } catch (err) {
    console.warn('Stall telemetry failed', err);
  }
}

// Device Unique ID for analytics
function getOrCreateDeviceId() {
  let id = localStorage.getItem('DeviceUniqueId');
  if (!id) {
    id = 'pwa_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('DeviceUniqueId', id);
  }
  return id;
}

// Leaflet Map Initialization
function initMap() {
  // Center on Vinh Khanh street District 4
  const vinhKhanhCenter = [10.760124, 106.702958];

  map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView(vinhKhanhCenter, 16);

  // Add OSM tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  // Setup click handler on map for GPS Mocking/Simulation
  map.on('click', e => {
    onMapClicked(e.latlng.lat, e.latlng.lng);
  });
}

// Draw stalls on map
async function loadStallPins() {
  // Clear old markers
  markerLayer.forEach(marker => map.removeLayer(marker));
  markerLayer = [];

  const stalls = await db.getStalls();
  currentStallsCache = stalls;

  stalls.forEach(stall => {
    // Create beautiful orange marker using Leaflet divIcon and CSS pin-marker
    const orangeIcon = L.divIcon({
      html: `<div class="pin-marker"></div>`,
      className: 'custom-pin-icon',
      iconSize: [26, 26],
      iconAnchor: [13, 26]
    });

    const marker = L.marker([stall.latitude, stall.longitude], { icon: orangeIcon });
    marker.stallId = stall.id;
    marker.bindPopup(`<b>${getDisplayedStallName(stall)}</b><br>${getDisplayedStallAddress(stall)}`);
    marker.on('click', () => {
      focusStallOnMap(stall.id, stalls);
      if (stall.audioUrl) {
        playNarrationAudio(stall.audioUrl);
      }
    });
    marker.addTo(map);
    markerLayer.push(marker);
  });

  // Automatically zoom and center map to show all orange pins if they exist
  if (markerLayer.length > 0) {
    const group = L.featureGroup(markerLayer);
    map.fitBounds(group.getBounds().pad(0.1));
  }

  renderStallListCache();
}

function renderStallListCache(stalls = null) {
  if (!stallList) return;

  if (!stalls) {
    stalls = getFilteredStalls();
  }
  const currentLat = currentCoords?.lat;
  const currentLon = currentCoords?.lon;
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;

  if (!stalls || stalls.length === 0) {
    stallList.innerHTML = `<div class="stall-item"><div class="stall-item-name">${trans.stallListEmpty || 'Không có quán nào trong dữ liệu.'}</div></div>`;
    return;
  }

  stallList.innerHTML = stalls.map(stall => {
    const distance = (currentLat != null && currentLon != null)
      ? Math.round(calculateHaversineDistance(currentLat, currentLon, stall.latitude, stall.longitude))
      : null;
    const distancePart = distance != null ? `<div class="stall-item-distance">${distance}m</div>` : '';
    const listenText = trans.listenBtn || 'Nghe';
    const displayName = getDisplayedStallName(stall);
    const displayAddress = getDisplayedStallAddress(stall);
    return `
      <div class="stall-item" data-id="${stall.id}">
        <div class="stall-item-row">
          <div>
            <div class="stall-item-name">${displayName}</div>
            <div class="stall-item-address">${displayAddress}</div>
          </div>
          <button class="stall-item-listen-btn" data-id="${stall.id}">${listenText}</button>
        </div>
        ${distancePart}
      </div>
    `;
  }).join('');

  stallList.querySelectorAll('.stall-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      if (!id) return;
      const stallId = id;
      focusStallOnMap(stallId, stalls);
    });
  });

  stallList.querySelectorAll('.stall-item-listen-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const id = button.dataset.id;
      if (!id) return;
      const stall = stalls.find(s => s.id === id);
      if (!stall) return;
      focusStallOnMap(stall.id, stalls, false);
      playNarrationAudio(stall.audioUrl);
    });
  });
}

function focusStallOnMap(id, stalls, showCard = true) {
  selectedStallId = id;
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;

  const stall = stalls.find(s => s.id === id);
  if (!stall) return;

  const marker = markerLayer.find(m => m.stallId === id);
  if (marker) {
    map.setView(marker.getLatLng(), 18, { animate: true });
    marker.openPopup();
  } else {
    map.setView([stall.latitude, stall.longitude], 18, { animate: true });
  }

  stallName.innerText = getDisplayedStallName(stall);
  stallAddress.innerText = getDisplayedStallAddress(stall);
  const descriptionText = getDisplayedStallDescription(stall);
  stallDescription.innerText = descriptionText || (langCode === 'vi'
    ? stall.originalHistory || ''
    : (trans.descUnavailable || ''));
  stallDistance.innerText = currentCoords ? `${Math.round(calculateHaversineDistance(currentCoords.lat, currentCoords.lon, stall.latitude, stall.longitude))}m` : '';
  if (showCard) {
    stallCard.classList.add('visible');
    stallCard.dataset.stallId = stall.id;
  }
  currentAudioUrl = resolveAudioUrl(stall.audioUrl);
  if (currentAudioUrl) {
    audioPlayer.src = currentAudioUrl;
    updatePlayButtonState(false);
    audioStatus.innerText = trans.audioStatusReady;
  } else {
    audioPlayer.src = '';
    updatePlayButtonState(false);
    audioStatus.innerText = trans.audioStatusNoAudio || 'No narration audio available.';
  }
}

function refreshSelectedStallCard() {
  if (!selectedStallId || !currentStallsCache.length) return;
  const stall = currentStallsCache.find(s => s.id === selectedStallId);
  if (!stall || !stallCard.classList.contains('visible')) return;

  const langCode = langPicker.value;
  const trans = getTrans(langCode);
  stallName.innerText = getDisplayedStallName(stall);
  stallAddress.innerText = getDisplayedStallAddress(stall);
  const descriptionText = getDisplayedStallDescription(stall);
  stallDescription.innerText = descriptionText || (langCode === 'vi'
    ? stall.originalHistory || ''
    : (trans.descUnavailable || ''));

  const fullAudioUrl = resolveAudioUrl(stall.audioUrl);
  if (fullAudioUrl) {
    audioPlayer.src = fullAudioUrl;
    updatePlayButtonState(false);
    audioStatus.innerText = trans.audioStatusReady;
  } else {
    audioPlayer.src = '';
    updatePlayButtonState(false);
    audioStatus.innerText = trans.audioStatusNoAudio || 'No narration audio available.';
  }
}

// Map clicked for GPS simulation
function onMapClicked(lat, lng) {
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;

  // Always allow simulation/mocking on map click (extremely useful for development)
  currentCoords = { lat, lon: lng };
  updateUserLocationMarker(lat, lng);
  gpsStatus.dataset.state = 'mock';
  gpsStatus.innerText = trans.gpsStatusMock(lat, lng);
  // Trigger proximity check and refresh stall list distances
  renderStallListCache();
  checkStallsProximity(lat, lng);
}

// Profile modal functions
function toggleProfileModal() {
  if (!profileModal) return;
  if (profileModal.style.display === 'none' || !profileModal.style.display) {
    // populate
    // Try to fetch authoritative profile from server first
    const token = localStorage.getItem('authToken');
    const serverUrl = getBackendServerUrl();
    const fallbackUsername = localStorage.getItem('username') || '-';
    const fallbackRole = localStorage.getItem('userRole') || '-';
    const fallbackUserId = localStorage.getItem('userId') || '-';
    const fallbackDevice = localStorage.getItem('deviceUniqueId') || localStorage.getItem('DeviceUniqueId') || deviceId || '-';
    const fallbackFullName = localStorage.getItem('fullName') || '';
    const fallbackEmail = localStorage.getItem('email') || '';
    const fallbackPhone = localStorage.getItem('phoneNumber') || '';

    // Populate fallbacks immediately
    if (profileUsername) profileUsername.innerText = fallbackUsername;
    if (profileRole) profileRole.innerText = fallbackRole;
    if (profileUserId) profileUserId.innerText = fallbackUserId;
    if (profileDevice) profileDevice.innerText = fallbackDevice;
    if (profileFullname) profileFullname.innerText = fallbackFullName;
    if (profileEmail) profileEmail.innerText = fallbackEmail;
    if (profilePhone) profilePhone.innerText = fallbackPhone;

    profileModal.style.display = 'block';

    if (token && serverUrl) {
      fetch(`${serverUrl}/api/auth/me`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(async r => {
        if (r.status === 401) {
          clearInvalidAuthSession();
          return null;
        }

        return r.ok ? r.json() : null;
      }).then(data => {
        if (!data) return;
        if (profileUsername) profileUsername.innerText = data.username || fallbackUsername;
        if (profileFullname) profileFullname.innerText = data.fullName || data.fullname || '';
        if (profileEmail) profileEmail.innerText = data.email || '';
        if (profilePhone) profilePhone.innerText = data.phoneNumber || data.phonenumber || '';
        if (profileRole) profileRole.innerText = data.role || fallbackRole;
        if (profileUserId) profileUserId.innerText = data.id || fallbackUserId;
        if (profileAvatarImg) profileAvatarImg.src = data.avatarUrl || '';
        localStorage.setItem('fullName', data.fullName || data.fullname || fallbackFullName);
        localStorage.setItem('email', data.email || fallbackEmail);
        localStorage.setItem('phoneNumber', data.phoneNumber || data.phonenumber || fallbackPhone);
      }).catch(err => console.warn('Failed to fetch /api/auth/me', err));
    }
  } else {
    profileModal.style.display = 'none';
  }
}

async function uploadAvatar() {
  const trans = getTrans();
  if (!profileAvatarInput || !profileAvatarInput.files || profileAvatarInput.files.length === 0) {
    alert(trans.profileSelectImageAlert);
    return;
  }
  const file = profileAvatarInput.files[0];
  const token = localStorage.getItem('authToken');
  const serverUrl = getBackendServerUrl();
  if (!token) { alert(trans.profileLoginRequiredAlert); return; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(`${serverUrl}/api/auth/upload-avatar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd
    });
    if (!res.ok) {
      const txt = await res.text();
      alert(trans.profileUploadFailed + txt);
      return;
    }
    const data = await res.json();
    if (data && data.avatarUrl) {
      const fullAvatarUrl = data.avatarUrl.startsWith('http') ? data.avatarUrl : serverUrl + data.avatarUrl;
      if (profileAvatarImg) profileAvatarImg.src = fullAvatarUrl;
      setProfileButtonLabel(trans.profileBtnLoggedIn, fullAvatarUrl);
      alert(trans.profileUploadSuccess);
    }
  } catch (err) {
    console.error('Upload failed', err);
    alert(trans.profileUploadError);
  }
}

async function fetchProfileIfLoggedIn() {
  const token = localStorage.getItem('authToken');
  const serverUrl = getBackendServerUrl();
  if (!token || !serverUrl) return;
  try {
    const res = await fetch(`${serverUrl}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.status === 401) {
      clearInvalidAuthSession();
      return;
    }

    if (!res.ok) return;
    const data = await res.json();
    if (!data) return;
    const trans = getTrans();
    const rawAvatar = data.avatarUrl || '';
    const avatar = (rawAvatar && !rawAvatar.startsWith('http')) ? serverUrl + rawAvatar : rawAvatar;

    setProfileButtonLabel(trans.profileBtnLoggedIn, avatar);
    showProfileBtn.style.display = 'inline-flex';
    if (profileAvatarImg && avatar) profileAvatarImg.src = avatar;
    if (profileFullname) profileFullname.innerText = data.fullName || data.fullname || localStorage.getItem('fullName') || '';
    if (profileEmail) profileEmail.innerText = data.email || localStorage.getItem('email') || '';
    if (profilePhone) profilePhone.innerText = data.phoneNumber || data.phonenumber || localStorage.getItem('phoneNumber') || '';
    localStorage.setItem('fullName', data.fullName || data.fullname || localStorage.getItem('fullName') || '');
    localStorage.setItem('email', data.email || localStorage.getItem('email') || '');
    localStorage.setItem('phoneNumber', data.phoneNumber || data.phonenumber || localStorage.getItem('phoneNumber') || '');

    // Hide logout for public device accounts
    const logoutBtn = document.getElementById('profile-logout-btn');
    const ownerLoginBtn = document.getElementById('profile-owner-login-btn');
    if (logoutBtn) logoutBtn.style.display = 'block';

  } catch (err) {
    console.warn('fetchProfileIfLoggedIn failed', err);
  }
}

function onLogout() {
  // Clear auth-related localStorage keys and reload
  localStorage.removeItem('authToken');
  localStorage.removeItem('userRole');
  localStorage.removeItem('username');
  localStorage.removeItem('userId');
  localStorage.removeItem('hasPaidAccess');
  window.location.reload();
}

function hasUnlockedAccess() {
  const role = String(localStorage.getItem('userRole') || '').toLowerCase();
  return role === 'admin' || role === 'owner' || localStorage.getItem('hasPaidAccess') === 'true';
}

function clearInvalidAuthSession() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('userRole');
  localStorage.removeItem('hasPaidAccess');
}

// Update User Location marker on map
function updateUserLocationMarker(lat, lng) {
  if (userLocationMarker) {
    userLocationMarker.setLatLng([lat, lng]);
  } else {
    const bluePulseIcon = L.divIcon({
      html: `<div class="user-pulse-marker"></div>`,
      className: 'custom-pin-icon',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    userLocationMarker = L.marker([lat, lng], { icon: bluePulseIcon }).addTo(map);
  }
  map.panTo([lat, lng]);
}

// Handle GPS Toggle switch
function onGpsToggle(e) {
  isGpsMockActive = e.target.checked;
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;

  if (isGpsMockActive) {
    gpsStatus.dataset.state = 'tracking';
    gpsStatus.innerText = trans.gpsStatusTracking;

    // Check if secure context for geolocation
    const isSecureContext = window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (!isSecureContext && window.location.protocol === 'http:') {
      const httpsWarning = {
        vi: "Định vị GPS thực tế yêu cầu kết nối bảo mật HTTPS khi chạy trên điện thoại di động.\n\nHãy dùng tính năng 'Mô phỏng đi bộ' hoặc truy cập qua HTTPS (ví dụ ngrok/localtunnel) để test GPS thực tế.",
        en: "Real GPS geolocation requires a secure HTTPS connection on mobile devices.\n\nPlease use the 'Simulate Walk' feature, or configure HTTPS (e.g. ngrok/localtunnel) to test real GPS.",
        ja: "モバイルデバイスで実際のGPSを使用するには、セキュアなHTTPS接続が必要です。\n\n『歩行シミュレート』機能を使用するか、HTTPS（例：ngrok/localtunnel）経由でアクセスしてください。",
        ko: "실제 GPS를 사용하려면 안전한 HTTPS 연결이 필요합니다.\n\n'걷기 시뮬레이션' 기능을 사용하거나 HTTPS(예: ngrok/localtunnel)를 설정하여 실제 GPS를 테스트하세요.",
        zh: "移动设备上的真实 GPS 定位需要安全的 HTTPS 连接。\n\n请使用“模拟步行”功能，或通过 HTTPS（如 ngrok/localtunnel）访问以测试真实 GPS。"
      };
      alert(httpsWarning[langCode] || httpsWarning.vi);
      gpsSwitch.checked = false;
      isGpsMockActive = false;
      gpsStatus.dataset.state = 'off';
      gpsStatus.innerText = trans.gpsStatusOff;
      return;
    }

    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        position => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          currentCoords = { lat, lon: lng };
          updateUserLocationMarker(lat, lng);
          gpsStatus.dataset.state = 'real';
          gpsStatus.innerText = trans.gpsStatusReal(lat, lng);
          renderStallListCache();
          checkStallsProximity(lat, lng);
        },
        err => {
          console.error('GPS tracking failed:', err);
          syncStatus.innerText = trans.gpsError;

          // Reset toggle switch state
          gpsSwitch.checked = false;
          isGpsMockActive = false;
          gpsStatus.dataset.state = 'off';
          gpsStatus.innerText = trans.gpsStatusOff;
          if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
          }
          if (userLocationMarker) {
            map.removeLayer(userLocationMarker);
            userLocationMarker = null;
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      syncStatus.innerText = trans.gpsNoSupport;
      gpsSwitch.checked = false;
      isGpsMockActive = false;
      gpsStatus.dataset.state = 'off';
      gpsStatus.innerText = trans.gpsStatusOff;
    }
  } else {
    gpsStatus.dataset.state = 'off';
    gpsStatus.innerText = trans.gpsStatusOff;
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (userLocationMarker) {
      map.removeLayer(userLocationMarker);
      userLocationMarker = null;
    }
    stallCard.classList.remove('visible');
    lastTriggeredStallId = null;
    audioPlayer.pause();
  }
}

function scheduleSyncRetry(delayMs = 12000) {
  if (syncRetryTimerId) {
    clearTimeout(syncRetryTimerId);
  }
  syncRetryTimerId = setTimeout(() => {
    syncRetryTimerId = null;
    onSync({ isRetry: true }).catch(err => console.warn('Auto sync retry failed', err));
  }, delayMs);
}

// Sync stalls and prefetch audio files
async function onSync(options = {}) {
  const { isRetry = false } = options;
  if (syncInProgress) return;

  const serverUrl = (getBackendServerUrl() || '').trim().replace(/\/$/, '');
  const langCode = langPicker.value;
  const trans = getTrans(langCode);
  if (!serverUrl) {
    alert(trans.serverUrlMissing || (langCode === 'vi' ? 'Không tìm thấy URL Server.' : 'Server URL not found.'));
    return;
  }

  if (!hasUnlockedAccess()) {
    syncStatus.style.color = '#FF3333';
    syncStatus.dataset.state = 'access';
    syncStatus.innerText = trans.syncRequiresAccess || 'Vui lòng đăng nhập và mở khóa quyền truy cập trước khi đồng bộ.';
    return;
  }

  syncInProgress = true;
  const requestUrl = `${serverUrl}/api/foodstalls/sync?lang=${langCode}`;
  console.log('Sync request URL:', requestUrl);
  syncStatus.style.color = '#FF7A00';
  syncStatus.dataset.state = 'running';
  syncStatus.innerText = isRetry ? (trans.syncStatusPartial?.(currentStallsCache.length, '...') || trans.syncStatusRunning) : trans.syncStatusRunning;

  if (selectedStallId && stallCard.classList.contains('visible')) {
    stallDescription.innerText = trans.descPlaceholder;
  }

  try {
    const response = await fetch(requestUrl);

    if (!response.ok) {
      const serverText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText} ${serverText ? '- ' + serverText : ''}`);
    }

    const responseData = await response.json();
    const pendingTranslations = Number(responseData.pendingTranslations || 0);
    const stalls = (responseData.stalls || []).map(item => ({
      id: item.id,
      name: item.name,
      address: item.address,
      latitude: item.latitude,
      longitude: item.longitude,
      originalHistory: item.originalHistory,
      translatedText: item.translation?.translatedText ?? (langCode === 'vi' ? item.originalHistory : ''),
      translatedName: item.translation?.translatedName ?? item.name,
      translatedAddress: item.translation?.translatedAddress ?? item.address,
      audioUrl: item.translation?.audioUrl ?? ''
    }));

    await db.clearAll();
    await db.saveStalls(stalls);
    await loadStallPins();

    if (pendingTranslations > 0) {
      syncStatus.style.color = '#FF7A00';
      syncStatus.dataset.state = 'partial';
      syncStatus.innerText = trans.syncStatusPartial
        ? trans.syncStatusPartial(stalls.length, pendingTranslations)
        : trans.syncStatusRunning;
      scheduleSyncRetry(12000);
    } else {
      if (syncRetryTimerId) {
        clearTimeout(syncRetryTimerId);
        syncRetryTimerId = null;
      }
      syncStatus.style.color = '#00FF66';
      syncStatus.dataset.state = 'success';
      syncStatus.innerText = trans.syncStatusSuccess(stalls.length);
    }

    if (selectedStallId) {
      const selectedStall = stalls.find(s => s.id === selectedStallId);
      if (selectedStall) {
        focusStallOnMap(selectedStallId, stalls);
      }
    }

    prefetchAudioFiles(stalls, serverUrl);
  } catch (err) {
    console.error('Sync failed:', err);
    syncStatus.style.color = '#FF3333';
    syncStatus.dataset.state = 'failed';
    syncStatus.innerText = `${trans.syncStatusFailed} (${err.message || err})`;
  } finally {
    syncInProgress = false;
  }
}
// Fetch all audio files to populate service worker cache for offline use
function prefetchAudioFiles(stalls, serverUrl) {
  // Use sequential fetching to avoid maxing out browser connection limits
  (async () => {
    for (const stall of stalls) {
      if (stall.audioUrl) {
        const fullAudioUrl = stall.audioUrl.startsWith('http')
          ? stall.audioUrl
          : `${serverUrl}${stall.audioUrl}`;

        try {
          const audioRes = await fetch(fullAudioUrl);
          if (audioRes.ok) {
            console.log(`Audio cached successfully for: ${stall.name}`);
          }
        } catch (err) {
          console.warn('Failed to pre-cache audio file for stall:', stall.name, err);
        }
      }
    }
  })();
}

// Calculate distances & check geofencing proximity
async function checkStallsProximity(userLat, userLon) {
  const stalls = await db.getStalls();
  const thresholdMeters = 20.0;

  let nearestStall = null;
  let minDistance = Infinity;

  stalls.forEach(stall => {
    const dist = calculateHaversineDistance(userLat, userLon, stall.latitude, stall.longitude);
    if (dist <= thresholdMeters && dist < minDistance) {
      minDistance = dist;
      nearestStall = stall;
    }
  });

  if (nearestStall) {
    // Show stall card details
    stallCard.dataset.stallId = nearestStall.id;
    stallName.innerText = getDisplayedStallName(nearestStall);
    stallAddress.innerText = getDisplayedStallAddress(nearestStall);
    stallDistance.innerText = `${Math.round(minDistance)}m`;
    const descriptionText = getDisplayedStallDescription(nearestStall);
    const langCode = langPicker.value;
    const trans = uiTranslations[langCode] || uiTranslations.vi;
    stallDescription.innerText = descriptionText || (langCode === 'vi'
      ? nearestStall.originalHistory || ''
      : (trans.descUnavailable || ''));
    stallCard.classList.add('visible');

    // Trigger audio narration if it's a new shop
    if (nearestStall.id !== lastTriggeredStallId) {
      lastTriggeredStallId = nearestStall.id;
      playNarrationAudio(nearestStall.audioUrl);
      sendStallVisitTelemetry('VISITED_STALL', nearestStall.id);
    }
  } else {
    // Hide card if not near any stall
    const langCode = langPicker.value;
    const trans = uiTranslations[langCode] || uiTranslations.vi;
    stallCard.classList.remove('visible');
    delete stallCard.dataset.stallId;
    lastTriggeredStallId = null;
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    currentAudioUrl = '';
    updatePlayButtonState(false);
    audioStatus.innerText = trans.audioStatusReady;
  }
}

// Toggle audio play/pause manually (user click)
function onToggleAudio() {
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;

  if (!audioPlayer.src && currentAudioUrl) {
    audioPlayer.src = currentAudioUrl;
  }

  if (!audioPlayer.src) {
    audioStatus.innerText = trans.audioStatusNoAudio;
    return;
  }

  if (audioPlayer.paused) {
    const activeStallId = getActiveStallId();
    if (activeStallId) {
      void recordUserAction(activeStallId, 'START_AUDIO');
    }
    audioPlayer.play()
      .then(() => {
        updatePlayButtonState(true);
        audioStatus.innerText = trans.audioStatusPlaying;
      })
      .catch(err => {
        console.error('Audio playback failed:', err);
        audioStatus.innerText = trans.audioStatusPlaybackError;
      });
  } else {
    audioPlayer.pause();
    updatePlayButtonState(false);
    audioStatus.innerText = trans.audioStatusPaused;
  }
}

function updatePlayButtonState(isPlaying) {
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;

  if (isPlaying) {
    playBtnIcon.innerText = '⏸';
    playBtnText.innerText = trans.pauseBtn;
  } else {
    playBtnIcon.innerText = '▶';
    playBtnText.innerText = trans.playBtn;
  }
}

function getActiveStallId() {
  return stallCard?.dataset?.stallId || lastTriggeredStallId || '';
}
// Play narration audio file (automatic proximity trigger)
function playNarrationAudio(audioUrl) {
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;

  if (!audioUrl) {
    currentAudioUrl = '';
    audioPlayer.removeAttribute('src');
    updatePlayButtonState(false);
    audioStatus.innerText = trans.audioStatusNoFile;
    return;
  }

  const fullAudioUrl = resolveAudioUrl(audioUrl);

  currentAudioUrl = fullAudioUrl;
  audioPlayer.src = fullAudioUrl;
  audioStatus.innerText = trans.audioStatusLoading;

  // Try to autoplay (might be blocked by mobile browser autoplay policies)
  audioPlayer.play()
    .then(() => {
      updatePlayButtonState(true);
      audioStatus.innerText = trans.audioStatusPlaying;
    })
    .catch(err => {
      console.warn('Autoplay blocked. User interaction required.', err);
      updatePlayButtonState(false);
      audioStatus.innerText = trans.audioStatusTapPlay;
    });
}

// Normalizes text for accent-insensitive Vietnamese search
function normalizeSearchText(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function getFilteredStalls() {
  const rawQuery = stallSearchInput?.value.trim() || '';
  const query = normalizeSearchText(rawQuery.toLowerCase());
  const mode = stallSearchType?.value || 'name';
  if (!query) return currentStallsCache;

  return currentStallsCache.filter(stall => {
    const nameText = normalizeSearchText((stall.name || '').toLowerCase());
    const addressText = normalizeSearchText((stall.address || '').toLowerCase());
    const descriptionText = normalizeSearchText(`${stall.originalHistory || ''} ${stall.translatedText || ''}`.toLowerCase());

    if (mode === 'type') {
      return nameText.includes(query) || descriptionText.includes(query) || addressText.includes(query);
    }

    return nameText.includes(query) || addressText.includes(query) || descriptionText.includes(query);
  });
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000.0; // Earth radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees) {
  return degrees * Math.PI / 180.0;
}

// AI Chatbot Logic (Online Mode)
async function onSendChat() {
  const question = chatInput.value.trim();
  if (!question) return;

  chatInput.value = '';

  // Append user bubble
  addChatBubble(question, 'user');

  const serverUrl = getBackendServerUrl();
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;
  if (!serverUrl) {
    addChatBubble(trans.chatErrorNoServer, 'ai');
    return;
  }

  // Append loader bubble
  const loader = addChatBubble(trans.chatThinking, 'ai loader');

  // Add coordinate context if available
  let lat = null, lon = null;
  if (currentCoords) {
    lat = currentCoords.lat;
    lon = currentCoords.lon;
  }

  try {
    const response = await fetch(`${serverUrl}/api/chat/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deviceUniqueId: deviceId,
        question: question,
        latitude: lat,
        longitude: lon,
        languageCode: langCode
      })
    });

    // Remove loader
    loader.remove();

    if (response.ok) {
      const data = await response.json();
      addChatBubble(data.answer || trans.chatNoResponse, 'ai');
    } else {
      addChatBubble(`${trans.chatServerConnectionError}${response.status}`, 'ai');
    }

  } catch (err) {
    loader.remove();
    console.error('Chat AI failed:', err);
    addChatBubble(trans.chatUnableConnect, 'ai');
  }
}

function addChatBubble(text, className) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${className}`;
  bubble.innerText = text;
  chatLog.appendChild(bubble);

  // Auto scroll
  chatLog.scrollTop = chatLog.scrollHeight;
  return bubble;
}

// Toggle walking simulation along Vĩnh Khánh street
function toggleSimulationWalk() {
  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;

  if (simIntervalId) {
    // Stop simulation
    clearInterval(simIntervalId);
    simIntervalId = null;
    simWalkBtn.innerText = trans.simWalkStart;
    simWalkBtn.style.background = '#10B981';

    // Clean up user marker
    if (userLocationMarker) {
      map.removeLayer(userLocationMarker);
      userLocationMarker = null;
    }
    stallCard.classList.remove('visible');
    lastTriggeredStallId = null;
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    currentAudioUrl = '';
    updatePlayButtonState(false);
    audioStatus.innerText = trans.audioStatusReady;
  } else {
    // Start simulation
    // Turn off real GPS switch if active
    if (gpsSwitch.checked) {
      gpsSwitch.checked = false;
      onGpsToggle({ target: gpsSwitch });
    }

    // Build a dynamic simulation route from locally cached stalls.
    simulationRoutePoints = buildSimulationRoute();
    if (simulationRoutePoints.length === 0) {
      simulationRoutePoints = [...fallbackSimulatedRoute];
    }

    simRouteIndex = 0;
    simWalkBtn.innerText = trans.simWalkStop;
    simWalkBtn.style.background = '#EF4444'; // Red color when active

    runSimStep(); // Run first step immediately

    simIntervalId = setInterval(() => {
      simRouteIndex++;
      if (simRouteIndex >= simulationRoutePoints.length) {
        simRouteIndex = 0; // Loop back to start
      }
      runSimStep();
    }, 5000); // 5 seconds per step
  }
}

function buildSimulationRoute() {
  if (!currentStallsCache || currentStallsCache.length === 0) {
    return [];
  }

  // Use a center-based angular sort to create a loop-like walking path through all available stalls
  const center = currentStallsCache.reduce((acc, stall) => {
    acc.lat += stall.latitude;
    acc.lng += stall.longitude;
    return acc;
  }, { lat: 0, lng: 0 });
  center.lat /= currentStallsCache.length;
  center.lng /= currentStallsCache.length;

  return currentStallsCache
    .map(stall => ({
      lat: stall.latitude,
      lng: stall.longitude,
      stallId: stall.id
    }))
    .sort((a, b) => {
      const angleA = Math.atan2(a.lat - center.lat, a.lng - center.lng);
      const angleB = Math.atan2(b.lat - center.lat, b.lng - center.lng);
      return angleA - angleB;
    });
}

function runSimStep() {
  const point = simulationRoutePoints[simRouteIndex] || fallbackSimulatedRoute[simRouteIndex];
  if (!point) return;
  const lat = point.lat;
  const lng = point.lng;
  currentCoords = { lat, lon: lng };
  updateUserLocationMarker(lat, lng);

  const langCode = langPicker.value;
  const trans = uiTranslations[langCode] || uiTranslations.vi;
  const totalSteps = simulationRoutePoints.length > 0 ? simulationRoutePoints.length : fallbackSimulatedRoute.length;
  gpsStatus.dataset.state = 'mock';
  gpsStatus.innerText = `${trans.gpsStatusMock(lat, lng)} ${trans.simWalkStep(simRouteIndex + 1, totalSteps)}`;
  // Trigger proximity check
  checkStallsProximity(lat, lng);
}

// --- Menu Modal & Visit Telemetry Logic ---

function showMenuModalMessage(message) {
  if (!menuModal || !menuModalMessage || !menuImagesContainer) return;
  menuImagesContainer.innerHTML = '';
  menuModalMessage.innerText = message;
  menuModal.style.display = 'flex';
}

function renderMenuImages(images) {
  if (!menuImagesContainer || !menuModalMessage) return;
  menuImagesContainer.innerHTML = '';
  const indicators = document.getElementById('menu-carousel-indicators');
  if (indicators) indicators.innerHTML = '';
  if (!Array.isArray(images) || images.length === 0) {
    menuModalMessage.innerText = 'Quán này chưa cập nhật menu.';
    return;
  }

  menuModalMessage.innerText = '';
  // Build slides
  images.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'menu-image-item';

    const image = document.createElement('img');
    image.src = url;
    image.alt = `Menu image ${idx + 1}`;
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.style.opacity = '0.5'; });

    item.appendChild(image);
    menuImagesContainer.appendChild(item);

    // indicator
    if (indicators) {
      const btn = document.createElement('button');
      btn.dataset.index = String(idx);
      btn.addEventListener('click', () => showSlide(idx));
      indicators.appendChild(btn);
    }
  });

  // Initialize carousel state
  currentCarouselIndex = 0;
  updateCarousel();
}

async function openMenuModal(activeStallId) {
  if (!activeStallId) {
    showMenuModalMessage('Không tìm thấy quán hiện tại.');
    return;
  }

  const serverUrl = getBackendServerUrl().replace(/\/+$/, '');
  const url = `${serverUrl}/api/foodstalls/${activeStallId}/menu`;

  console.debug('openMenuModal fetch url', url);
  showMenuModalMessage('Đang tải menu...');

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      showMenuModalMessage('Không thể tải menu. Vui lòng thử lại.');
      console.error('Menu load failed:', errorText);
      return;
    }

    const imageUrls = await response.json();
    renderMenuImages(imageUrls);
    if (menuModal) menuModal.style.display = 'flex';
    attachCarouselHandlers();
  } catch (error) {
    showMenuModalMessage('Lỗi kết nối. Vui lòng kiểm tra mạng.');
    console.error(error);
  }
}

// Carousel state & helpers
let currentCarouselIndex = 0;
function updateCarousel() {
  const slides = document.querySelectorAll('.menu-slides .menu-image-item');
  const indicators = document.querySelectorAll('.carousel-indicators button');
  const slidesContainer = document.querySelector('.menu-slides');
  if (!slidesContainer || slides.length === 0) return;
  const w = slidesContainer.clientWidth;
  slidesContainer.style.transform = `translateX(-${currentCarouselIndex * w}px)`;
  indicators.forEach((b, i) => b.classList.toggle('active', i === currentCarouselIndex));
}

function showSlide(index) {
  const slides = document.querySelectorAll('.menu-slides .menu-image-item');
  if (!slides || slides.length === 0) return;
  currentCarouselIndex = Math.max(0, Math.min(index, slides.length - 1));
  updateCarousel();
}

function attachCarouselHandlers() {
  const prev = document.getElementById('menu-prev');
  const next = document.getElementById('menu-next');
  if (prev) prev.onclick = () => showSlide(currentCarouselIndex - 1);
  if (next) next.onclick = () => showSlide(currentCarouselIndex + 1);

  const viewport = document.querySelector('.menu-viewport');
  if (viewport) {
    let startX = 0;
    viewport.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    viewport.addEventListener('touchend', (e) => {
      const endX = e.changedTouches[0].clientX;
      if (endX - startX > 40) showSlide(currentCarouselIndex - 1);
      else if (startX - endX > 40) showSlide(currentCarouselIndex + 1);
    }, { passive: true });
  }

  window.addEventListener('keydown', carouselKeyHandler);
}

function carouselKeyHandler(e) {
  if (!menuModal || menuModal.style.display !== 'flex') return;
  if (e.key === 'ArrowLeft') showSlide(currentCarouselIndex - 1);
  if (e.key === 'ArrowRight') showSlide(currentCarouselIndex + 1);
  if (e.key === 'Escape') { if (menuModal) menuModal.style.display = 'none'; }
}

async function recordUserAction(foodStallId, actionType) {
  if (!foodStallId || !actionType) return null;

  const serverUrl = getBackendServerUrl().replace(/\/$/, '');
  if (!serverUrl) return null;

  const token = localStorage.getItem('authToken');
  if (!token) return null;

  const coords = currentCoords;
  if (!coords) return null;

  try {
    const response = await fetch(`${serverUrl}/api/visits/record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        foodStallId,
        actionType,
        userLat: coords.lat,
        userLng: coords.lon
      })
    });

    if (!response.ok) {
      console.warn('Visit record rejected:', await response.text().catch(() => ''));
      return null;
    }
    return await response.json();
  } catch (err) {
    console.warn('Visit record failed:', err);
    return null;
  }
}


// --- Splash Intro Logic ---
const runSplashIntro = () => {
  console.log('runSplashIntro called');
  const splash = document.getElementById('splash-intro');
  console.log('splash element found:', splash);
  if (splash) {
    setTimeout(() => {
      console.log('Initiating splash fade out...');
      splash.style.opacity = '0';
      splash.style.visibility = 'hidden';
      setTimeout(() => {
        console.log('Removing splash screen from DOM.');
        splash.remove();
      }, 800);
    }, 2800);
  }
};
if (document.readyState === 'loading') {
  console.log('Document still loading, registering DOMContentLoaded listener for splash.');
  document.addEventListener('DOMContentLoaded', runSplashIntro);
} else {
  console.log('Document already loaded, running splash intro immediately.');
  runSplashIntro();
}

// ==============================================================
// MOBILE PWA UI LOGIC
// ==============================================================
const runMobilePwaUiLogic = () => {
  const navItems = document.querySelectorAll('.mobile-bottom-nav .nav-item');
  const stallPanel = document.querySelector('.stall-panel');
  const chatPanel = document.querySelector('.chat-panel');
  const stallCard = document.getElementById('stall-card');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't handle profile here, it's handled by the profile modal logic
      if (item.dataset.view === 'profile') return;

      // Update active state
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      const view = item.dataset.view;

      if (view === 'map') {
        stallPanel.classList.remove('mobile-active');
        chatPanel.classList.remove('mobile-active');
      } else if (view === 'list') {
        stallPanel.classList.add('mobile-active');
        chatPanel.classList.remove('mobile-active');
        if (stallCard) stallCard.style.display = 'none';
      } else if (view === 'ai') {
        chatPanel.classList.add('mobile-active');
        stallPanel.classList.remove('mobile-active');
        if (stallCard) stallCard.style.display = 'none';
      }
    });
  });

  // FABs Logic
  const mobileGpsBtn = document.getElementById('mobile-gps-btn');
  const mobileSyncBtn = document.getElementById('mobile-sync-btn');
  const realGpsSwitch = document.getElementById('gps-switch');
  const realSyncBtn = document.getElementById('sync-btn');

  if (mobileGpsBtn && realGpsSwitch) {
    mobileGpsBtn.addEventListener('click', () => {
      realGpsSwitch.click();
      mobileGpsBtn.style.color = realGpsSwitch.checked ? '#10B981' : '#fff';
    });
  }

  if (mobileSyncBtn && realSyncBtn) {
    mobileSyncBtn.addEventListener('click', () => {
      realSyncBtn.click();
      mobileSyncBtn.style.transform = 'rotate(180deg)';
      setTimeout(() => mobileSyncBtn.style.transform = 'rotate(0deg)', 500);
    });
  }

  // Hook into existing profile button
  const mobileProfileBtn = document.getElementById('nav-profile-btn');
  const realProfileBtn = document.getElementById('show-profile-btn');
  if (mobileProfileBtn && realProfileBtn) {
    mobileProfileBtn.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      mobileProfileBtn.classList.add('active');
      realProfileBtn.click();

      // Remove panels to show map behind modal
      stallPanel.classList.remove('mobile-active');
      chatPanel.classList.remove('mobile-active');
    });
  }
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runMobilePwaUiLogic);
} else {
  runMobilePwaUiLogic();
}
