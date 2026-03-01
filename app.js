/* =========================
   Data model
   item = { id, word, sentence, correctCount }
   stored in localStorage
========================= */
const STORAGE_KEY = "minwoo_vocab_v1";

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.word === "string" && typeof x.sentence === "string")
      .map((x) => ({
        id: String(x.id ?? (crypto.randomUUID?.() ?? Date.now())),
        word: x.word.trim(),
        sentence: x.sentence.trim(),
        correctCount: Number.isFinite(x.correctCount) ? x.correctCount : 0,
      }));
  } catch {
    return [];
  }
}

function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

/* =========================
   Screens
========================= */
const screens = {
  home: document.getElementById("home"),
  create: document.getElementById("create"),
  list: document.getElementById("list"),
  quiz: document.getElementById("quiz"),
};

const backBtn = document.getElementById("backBtn");
const screenTitle = document.getElementById("screenTitle");
const screenSub = document.getElementById("screenSub");

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle("hidden", k !== name);
  });

  const inHome = name === "home";
  backBtn.classList.toggle("hidden", inHome);

  if (name === "home") {
    screenTitle.textContent = "내 단어장";
    screenSub.textContent = "원하는 기능을 선택하세요";
  } else if (name === "create") {
    screenTitle.textContent = "새로운 단어 생성";
    screenSub.textContent = "단어 → 예문 순서로 입력";
  } else if (name === "list") {
    screenTitle.textContent = "내가 만든 단어 보기";
    screenSub.textContent = "단어/예문 + 정답 횟수";
  } else if (name === "quiz") {
    screenTitle.textContent = "퀴즈 풀기";
    screenSub.textContent = "예문에서 단어를 블랭크로 맞히기";
  }
}

backBtn.addEventListener("click", () => {
  resetQuizUI();
  showScreen("home");
});

/* =========================
   Home navigation
========================= */
document.getElementById("goCreate").addEventListener("click", () => {
  showScreen("create");
  startCreateFlow();
});

document.getElementById("goList").addEventListener("click", () => {
  showScreen("list");
  renderList();
  document.getElementById("search").focus();
});

document.getElementById("goQuiz").addEventListener("click", () => {
  showScreen("quiz");
  startQuiz();
});

/* =========================
   CREATE flow
   Click tile → prompt word → Enter → prompt sentence → Enter saves
   After save, immediately prompt new word (loop) until user hits back
========================= */
const createPrompt = document.getElementById("createPrompt");
const createInput = document.getElementById("createInput");
const createHelper = document.getElementById("createHelper");
const createReset = document.getElementById("createReset");

let createState = {
  step: "word", // "word" | "sentence"
  word: "",
};

function startCreateFlow() {
  createState = { step: "word", word: "" };
  createPrompt.textContent = "단어를 입력하세요";
  createInput.value = "";
  createInput.placeholder = "예: resilient";
  createHelper.textContent = "단어를 입력하고 Enter를 누르세요.";
  createHelper.style.color = "";
  setTimeout(() => createInput.focus(), 0);
}

createReset.addEventListener("click", startCreateFlow);

createInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();

  const val = createInput.value.trim();
  if (!val) return;

  if (createState.step === "word") {
    createState.word = val;
    createState.step = "sentence";
    createPrompt.textContent = `예문을 입력하세요 (단어: ${createState.word})`;
    createInput.value = "";
    createInput.placeholder = "예: She is resilient even under pressure.";
    createHelper.textContent = "예문을 입력하고 Enter를 누르면 저장됩니다.";
    createHelper.style.color = "";
    return;
  }

  // sentence step
  if (createState.step === "sentence") {
    const sentenceVal = val;
    const wordVal = createState.word;

    // ✅ 오타 방지: 예문에 단어가 포함되어 있는지 검사 (대소문자 무시)
    const containsWord = sentenceVal.toLowerCase().includes(wordVal.toLowerCase());

    if (!containsWord) {
      createHelper.textContent =
        "⚠️ 오타예요! 예문에 단어가 정확히 포함되어 있지 않습니다. (단어 철자/띄어쓰기 확인)";
      createHelper.style.color = "red";
      return; // 저장하지 않고, 예문 입력 상태 유지
    }

    createHelper.style.color = "";

    const items = loadItems();
    const newItem = {
      id: crypto.randomUUID?.() ?? String(Date.now()),
      word: wordVal,
      sentence: sentenceVal,
      correctCount: 0,
    };

    items.unshift(newItem);
    saveItems(items);

    createHelper.textContent = `저장됨 ✅ (${newItem.word}) — 다음 단어를 입력하세요.`;
    createHelper.style.color = "";

    // loop to next word
    createState = { step: "word", word: "" };
    createPrompt.textContent = "단어를 입력하세요";
    createInput.value = "";
    createInput.placeholder = "예: resilient";
    return;
  }
});

