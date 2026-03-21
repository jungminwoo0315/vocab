/* =========================
   Firebase (Auth + Firestore)
========================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAURdJnmzETZGjUC0z4OKXrsihbWZBdJTs",
  authDomain: "minwoo-vocab.firebaseapp.com",
  projectId: "minwoo-vocab",
  storageBucket: "minwoo-vocab.firebasestorage.app",
  messagingSenderId: "377857009776",
  appId: "1:377857009776:web:0cd2230154d05916e76cb5",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const ARCHIVE_THRESHOLD = 20;

/* =========================
   Language config
========================= */
const LANGUAGE_CONFIG = {
  english: {
    key: "english",
    label: "영어",
    collectionName: "items",
    usesReading: false,
    wordLabel: "단어",
    readingLabel: "",
    readingDisplayLabel: "",
    createTitle: "영어 단어 생성",
    homeInfo: "영어 단어장을 사용합니다.",
    listTitle: "영어 단어장",
    archiveTitle: "영어 아카이브",
    quizTitle: "영어 퀴즈",
    searchPlaceholder: "검색 (단어/예문)...",
    quizAnswerPlaceholder: "영어 단어 입력 후 Enter",
  },
  chinese: {
    key: "chinese",
    label: "중국어",
    collectionName: "chineseItems",
    usesReading: true,
    wordLabel: "한자",
    readingLabel: "병음",
    readingDisplayLabel: "병음",
    createTitle: "중국어 단어 생성",
    homeInfo: "중국어 단어장을 사용합니다.",
    listTitle: "중국어 단어장",
    archiveTitle: "중국어 아카이브",
    quizTitle: "중국어 퀴즈",
    searchPlaceholder: "검색 (한자/병음/예문)...",
    quizAnswerPlaceholder: "병음 입력 후 Enter (공백 없이)",
  },
  japanese: {
    key: "japanese",
    label: "일본어",
    collectionName: "japaneseItems",
    usesReading: true,
    wordLabel: "단어",
    readingLabel: "가나",
    readingDisplayLabel: "가나",
    createTitle: "일본어 단어 생성",
    homeInfo: "일본어 단어장을 사용합니다.",
    listTitle: "일본어 단어장",
    archiveTitle: "일본어 아카이브",
    quizTitle: "일본어 퀴즈",
    searchPlaceholder: "검색 (단어/가나/예문)...",
    quizAnswerPlaceholder: "가나 입력 후 Enter (공백 없이)",
  },
};

let currentLanguage = null;

/* =========================
   In-memory cache (real-time)
========================= */
let currentUid = null;
let itemsCache = [];
let unsubItems = null;

/* =========================
   Create / Edit state
========================= */
let createState = {
  step: "word",
  word: "",
  reading: "",
};

let editMode = {
  isEditing: false,
  itemId: null,
  originalCorrectCount: 0,
  originalCreatedAt: null,
  originalWord: "",
  originalReading: "",
  originalSentence: "",
};

/* =========================
   Small UI: auth buttons (injected)
========================= */
function ensureAuthUI() {
  const headerRight =
    document.querySelector(".topRight") ||
    document.getElementById("headerRight") ||
    document.querySelector("header") ||
    document.body;

  let wrap = document.getElementById("authWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "authWrap";
    wrap.style.position = "fixed";
    wrap.style.top = "14px";
    wrap.style.right = "14px";
    wrap.style.zIndex = "9999";
    wrap.style.display = "flex";
    wrap.style.gap = "8px";
    wrap.style.flexWrap = "wrap";
    wrap.style.alignItems = "center";
    headerRight.appendChild(wrap);
  }

  let loginBtn = document.getElementById("loginBtn");
  if (!loginBtn) {
    loginBtn = document.createElement("button");
    loginBtn.id = "loginBtn";
    loginBtn.textContent = "Google 로그인";
    loginBtn.className = "smallBtn";
    loginBtn.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        alert("로그인 실패: " + (e?.message ?? e));
      }
    });
    wrap.appendChild(loginBtn);
  }

  let logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn) {
    logoutBtn = document.createElement("button");
    logoutBtn.id = "logoutBtn";
    logoutBtn.textContent = "로그아웃";
    logoutBtn.className = "smallBtn";
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
    });
    wrap.appendChild(logoutBtn);
  }

  let userLabel = document.getElementById("userLabel");
  if (!userLabel) {
    userLabel = document.createElement("div");
    userLabel.id = "userLabel";
    userLabel.style.fontSize = "12px";
    userLabel.style.opacity = "0.8";
    userLabel.style.alignSelf = "center";
    wrap.appendChild(userLabel);
  }

  return { loginBtn, logoutBtn, userLabel };
}

