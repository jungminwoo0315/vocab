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

/* =========================
   In-memory cache (real-time)
========================= */
let currentUid = null;
let itemsCache = []; // { id, word, sentence, correctCount, createdAt }
let unsubItems = null;

/* =========================
   Create / Edit state
========================= */
let createState = {
  step: "word",
  word: "",
};

let editMode = {
  isEditing: false,
  itemId: null,
  originalCorrectCount: 0,
  originalCreatedAt: null,
  originalWord: "",
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
function itemsCol(uid) {
  return collection(db, "users", uid, "items");
}

async function fsAddItem(word, sentence) {
  if (!currentUid) throw new Error("Not signed in");
  const payload = {
    word: word.trim(),
    sentence: sentence.trim(),
    correctCount: 0,
    createdAt: serverTimestamp(),
  };
  await addDoc(itemsCol(currentUid), payload);
}

async function fsDeleteItem(id) {
  if (!currentUid) throw new Error("Not signed in");
  await deleteDoc(doc(db, "users", currentUid, "items", id));
}

async function fsClearAll() {
  if (!currentUid) throw new Error("Not signed in");
  const snap = await getDocs(itemsCol(currentUid));
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

async function fsIncCorrect(id, nextValue) {
  if (!currentUid) throw new Error("Not signed in");
  await updateDoc(doc(db, "users", currentUid, "items", id), {
    correctCount: nextValue,
  });
}

async function fsUpdateItem(id, word, sentence) {
  if (!currentUid) throw new Error("Not signed in");
  await updateDoc(doc(db, "users", currentUid, "items", id), {
    word: word.trim(),
    sentence: sentence.trim(),
  });
}

function subscribeItems(uid) {
  if (unsubItems) unsubItems();
  itemsCache = [];

  const qy = query(itemsCol(uid), orderBy("createdAt", "desc"));
  unsubItems = onSnapshot(
    qy,
    (snap) => {
      itemsCache = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          word: String(data.word ?? "").trim(),
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
  home: document.getElementById("home"),
  create: document.getElementById("create"),
  list: document.getElementById("list"),
  archive: document.getElementById("archive"),
  quiz: document.getElementById("quiz"),
};

const backBtn = document.getElementById("backBtn");
const screenTitle = document.getElementById("screenTitle");
const screenSub = document.getElementById("screenSub");
const createTitle = document.getElementById("createTitle");

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle("hidden", k !== name);
  });

  const inHome = name === "home";
  backBtn.classList.toggle("hidden", inHome);

  if (name === "home") {
    screenTitle.textContent = "내 단어장";
    screenSub.textContent = currentUid ? "원하는 기능을 선택하세요" : "먼저 Google 로그인을 해주세요";
  } else if (name === "create") {
    screenTitle.textContent = editMode.isEditing ? "단어 수정" : "새로운 단어 생성";
    screenSub.textContent = editMode.isEditing ? "단어 → 예문 순서로 수정" : "단어 → 예문 순서로 입력";
    createTitle.textContent = editMode.isEditing ? "단어 수정" : "새로운 단어 생성";
  } else if (name === "list") {
    screenTitle.textContent = "내가 만든 단어 보기";
    screenSub.textContent = "단어/예문 + 정답 횟수";
  } else if (name === "archive") {
    screenTitle.textContent = "아카이브";
    screenSub.textContent = "정답 100번 이상인 단어";
  } else if (name === "quiz") {
    screenTitle.textContent = "퀴즈 풀기";
    screenSub.textContent = "예문에서 단어를 블랭크로 맞히기";
  }
}

backBtn.addEventListener("click", () => {
  resetQuizUI();
  exitEditMode();
  showScreen("home");
});

/* =========================
   Home navigation
========================= */
document.getElementById("goCreate").addEventListener("click", () => {
  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");
  exitEditMode();
  showScreen("create");
  startCreateFlow();
});

document.getElementById("goList").addEventListener("click", () => {
  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");
  resetQuizUI();
  exitEditMode();
  showScreen("list");
  renderList();
  document.getElementById("search").focus();
});

document.getElementById("goQuiz").addEventListener("click", () => {
  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");
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

function startCreateFlow() {
  createState = { step: "word", word: "" };
  createPrompt.textContent = "단어를 입력하세요";
  createInput.value = "";
  createInput.placeholder = "예: resilient";
  createHelper.textContent = editMode.isEditing
    ? "수정할 단어를 입력하고 Enter를 누르세요."
    : "단어를 입력하고 Enter를 누르세요.";
  createHelper.style.color = "";
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
    originalSentence: item.sentence ?? "",
  };

  createState = {
    step: "word",
    word: "",
  };

  showScreen("create");
  createPrompt.textContent = "수정할 단어를 입력하세요";
  createInput.value = item.word;
  createInput.placeholder = "예: resilient";
  createHelper.textContent = "단어를 수정한 뒤 Enter를 누르세요.";
  createHelper.style.color = "";
  createTitle.textContent = "단어 수정";
  setTimeout(() => createInput.focus(), 0);
}

function exitEditMode() {
  editMode = {
    isEditing: false,
    itemId: null,
    originalCorrectCount: 0,
    originalCreatedAt: null,
    originalWord: "",
    originalSentence: "",
  };
  createTitle.textContent = "새로운 단어 생성";
}

createReset.addEventListener("click", () => {
  if (editMode.isEditing) {
    createState = { step: "word", word: "" };
    createPrompt.textContent = "수정할 단어를 입력하세요";
    createInput.value = editMode.originalWord || "";
    createInput.placeholder = "예: resilient";
    createHelper.textContent = "수정할 단어를 입력하고 Enter를 누르세요.";
    createHelper.style.color = "";
    createInput.focus();
    return;
  }

  startCreateFlow();
});

createInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();

  if (!currentUid) return alert("먼저 Google 로그인 해주세요.");

  const val = createInput.value.trim();
  if (!val) return;

  if (createState.step === "word") {
    createState.word = val;
    createState.step = "sentence";
    createPrompt.textContent = `예문을 입력하세요 (단어: ${createState.word})`;

    if (editMode.isEditing) {
      createInput.value = editMode.originalSentence || "";
    } else {
      createInput.value = "";
    }

    createInput.placeholder = "예: She is resilient even under pressure.";
    createHelper.textContent = editMode.isEditing
      ? "예문이 기존 값으로 채워져 있어요. 수정 후 Enter를 누르세요."
      : "예문을 입력하고 Enter를 누르면 저장됩니다.";
    createHelper.style.color = "";
    return;
  }

  if (createState.step === "sentence") {
    const sentenceVal = val;
    const wordVal = createState.word;

    const containsWord = sentenceIncludesWord(sentenceVal, wordVal);
    if (!containsWord) {
      createHelper.textContent =
        "⚠️ 오타예요! 예문에 단어가 정확히 포함되어 있지 않습니다. (단어 철자/띄어쓰기 확인)";
      createHelper.style.color = "red";
      return;
    }

    createHelper.style.color = "";

    try {
      if (editMode.isEditing && editMode.itemId) {
        await fsUpdateItem(editMode.itemId, wordVal, sentenceVal);
        createHelper.textContent = `수정됨 ✅ (${wordVal})`;
      } else {
        await fsAddItem(wordVal, sentenceVal);
        createHelper.textContent = `저장됨 ✅ (${wordVal}) — 다음 단어를 입력하세요.`;
      }
    } catch (err) {
      alert((editMode.isEditing ? "수정 실패: " : "저장 실패: ") + (err?.message ?? err));
      return;
    }

    const wasEditing = editMode.isEditing;

    createState = { step: "word", word: "" };
    createPrompt.textContent = "단어를 입력하세요";
    createInput.value = "";
    createInput.placeholder = "예: resilient";

    if (wasEditing) {
      exitEditMode();
      showScreen("list");
      renderList();
      return;
    }

    return;
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
  const ok = confirm("정말 전체 삭제할까요? (되돌릴 수 없음)");
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
    copied.sort((a, b) => a.word.localeCompare(b.word, "en", { sensitivity: "base" }));
    return copied;
  }

  if (sortValue === "correctDesc") {
    copied.sort((a, b) => {
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      return a.word.localeCompare(b.word, "en", { sensitivity: "base" });
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

function renderList() {
  const baseItems = itemsCache.filter((it) => it.correctCount < 100);
  const q = (searchInput.value || "").trim().toLowerCase();
  const sorted = getSortedItems(baseItems, sortSelect.value);

  const filtered = !q
    ? sorted
    : sorted.filter(
        (it) =>
          it.word.toLowerCase().includes(q) ||
          it.sentence.toLowerCase().includes(q)
      );

  listCount.textContent = `총 ${baseItems.length}개`;
  listEmpty.classList.toggle("hidden", filtered.length !== 0);
  listWrap.innerHTML = "";

  for (const it of filtered) {
    const el = buildItemCard(it);
    listWrap.appendChild(el);
  }
}

function renderArchive() {
  const baseItems = itemsCache.filter((it) => it.correctCount >= 100);
  const q = (archiveSearchInput.value || "").trim().toLowerCase();
  const sorted = getSortedItems(baseItems, archiveSortSelect.value);

  const filtered = !q
    ? sorted
    : sorted.filter(
        (it) =>
          it.word.toLowerCase().includes(q) ||
          it.sentence.toLowerCase().includes(q)
      );

  archiveCount.textContent = `총 ${baseItems.length}개`;
  archiveEmpty.classList.toggle("hidden", filtered.length !== 0);
  archiveWrap.innerHTML = "";

  for (const it of filtered) {
    const el = buildItemCard(it);
    archiveWrap.appendChild(el);
  }
}

function buildItemCard(it) {
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

  el.appendChild(top);
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

let currentQuiz = null;

function getQuizPool() {
  return itemsCache.filter((it) => it.correctCount < 100);
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
  currentQuiz = null;
}

function nextQuestion() {
  const items = getQuizPool();

  if (items.length === 0) {
    startQuiz();
    return;
  }

  const pick = items[Math.floor(Math.random() * items.length)];
  const blanked = makeBlank(pick.sentence, pick.word);

  currentQuiz = {
    itemId: pick.id,
    word: pick.word,
    sentence: pick.sentence,
    blankedSentence: blanked,
  };

  qHint.textContent = "예문 속 단어를 빈칸에 넣으세요.";
  qSentence.textContent = blanked;
  qAnswer.value = "";
  qFeedback.textContent = "";
  qFeedback.className = "feedback";
}

async function checkAnswer() {
  if (!currentQuiz) return;
  const ans = qAnswer.value.trim();
  if (!ans) return;

  const correct = normalize(ans) === normalize(currentQuiz.word);

  if (correct) {
    const it = itemsCache.find((x) => x.id === currentQuiz.itemId);
    const nextValue = (it?.correctCount ?? 0) + 1;

    try {
      await fsIncCorrect(currentQuiz.itemId, nextValue);
    } catch (err) {
      alert("정답 카운트 업데이트 실패: " + (err?.message ?? err));
      return;
    }

    if (nextValue >= 100) {
      qFeedback.textContent = "정답 ✅ 이 단어는 아카이브로 이동합니다.";
    } else {
      qFeedback.textContent = "정답 ✅ 다음 문제로 넘어갑니다.";
    }

    qFeedback.className = "feedback ok";
    setTimeout(() => nextQuestion(), 450);
  } else {
    qFeedback.textContent = `오답 ❌ 정답: ${currentQuiz.word}`;
    qFeedback.className = "feedback bad";
  }
}

qCheck.addEventListener("click", checkAnswer);
qSkip.addEventListener("click", () => nextQuestion());

qAnswer.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  checkAnswer();
});

/* =========================
   Utils
========================= */
function normalize(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentenceIncludesWord(sentence, word) {
  const normalizedWord = word.trim();
  if (!normalizedWord) return false;

  const patterns = [
    new RegExp(`\\b${escapeRegExp(normalizedWord)}\\b`, "i"),
    new RegExp(`\\b${escapeRegExp(normalizedWord + "ed")}\\b`, "i"),
    new RegExp(`\\b${escapeRegExp(normalizedWord + "ing")}\\b`, "i"),
  ];

  return patterns.some((re) => re.test(sentence));
}

// 원형/ed/ing 블랭킹
function makeBlank(sentence, word) {
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

/* =========================
   Auth state → subscribe user items
========================= */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUid = user.uid;
    authUI.userLabel.textContent = user.email ?? "로그인됨";
    authUI.loginBtn.style.display = "none";
    authUI.logoutBtn.style.display = "inline-block";

    subscribeItems(currentUid);
    showScreen("home");
  } else {
    currentUid = null;
    itemsCache = [];
    if (unsubItems) unsubItems();
    unsubItems = null;

    authUI.userLabel.textContent = "로그인 필요";
    authUI.loginBtn.style.display = "inline-block";
    authUI.logoutBtn.style.display = "none";

    exitEditMode();
    showScreen("home");
  }
});

/* =========================
   App init
========================= */
showScreen("home");