/* =========================
   LIST screen
   show word + sentence + correctCount
========================= */
const listWrap = document.getElementById("listWrap");
const listEmpty = document.getElementById("listEmpty");
const searchInput = document.getElementById("search");
const clearAllBtn = document.getElementById("clearAll");

function renderList() {
  const items = loadItems();
  const q = (searchInput.value || "").trim().toLowerCase();

  const filtered = !q
    ? items
    : items.filter(
        (it) => it.word.toLowerCase().includes(q) || it.sentence.toLowerCase().includes(q)
      );

  listEmpty.classList.toggle("hidden", filtered.length !== 0);
  listWrap.innerHTML = "";

  for (const it of filtered) {
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

    const del = document.createElement("button");
    del.className = "smallBtn";
    del.textContent = "삭제";
    del.addEventListener("click", () => {
      const next = loadItems().filter((x) => x.id !== it.id);
      saveItems(next);
      renderList();
    });

    actions.appendChild(del);

    el.appendChild(top);
    el.appendChild(sentence);
    el.appendChild(actions);

    listWrap.appendChild(el);
  }
}

searchInput.addEventListener("input", renderList);

clearAllBtn.addEventListener("click", () => {
  const ok = confirm("정말 전체 삭제할까요? (되돌릴 수 없음)");
  if (!ok) return;
  saveItems([]);
  renderList();
});

/* =========================
   QUIZ screen
   random item → sentence with blank → answer
   correct → increment correctCount
   keep looping until user hits back
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

let currentQuiz = null; // { itemId, word, sentence, blankedSentence }

function startQuiz() {
  resetQuizUI();
  const items = loadItems();
  if (items.length === 0) {
    quizEmpty.classList.remove("hidden");
    quizBox.classList.add("hidden");
    quizMeta.textContent = "";
    return;
  }
  quizEmpty.classList.add("hidden");
  quizBox.classList.remove("hidden");
  quizMeta.textContent = `등록 단어: ${items.length}개`;
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
  const items = loadItems();
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

function checkAnswer() {
  if (!currentQuiz) return;
  const ans = qAnswer.value.trim();
  if (!ans) return;

  const correct = normalize(ans) === normalize(currentQuiz.word);

  if (correct) {
    const items = loadItems();
    const idx = items.findIndex((x) => x.id === currentQuiz.itemId);
    if (idx >= 0) {
      items[idx].correctCount = (items[idx].correctCount || 0) + 1;
      saveItems(items);
    }
    qFeedback.textContent = "정답 ✅ 다음 문제로 넘어갑니다.";
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

function makeBlank(sentence, word) {
  const base = word.trim();
  if (!base) return sentence;

  const lowerSentence = sentence.toLowerCase();
  const lowerBase = base.toLowerCase();

  // 1️⃣ 원형 그대로 찾기
  const reBase = new RegExp(`\\b${escapeRegExp(base)}\\b`, "i");
  if (reBase.test(sentence)) {
    return sentence.replace(reBase, "____");
  }

  // 2️⃣ 과거형 (ed)
  const past = base + "ed";
  const rePast = new RegExp(`\\b${escapeRegExp(past)}\\b`, "i");
  if (rePast.test(sentence)) {
    return sentence.replace(rePast, "____ed");
  }

  // 3️⃣ ing형
  const ing = base + "ing";
  const reIng = new RegExp(`\\b${escapeRegExp(ing)}\\b`, "i");
  if (reIng.test(sentence)) {
    return sentence.replace(reIng, "____ing");
  }

  // 4️⃣ 아무것도 못 찾으면 원래 문장
  qHint.textContent =
    "⚠️ 원형/ed/ing 형태를 찾지 못했어요.";
  return sentence;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =========================
   App init
========================= */
showScreen("home");