const authUI = ensureAuthUI();

/* =========================
   Firestore helpers
========================= */
function getLangConfig() {
  return LANGUAGE_CONFIG[currentLanguage] ?? null;
}

function itemsCol(uid) {
  const cfg = getLangConfig();
  if (!cfg) throw new Error("Language not selected");
  return collection(db, "users", uid, cfg.collectionName);
}

async function fsAddItem(payload) {
  if (!currentUid) throw new Error("Not signed in");
  const cfg = getLangConfig();
  if (!cfg) throw new Error("Language not selected");

  if (cfg.usesReading) {
    await addDoc(itemsCol(currentUid), {
      word: payload.word.trim(),
      reading: payload.reading.trim(),
      sentence: payload.sentence.trim(),
      correctCount: 0,
      createdAt: serverTimestamp(),
    });
    return;
  }

  await addDoc(itemsCol(currentUid), {
    word: payload.word.trim(),
    sentence: payload.sentence.trim(),
    correctCount: 0,
    createdAt: serverTimestamp(),
  });
}

async function fsDeleteItem(id) {
  if (!currentUid) throw new Error("Not signed in");
  await deleteDoc(doc(db, "users", currentUid, getLangConfig().collectionName, id));
}

async function fsClearAll() {
  if (!currentUid) throw new Error("Not signed in");
  const snap = await getDocs(itemsCol(currentUid));
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

async function fsIncCorrect(id) {
  if (!currentUid) throw new Error("Not signed in");
  await updateDoc(doc(db, "users", currentUid, getLangConfig().collectionName, id), {
    correctCount: increment(1),
  });
}

async function fsUpdateItem(id, payload) {
  if (!currentUid) throw new Error("Not signed in");
  const cfg = getLangConfig();

  if (cfg.usesReading) {
    await updateDoc(doc(db, "users", currentUid, cfg.collectionName, id), {
      word: payload.word.trim(),
      reading: payload.reading.trim(),
      sentence: payload.sentence.trim(),
    });
    return;
  }

  await updateDoc(doc(db, "users", currentUid, cfg.collectionName, id), {
    word: payload.word.trim(),
    sentence: payload.sentence.trim(),
  });
}

function subscribeItems(uid) {
  if (!currentLanguage) {
    if (unsubItems) unsubItems();
    unsubItems = null;
    itemsCache = [];
    return;
  }

  if (unsubItems) unsubItems();
  itemsCache = [];

  const qy = query(itemsCol(uid), orderBy("createdAt", "desc"));
  unsubItems = onSnapshot(
    qy,
    (snap) => {
      const cfg = getLangConfig();

      itemsCache = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          word: String(data.word ?? "").trim(),
          reading: cfg?.usesReading ? String(data.reading ?? "").trim() : "",
          sentence: String(data.sentence ?? "").trim(),
          correctCount: Number.isFinite(data.correctCount) ? data.correctCount : 0,
          createdAt: data.createdAt ?? null,
        };
      });

      try {
        if (!screens.list.classList.contains("hidden")) renderList();
        if (!screens.archive.classList.contains("hidden")) renderArchive();
        if (!screens.quiz.classList.contains("hidden")) refreshQuizMeta();
      } catch {}
    },
    (err) => {
      console.error(err);
      alert("Firestore 구독 에러: " + (err?.message ?? err));
    }
  );
}

/* =========================
   Original UI / Screens
========================= */
const screens = {
  languageSelect: document.getElementById("languageSelect"),
  home: document.getElementById("home"),
  create: document.getElementById("create"),
  list: document.getElementById("list"),
  archive: document.getElementById("archive"),
  quiz: document.getElementById("quiz"),
};

const backBtn = document.getElementById("backBtn");
const screenTitle = document.getElementById("screenTitle");
const screenSub = document.getElementById("screenSub");
const languageHomeInfo = document.getElementById("languageHomeInfo");

const createTitle = document.getElementById("createTitle");
const createTopGuide = document.getElementById("createTopGuide");

const listTitle = document.getElementById("listTitle");
const archiveTitle = document.getElementById("archiveTitle");
const quizTitle = document.getElementById("quizTitle");

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle("hidden", k !== name);
  });

  const inLanguageSelect = name === "languageSelect";
  backBtn.classList.toggle("hidden", inLanguageSelect);

  const cfg = getLangConfig();

  if (name === "languageSelect") {
    screenTitle.textContent = "내 단어장";
    screenSub.textContent = currentUid ? "원하는 언어를 선택하세요" : "먼저 Google 로그인을 해주세요";
    return;
  }

  if (!cfg) {
    screenTitle.textContent = "내 단어장";
    screenSub.textContent = "언어를 선택하세요";
    return;
  }

  if (name === "home") {
    screenTitle.textContent = `${cfg.label} 단어장`;
    screenSub.textContent = currentUid ? "원하는 기능을 선택하세요" : "먼저 Google 로그인을 해주세요";
    languageHomeInfo.textContent = cfg.homeInfo;
  } else if (name === "create") {
    screenTitle.textContent = editMode.isEditing ? `${cfg.label} 단어 수정` : cfg.createTitle;
    screenSub.textContent = editMode.isEditing ? "단계별로 수정 후 Enter" : "단계별로 입력 후 Enter";
    createTitle.textContent = editMode.isEditing ? `${cfg.label} 단어 수정` : cfg.createTitle;
    createTopGuide.textContent = cfg.usesReading
      ? "Enter로 다음 단계로 넘어가요. (단어 → " + cfg.readingLabel + " → 예문)"
      : "Enter로 다음 단계로 넘어가요. (단어 → 예문)";
  } else if (name === "list") {
    screenTitle.textContent = cfg.listTitle;
    screenSub.textContent = cfg.usesReading
      ? `${cfg.wordLabel}/${cfg.readingLabel}/예문 + 정답 횟수`
      : "단어/예문 + 정답 횟수";
    listTitle.textContent = cfg.listTitle;
  } else if (name === "archive") {
    screenTitle.textContent = cfg.archiveTitle;
    screenSub.textContent = `정답 ${ARCHIVE_THRESHOLD}번 이상인 단어`;
    archiveTitle.textContent = cfg.archiveTitle;
  } else if (name === "quiz") {
    screenTitle.textContent = cfg.quizTitle;
    screenSub.textContent = cfg.usesReading
      ? `예문의 빈칸을 보고 ${cfg.readingLabel}을 맞히기`
      : "예문에서 단어를 블랭크로 맞히기";
    quizTitle.textContent = cfg.quizTitle;
  }

  syncScreenTexts();
}

function goBack() {
  resetQuizUI();
  exitEditMode();

  const visibleScreen =
    Object.entries(screens).find(([, el]) => !el.classList.contains("hidden"))?.[0] ?? "languageSelect";

  if (visibleScreen === "home") {
    currentLanguage = null;
    if (unsubItems) unsubItems();
    unsubItems = null;
    itemsCache = [];
    showScreen("languageSelect");
    return;
  }

  if (["create", "list", "archive", "quiz"].includes(visibleScreen)) {
    showScreen("home");
    return;
  }

  showScreen("languageSelect");
}

backBtn.addEventListener("click", goBack);

/* =========================
   Language select
========================= */
document.getElementById("goEnglish").addEventListener("click", () => selectLanguage("english"));
document.getElementById("goChinese").addEventListener("click", () => selectLanguage("chinese"));
document.getElementById("goJapanese").addEventListener("click", () => selectLanguage("japanese"));

function selectLanguage(langKey) {
  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");

  currentLanguage = langKey;
  exitEditMode();
  resetQuizUI();

  subscribeItems(currentUid);
  showScreen("home");
}

/* =========================
   Home navigation
========================= */
document.getElementById("goCreate").addEventListener("click", () => {
  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");
  if (!currentLanguage) return alert("먼저 언어를 선택해주세요.");

  exitEditMode();
  showScreen("create");
  startCreateFlow();
});

document.getElementById("goList").addEventListener("click", () => {
  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");
  if (!currentLanguage) return alert("먼저 언어를 선택해주세요.");

  resetQuizUI();
  exitEditMode();
  showScreen("list");
  renderList();
  document.getElementById("search").focus();
});

document.getElementById("goQuiz").addEventListener("click", () => {
  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");
  if (!currentLanguage) return alert("먼저 언어를 선택해주세요.");

  resetQuizUI();
  exitEditMode();
  showScreen("quiz");
  startQuiz();
});

/* =========================
   CREATE / EDIT flow
========================= */
const createPrompt = document.getElementById("createPrompt");
const createInput = document.getElementById("createInput");
const createHelper = document.getElementById("createHelper");
const createReset = document.getElementById("createReset");

function syncScreenTexts() {
  const cfg = getLangConfig();
  if (!cfg) return;

  document.getElementById("search").placeholder = cfg.searchPlaceholder;
  document.getElementById("archiveSearch").placeholder = cfg.searchPlaceholder;
  document.getElementById("qAnswer").placeholder = cfg.quizAnswerPlaceholder;
}

function startCreateFlow() {
  createState = { step: "word", word: "", reading: "" };
  updateCreateUIForStep();
  showScreen("create");
  setTimeout(() => createInput.focus(), 0);
}

function enterEditMode(item) {
  editMode = {
    isEditing: true,
    itemId: item.id,
    originalCorrectCount: item.correctCount ?? 0,
    originalCreatedAt: item.createdAt ?? null,
    originalWord: item.word ?? "",
    originalReading: item.reading ?? "",
    originalSentence: item.sentence ?? "",
  };

  createState = {
    step: "word",
    word: "",
    reading: "",
  };

  showScreen("create");
  updateCreateUIForStep();
  createInput.value = item.word ?? "";
  createHelper.textContent = "수정 후 Enter를 누르세요.";
  createHelper.style.color = "";
  setTimeout(() => createInput.focus(), 0);
}

function exitEditMode() {
  editMode = {
    isEditing: false,
    itemId: null,
    originalCorrectCount: 0,
    originalCreatedAt: null,
    originalWord: "",
    originalReading: "",
    originalSentence: "",
  };
}

function updateCreateUIForStep() {
  const cfg = getLangConfig();
  if (!cfg) return;

  createHelper.style.color = "";

  if (createState.step === "word") {
    createPrompt.textContent = editMode.isEditing
      ? `수정할 ${cfg.wordLabel}를 입력하세요`
      : `${cfg.wordLabel}를 입력하세요`;

    createInput.placeholder =
      currentLanguage === "english"
        ? "예: resilient"
        : currentLanguage === "chinese"
        ? "예: 坚强"
        : "예: 勉強";

    createHelper.textContent = editMode.isEditing
      ? `${cfg.wordLabel}를 수정한 뒤 Enter를 누르세요.`
      : `${cfg.wordLabel}를 입력하고 Enter를 누르세요.`;

    return;
  }

  if (createState.step === "reading") {
    createPrompt.textContent = `${cfg.readingLabel}을 입력하세요 (${cfg.wordLabel}: ${createState.word})`;
    createInput.placeholder =
      currentLanguage === "chinese" ? "예: jian1qiang2 (공백 없이)" : "예: べんきょう (공백 없이)";
    createHelper.textContent = `${cfg.readingLabel}은 공백 없이 입력하세요.`;
    return;
  }

  if (createState.step === "sentence") {
    createPrompt.textContent = `예문을 입력하세요 (${cfg.wordLabel}: ${createState.word})`;
    createInput.placeholder =
      currentLanguage === "english"
        ? "예: She is resilient even under pressure."
        : currentLanguage === "chinese"
        ? "예: 她是一个很坚强的人。"
        : "예: 毎日日本語を勉強しています。";

    createHelper.textContent = cfg.usesReading
      ? `예문에는 최초 입력한 ${cfg.wordLabel}가 반드시 포함되어야 합니다.`
      : "예문을 입력하고 Enter를 누르면 저장됩니다.";
  }
}

createReset.addEventListener("click", () => {
  if (editMode.isEditing) {
    createState = { step: "word", word: "", reading: "" };
    updateCreateUIForStep();
    createInput.value = editMode.originalWord || "";
    createHelper.textContent = "수정할 값을 다시 입력해 주세요.";
    createInput.focus();
    return;
  }

  startCreateFlow();
});

createInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();

  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");
  if (!currentLanguage) return alert("먼저 언어를 선택해주세요.");

  const cfg = getLangConfig();
  const rawVal = createInput.value;
  const val = rawVal.trim();
  if (!val) return;

  if (createState.step === "word") {
    createState.word = val;

    if (cfg.usesReading) {
      createState.step = "reading";
      updateCreateUIForStep();
      createInput.value = editMode.isEditing ? editMode.originalReading || "" : "";
      createInput.focus();
      return;
    }

    createState.step = "sentence";
    updateCreateUIForStep();
    createInput.value = editMode.isEditing ? editMode.originalSentence || "" : "";
    createInput.focus();
    return;
  }

  if (createState.step === "reading") {
    if (/\s/.test(val)) {
      createHelper.textContent = `⚠️ ${cfg.readingLabel}은 공백 없이 입력해야 합니다.`;
      createHelper.style.color = "red";
      return;
    }

    createState.reading =
      currentLanguage === "chinese"
        ? normalizeChineseReading(val)
        : normalizeJapaneseReading(val);

    createState.step = "sentence";
    updateCreateUIForStep();
    createInput.value = editMode.isEditing ? editMode.originalSentence || "" : "";
    createInput.focus();
    return;
  }

  if (createState.step === "sentence") {
    const sentenceVal = val;
    const wordVal = createState.word;
    const readingVal = createState.reading;

    const containsWord = sentenceIncludesWordByLanguage(sentenceVal, wordVal);
    if (!containsWord) {
      createHelper.textContent =
        `⚠️ 오타예요! 예문에 최초 입력한 ${cfg.wordLabel}가 정확히 포함되어 있어야 합니다.`;
      createHelper.style.color = "red";
      return;
    }

    createHelper.style.color = "";

    try {
      if (editMode.isEditing && editMode.itemId) {
        await fsUpdateItem(editMode.itemId, {
          word: wordVal,
          reading: readingVal,
          sentence: sentenceVal,
        });
        createHelper.textContent = `수정됨 ✅ (${wordVal})`;
      } else {
        await fsAddItem({
          word: wordVal,
          reading: readingVal,
          sentence: sentenceVal,
        });
        createHelper.textContent = `저장됨 ✅ (${wordVal})`;
      }
    } catch (err) {
      alert((editMode.isEditing ? "수정 실패: " : "저장 실패: ") + (err?.message ?? err));
      return;
    }

    const wasEditing = editMode.isEditing;

    createState = { step: "word", word: "", reading: "" };

    if (wasEditing) {
      exitEditMode();
      showScreen("list");
      renderList();
      return;
    }

    updateCreateUIForStep();
    createInput.value = "";
    createInput.focus();
  }
});

/* =========================
   LIST / ARCHIVE
========================= */
const listWrap = document.getElementById("listWrap");
const listEmpty = document.getElementById("listEmpty");
const searchInput = document.getElementById("search");
const clearAllBtn = document.getElementById("clearAll");
const listCount = document.getElementById("listCount");
const sortSelect = document.getElementById("sortSelect");
const goArchiveBtn = document.getElementById("goArchive");

const archiveWrap = document.getElementById("archiveWrap");
const archiveEmpty = document.getElementById("archiveEmpty");
const archiveSearchInput = document.getElementById("archiveSearch");
const archiveCount = document.getElementById("archiveCount");
const archiveSortSelect = document.getElementById("archiveSortSelect");

goArchiveBtn.addEventListener("click", () => {
  showScreen("archive");
  renderArchive();
});

searchInput.addEventListener("input", renderList);
sortSelect.addEventListener("change", renderList);
archiveSearchInput.addEventListener("input", renderArchive);
archiveSortSelect.addEventListener("change", renderArchive);

clearAllBtn.addEventListener("click", async () => {
  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");
  if (!currentLanguage) return alert("먼저 언어를 선택해주세요.");

  const ok = confirm(`정말 ${getLangConfig().label} 단어장을 전체 삭제할까요? (되돌릴 수 없음)`);
  if (!ok) return;

  try {
    await fsClearAll();
  } catch (err) {
    alert("전체 삭제 실패: " + (err?.message ?? err));
  }
});

function getSortedItems(items, sortValue) {
  const copied = [...items];

  if (sortValue === "alphaAsc") {
    copied.sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: "base" }));
    return copied;
  }

  if (sortValue === "correctDesc") {
    copied.sort((a, b) => {
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      return a.word.localeCompare(b.word, undefined, { sensitivity: "base" });
    });
    return copied;
  }

  copied.sort((a, b) => {
    const aSec = getCreatedAtSeconds(a.createdAt);
    const bSec = getCreatedAtSeconds(b.createdAt);
    return bSec - aSec;
  });
  return copied;
}

function getCreatedAtSeconds(createdAt) {
  if (!createdAt) return 0;
  if (typeof createdAt.seconds === "number") return createdAt.seconds;
  if (typeof createdAt.toMillis === "function") return Math.floor(createdAt.toMillis() / 1000);
  return 0;
}

function itemMatchesQuery(it, q) {
  if (!q) return true;

  const baseMatch =
    it.word.toLowerCase().includes(q) ||
    it.sentence.toLowerCase().includes(q);

  if (!getLangConfig()?.usesReading) return baseMatch;

  return baseMatch || String(it.reading ?? "").toLowerCase().includes(q);
}

function renderList() {
  const baseItems = itemsCache.filter((it) => it.correctCount < ARCHIVE_THRESHOLD);
  const q = (searchInput.value || "").trim().toLowerCase();
  const sorted = getSortedItems(baseItems, sortSelect.value);

  const filtered = sorted.filter((it) => itemMatchesQuery(it, q));

  listCount.textContent = `총 ${baseItems.length}개`;
  listEmpty.classList.toggle("hidden", filtered.length !== 0);
  listWrap.innerHTML = "";

  for (const it of filtered) {
    const el = buildItemCard(it);
    listWrap.appendChild(el);
  }
}

function renderArchive() {
  const baseItems = itemsCache.filter((it) => it.correctCount >= ARCHIVE_THRESHOLD);
  const q = (archiveSearchInput.value || "").trim().toLowerCase();
  const sorted = getSortedItems(baseItems, archiveSortSelect.value);

  const filtered = sorted.filter((it) => itemMatchesQuery(it, q));

  archiveCount.textContent = `총 ${baseItems.length}개`;
  archiveEmpty.classList.toggle("hidden", filtered.length !== 0);
  archiveWrap.innerHTML = "";

  for (const it of filtered) {
    const el = buildItemCard(it);
    archiveWrap.appendChild(el);
  }
}

function buildItemCard(it) {
  const cfg = getLangConfig();

  const el = document.createElement("div");
  el.className = "item";

  const top = document.createElement("div");
  top.className = "itemTop";

  const left = document.createElement("div");
  left.innerHTML = `<span class="itemWord">${escapeHtml(it.word)}</span>`;

  const right = document.createElement("div");
  right.className = "itemCount";
  right.textContent = `정답: ${it.correctCount}`;

  top.appendChild(left);
  top.appendChild(right);

  el.appendChild(top);

  if (cfg?.usesReading) {
    const reading = document.createElement("div");
    reading.className = "itemReading";
    reading.innerHTML = `<strong>${escapeHtml(cfg.readingDisplayLabel)}:</strong> ${escapeHtml(it.reading || "")}`;
    el.appendChild(reading);
  }

  const sentence = document.createElement("div");
  sentence.className = "itemSentence";
  sentence.textContent = it.sentence;

  const actions = document.createElement("div");
  actions.className = "itemActions";

  const editBtn = document.createElement("button");
  editBtn.className = "smallBtn";
  editBtn.textContent = "수정";
  editBtn.addEventListener("click", () => {
    enterEditMode(it);
  });

  const delBtn = document.createElement("button");
  delBtn.className = "smallBtn dangerText";
  delBtn.textContent = "삭제";
  delBtn.addEventListener("click", async () => {
    const ok = confirm(`"${it.word}" 를 정말로 삭제할 거예요?`);
    if (!ok) return;

    try {
      await fsDeleteItem(it.id);
    } catch (err) {
      alert("삭제 실패: " + (err?.message ?? err));
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  el.appendChild(sentence);
  el.appendChild(actions);

  return el;
}

/* =========================
   QUIZ screen
========================= */
const quizEmpty = document.getElementById("quizEmpty");
const quizBox = document.getElementById("quizBox");
const qSentence = document.getElementById("qSentence");
const qAnswer = document.getElementById("qAnswer");
const qCheck = document.getElementById("qCheck");
const qSkip = document.getElementById("qSkip");
const qFeedback = document.getElementById("qFeedback");
const quizMeta = document.getElementById("quizMeta");
const qHint = document.getElementById("qHint");
const qReveal = document.getElementById("qReveal");
const qProgress = document.getElementById("qProgress");

let currentQuiz = null;
let lastQuizItemId = null;

function getQuizPool() {
  return itemsCache.filter((it) => it.correctCount < ARCHIVE_THRESHOLD);
}

function refreshQuizMeta() {
  const items = getQuizPool();
  quizMeta.textContent = items.length ? `퀴즈 대상 단어: ${items.length}개` : "";
}

function startQuiz() {
  resetQuizUI();
  const items = getQuizPool();

  if (items.length === 0) {
    quizEmpty.classList.remove("hidden");
    quizBox.classList.add("hidden");
    quizMeta.textContent = "";
    return;
  }

  quizEmpty.classList.add("hidden");
  quizBox.classList.remove("hidden");
  refreshQuizMeta();
  nextQuestion();
  setTimeout(() => qAnswer.focus(), 0);
}

function resetQuizUI() {
  qFeedback.textContent = "";
  qFeedback.className = "feedback";
  qAnswer.value = "";
  qReveal.textContent = "";
  qReveal.classList.add("hidden");
  qProgress.textContent = "";
  currentQuiz = null;
}

function nextQuestion() {
  const cfg = getLangConfig();
  const items = getQuizPool();

  if (items.length === 0) {
    startQuiz();
    return;
  }

  let candidates = items;
  if (items.length > 1 && lastQuizItemId) {
    const filtered = items.filter((it) => it.id !== lastQuizItemId);
    if (filtered.length > 0) candidates = filtered;
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const blanked = makeBlankByLanguage(pick.sentence, pick.word);

  currentQuiz = {
    itemId: pick.id,
    word: pick.word,
    reading: pick.reading || "",
    sentence: pick.sentence,
    blankedSentence: blanked,
    correctCount: pick.correctCount ?? 0,
  };

  lastQuizItemId = pick.id;

  qHint.textContent = cfg?.usesReading
    ? `예문 속 빈칸의 ${cfg.readingLabel}을 입력하세요.`
    : "예문 속 단어를 빈칸에 넣으세요.";

  qProgress.textContent = `정답 횟수: ${currentQuiz.correctCount}/${ARCHIVE_THRESHOLD}`;
  qSentence.textContent = blanked;
  qAnswer.value = "";
  qFeedback.textContent = "";
  qFeedback.className = "feedback";
  qReveal.textContent = "";
  qReveal.classList.add("hidden");
}

async function checkAnswer() {
  if (!currentQuiz) return;

  const ans = qAnswer.value.trim();
  if (!ans) return;

  const cfg = getLangConfig();

  let correct = false;
  if (currentLanguage === "english") {
    correct = normalize(ans) === normalize(currentQuiz.word);
  } else if (currentLanguage === "chinese") {
    correct = normalizeChineseReading(ans) === normalizeChineseReading(currentQuiz.reading);
  } else if (currentLanguage === "japanese") {
    correct = normalizeJapaneseReading(ans) === normalizeJapaneseReading(currentQuiz.reading);
  }

  if (correct) {
    const nextValue = (currentQuiz.correctCount ?? 0) + 1;

    try {
      await fsIncCorrect(currentQuiz.itemId);
    } catch (err) {
      alert("정답 카운트 업데이트 실패: " + (err?.message ?? err));
      return;
    }

    currentQuiz.correctCount = nextValue;
    qProgress.textContent = `정답 횟수: ${nextValue}/${ARCHIVE_THRESHOLD}`;

    if (nextValue >= ARCHIVE_THRESHOLD) {
      qFeedback.textContent = "정답 ✅ 이 단어는 아카이브로 이동합니다.";
    } else {
      qFeedback.textContent = "정답 ✅";
    }

    qFeedback.className = "feedback ok";

    if (cfg?.usesReading) {
      qReveal.textContent = `${cfg.wordLabel}: ${currentQuiz.word}`;
      qReveal.classList.remove("hidden");
    }

    setTimeout(() => {
      nextQuestion();
      qAnswer.focus();
    }, 1100);
  } else {
    qProgress.textContent = `정답 횟수: ${currentQuiz.correctCount}/${ARCHIVE_THRESHOLD}`;

    if (cfg?.usesReading) {
      qFeedback.textContent = `오답 ❌ 정답 ${cfg.readingLabel}: ${currentQuiz.reading}`;
      qReveal.textContent = `${cfg.wordLabel}: ${currentQuiz.word}`;
      qReveal.classList.remove("hidden");
    } else {
      qFeedback.textContent = `오답 ❌ 정답: ${currentQuiz.word}`;
    }
    qFeedback.className = "feedback bad";
  }
}

qCheck.addEventListener("click", checkAnswer);
qSkip.addEventListener("click", () => {
  nextQuestion();
  qAnswer.focus();
});

qAnswer.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  checkAnswer();
});

/* =========================
   Utils
========================= */
function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeChineseReading(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeJapaneseReading(s) {
  return String(s ?? "").trim().replace(/\s+/g, "");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentenceIncludesWordEnglish(sentence, word) {
  const normalizedWord = word.trim();
  if (!normalizedWord) return false;

  const patterns = [
    new RegExp(`\\b${escapeRegExp(normalizedWord)}\\b`, "i"),
    new RegExp(`\\b${escapeRegExp(normalizedWord + "ed")}\\b`, "i"),
    new RegExp(`\\b${escapeRegExp(normalizedWord + "ing")}\\b`, "i"),
  ];

  return patterns.some((re) => re.test(sentence));
}

function sentenceIncludesWordByLanguage(sentence, word) {
  if (!word.trim()) return false;

  if (currentLanguage === "english") {
    return sentenceIncludesWordEnglish(sentence, word);
  }

  return sentence.includes(word);
}

function makeBlankByLanguage(sentence, word) {
  if (currentLanguage === "english") {
    return makeBlankEnglish(sentence, word);
  }

  return makeBlankSimple(sentence, word);
}

function makeBlankEnglish(sentence, word) {
  const base = word.trim();
  if (!base) return sentence;

  const reBase = new RegExp(`\\b${escapeRegExp(base)}\\b`, "i");
  if (reBase.test(sentence)) return sentence.replace(reBase, "____");

  const past = base + "ed";
  const rePast = new RegExp(`\\b${escapeRegExp(past)}\\b`, "i");
  if (rePast.test(sentence)) return sentence.replace(rePast, "____ed");

  const ing = base + "ing";
  const reIng = new RegExp(`\\b${escapeRegExp(ing)}\\b`, "i");
  if (reIng.test(sentence)) return sentence.replace(reIng, "____ing");

  qHint.textContent = "⚠️ 원형/ed/ing 형태를 찾지 못했어요.";
  return sentence;
}

function makeBlankSimple(sentence, word) {
  if (!word) return sentence;
  if (!sentence.includes(word)) {
    qHint.textContent = "⚠️ 예문에서 정확히 같은 단어를 찾지 못했어요.";
    return sentence;
  }
  return sentence.replace(word, "____");
}

/* =========================
   Auth state → subscribe user items
========================= */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUid = user.uid;
    authUI.userLabel.textContent = user.email ?? "로그인됨";
    authUI.loginBtn.style.display = "none";
    authUI.logoutBtn.style.display = "inline-block";

    if (currentLanguage) {
      subscribeItems(currentUid);
      showScreen("home");
    } else {
      showScreen("languageSelect");
    }
  } else {
    currentUid = null;
    currentLanguage = null;
    itemsCache = [];
    if (unsubItems) unsubItems();
    unsubItems = null;

    authUI.userLabel.textContent = "로그인 필요";
    authUI.loginBtn.style.display = "inline-block";
    authUI.logoutBtn.style.display = "none";

    exitEditMode();
    resetQuizUI();
    showScreen("languageSelect");
  }
});

/* =========================
   App init
========================= */
showScreen("languageSelect");
