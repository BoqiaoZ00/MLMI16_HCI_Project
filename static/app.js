const totalPages = 12;
const consentChecks = Array.from(document.querySelectorAll(".consent-check"));
const consentContinue = document.getElementById("consentContinue");
const participationMode = document.getElementById("participationMode");
const participantIdLabel = document.getElementById("participantIdLabel");
const pageCounter = document.getElementById("pageCounter");
const toggleInfoSheet = document.getElementById("toggleInfoSheet");
const infoSheet = document.getElementById("infoSheet");

const pageConsent = document.getElementById("page-consent");
const pageTyping = document.getElementById("page-typing");
const pageQuestionnaire = document.getElementById("page-questionnaire");
const pageThankyou = document.getElementById("page-thankyou");

const phaseLabel = document.getElementById("phaseLabel");
const blockMeta = document.getElementById("blockMeta");
const targetPhraseEl = document.getElementById("targetPhrase");
const phraseCounterEl = document.getElementById("phraseCounter");
const phrasePanel = document.getElementById("phrasePanel");
const completionIndicator = document.getElementById("completionIndicator");
const typingInput = document.getElementById("typingInput");
const suggestionBar = document.getElementById("suggestionBar");
const suggestion1 = document.getElementById("suggestion1");
const suggestion2 = document.getElementById("suggestion2");
const suggestion3 = document.getElementById("suggestion3");
const statusEl = document.getElementById("status");
const nextPhraseBtn = document.getElementById("nextPhraseBtn");
const nextBlockBtn = document.getElementById("nextBlockBtn");

const submitQuestionnaire = document.getElementById("submitQuestionnaire");
const questionnaireStatus = document.getElementById("questionnaireStatus");

const PRACTICE_PHRASES = [
  "Typing with suggestions feels natural.",
  "Practice helps prepare for the main task.",
  "Press the number keys to accept suggestions.",
];
const PRACTICE_DELAYS = [0, 100, 200];

const MAIN_PHRASES = [
  // Accuracy 0.1
  "My watch fell in the water during an unexpected thunderstorm downtown today.",
  "Prevailing winds from the east delayed the environmental research expedition offshore.",
  "We are having spaghetti tonight because the cafeteria menu changed unexpectedly.",
  // Accuracy 0.5
  "Breathing is difficult in the cold when humidity levels drop sharply.",
  "I can see the rings on Saturn through the observatory telescope clearly.",
  "Physics and chemistry are hard when foundational concepts remain poorly understood.",
  // Accuracy 0.9
  "My bank account is overdrawn after the expensive international conference registration.",
  "Elections bring out the best and worst in public discourse sometimes.",
  "Time to go shopping today before the neighborhood market closes early.",
];

const FALLBACK_WORD_POOL = Array.from(
  new Set(
    [...PRACTICE_PHRASES, ...MAIN_PHRASES]
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, "")
      .split(/\s+/)
      .filter(Boolean)
  )
);

const SUGGESTION_BLOCKS = [];
const PRACTICE_BLOCKS = [];
let PREFIX_SUGGESTIONS = {};

const prefixReady = fetch("/api/incorrect-prefixes")
  .then((res) => (res.ok ? res.json() : { prefixes: {} }))
  .then((data) => {
    if (data && data.prefixes) {
      PREFIX_SUGGESTIONS = data.prefixes;
    }
  })
  .catch(() => {});

const fetchSuggestionBlock = async (blockIndex) => {
  if (SUGGESTION_BLOCKS[blockIndex]) {
    return SUGGESTION_BLOCKS[blockIndex];
  }
  const response = await fetch(`/api/suggestions/${blockIndex + 1}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load suggestion block.");
  }
  const data = await response.json();
  if (data.block) {
    SUGGESTION_BLOCKS[blockIndex] = data.block;
  }
  return data.block;
};

const fetchPracticeBlocks = async () => {
  if (PRACTICE_BLOCKS.length) {
    return PRACTICE_BLOCKS;
  }
  const response = await fetch("/api/suggestions/practice", {
    cache: "no-store",
  });
  if (!response.ok) {
    return PRACTICE_BLOCKS;
  }
  const data = await response.json();
  if (Array.isArray(data.practice_blocks)) {
    PRACTICE_BLOCKS.splice(0, PRACTICE_BLOCKS.length, ...data.practice_blocks);
  }
  return PRACTICE_BLOCKS;
};

const accuracyLevels = [0.1, 0.5, 0.9];
const delayLevels = [0, 100, 200];
const BLOCKS = [];
accuracyLevels.forEach((accuracy) => {
  delayLevels.forEach((delayMs) => {
    BLOCKS.push({ accuracy, delayMs });
  });
});

const state = {
  participantId: null,
  experimentStartIso: null,
  phase: "consent",
  blockIndex: -1,
  phraseIndex: 0,
  phraseStartMs: null,
  currentWordIndex: 0,
  currentWordBuffer: "",
  typedValue: "",
  inputLocked: false,
  phrasePlan: [],
  currentWordPlan: null,
  currentSuggestions: [],
  correctSuggestionVisible: false,
  currentCorrectRank: null,
  lastSuggestionSignature: "",
  suggestionVisible: false,
  suggestionShownForWord: null,
  delayActive: false,
  phraseCompleted: false,
  eventBuffer: [],
  pendingBlockIndex: null,
};

const nowMs = () => Date.now();

const showPage = (page) => {
  [pageConsent, pageTyping, pageQuestionnaire, pageThankyou].forEach((el) => {
    el.classList.add("hidden");
  });
  page.classList.remove("hidden");
};

const updatePageCounter = (pageNumber) => {
  pageCounter.textContent = `Page ${pageNumber} of ${totalPages}`;
};

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = "Request failed.";
    if (text) {
      try {
        const data = JSON.parse(text);
        message = data.error || text;
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }
};

const queueEvent = (dataset, row) => {
  state.eventBuffer.push({ dataset, row });
  if (state.eventBuffer.length >= 50) {
    flushEvents().catch(() => {});
  }
};

const flushEvents = async () => {
  if (!state.eventBuffer.length) {
    return;
  }
  const payload = {
    participant_id: state.participantId,
    events: state.eventBuffer.splice(0, state.eventBuffer.length),
  };
  await postJson("/api/events", payload);
};

const browserInfo = () => navigator.userAgent;
const browserType = () => navigator.userAgentData?.brands?.[0]?.brand || "Unknown";
const screenResolution = () => `${window.screen.width}x${window.screen.height}`;
const screenSize = () => `${window.innerWidth}x${window.innerHeight}`;

const isMobile = () => /Mobi|Android/i.test(navigator.userAgent);

const buildBaseEvent = () => ({
  participant_id: state.participantId,
  block_id: state.phase === "practice" ? "practice" : `block_${state.blockIndex + 1}`,
  phrase_id: state.phase === "practice"
    ? `practice_${state.phraseIndex + 1}`
    : `block_${state.blockIndex + 1}_phrase_${state.phraseIndex + 1}`,
  word_index: state.currentWordIndex,
  current_accuracy_level: state.phase === "practice" ? "practice" : BLOCKS[state.blockIndex].accuracy,
  current_delay_level: state.phase === "practice"
    ? (PRACTICE_DELAYS[state.phraseIndex] ?? 0)
    : BLOCKS[state.blockIndex].delayMs,
  block_type: state.phase,
});

const getCurrentTargetPhrase = () => {
  if (state.phase === "practice") {
    const block = PRACTICE_BLOCKS[state.phraseIndex];
    return block?.sentence || PRACTICE_PHRASES[state.phraseIndex];
  }
  const block = SUGGESTION_BLOCKS[state.blockIndex];
  const phrase = block?.phrases?.[state.phraseIndex];
  let result = phrase?.sentence || MAIN_PHRASES[state.blockIndex];
  if (PRACTICE_PHRASES.includes(result)) {
    result = MAIN_PHRASES[state.blockIndex];
  }
  return result;
};

const getTargetWords = () => getCurrentTargetPhrase().split(" ");

const sanitizeSuggestionWord = (word) => word.replace(/[^a-z0-9]/gi, "");

const hashString = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const pickIncorrectWords = (target, seed, count = 3) => {
  const result = [];
  const pool = FALLBACK_WORD_POOL;
  let cursor = hashString(seed);
  while (result.length < count && pool.length) {
    const candidate = pool[cursor % pool.length];
    cursor += 7;
    if (!candidate || candidate === target || result.includes(candidate)) {
      continue;
    }
    result.push(candidate);
  }
  while (result.length < count) {
    result.push(`word${result.length + 1}`);
  }
  return result;
};

const buildWordPlan = (word, wordIndex, accuracy, blockId) => {
  const clean = sanitizeSuggestionWord(word).toLowerCase();
  const length = clean.length;
  const maxSavable = Math.max(length - 2, 0);
  const targetSaving = Math.round(maxSavable * accuracy);
  let appearanceIndexK = length - targetSaving - 1;
  if (!Number.isFinite(appearanceIndexK)) {
    appearanceIndexK = 1;
  }
  if (length <= 1) {
    appearanceIndexK = 1;
  }
  appearanceIndexK = Math.min(Math.max(appearanceIndexK, 1), Math.max(length - 1, 1));
  const enabledSavable = Math.max(length - (appearanceIndexK + 1), 0);
  const rankSeed = `${blockId}-${wordIndex}-${clean}`;
  const correctRank = (hashString(rankSeed) % 3) + 1;
  const incorrect = pickIncorrectWords(clean, `${rankSeed}-incorrect`, 3);
  return {
    targetWord: word,
    cleanWord: clean,
    wordLength: length,
    maxSavable,
    appearanceIndexK,
    enabledSavable,
    correctRank,
    incorrect,
  };
};

const buildPhrasePlan = (phrase, accuracy, blockId) => {
  const words = phrase.split(" ");
  return words.map((word, idx) => buildWordPlan(word, idx, accuracy, blockId));
};

const getCurrentWordPlan = () => state.phrasePlan[state.currentWordIndex] || null;

const setStatus = (message) => {
  statusEl.textContent = message;
};

const setCaretToEnd = () => {
  const range = document.createRange();
  range.selectNodeContents(typingInput);
  range.collapse(false);
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
};

const renderTypedValue = (mismatchIndex = -1) => {
  typingInput.innerHTML = "";
  [...state.typedValue].forEach((char, idx) => {
    const span = document.createElement("span");
    span.textContent = char;
    if (idx === mismatchIndex) {
      span.classList.add("char-error");
    }
    typingInput.appendChild(span);
  });
  setCaretToEnd();
};

const getTypedValue = () => state.typedValue;

const setTypedValue = (value, mismatchIndex = -1) => {
  state.typedValue = value;
  renderTypedValue(mismatchIndex);
};

const updateTypingFeedback = () => {
  const typed = getTypedValue();
  const target = getCurrentTargetPhrase();
  const normalizedTyped = typed.replace(/\s+$/u, "");
  const trimmedTyped = normalizedTyped.replace(/^\s+/u, "");
  const typedLower = trimmedTyped.toLowerCase();
  const targetLower = target.toLowerCase();

  if (typedLower.length === 0) {
    setStatus("Type the phrase exactly as shown.");
    typingInput.classList.remove("input-correct", "input-error");
    typingInput.setAttribute("contenteditable", "true");
    state.inputLocked = false;
    return;
  }

  if (typedLower === targetLower) {
    setStatus("Correct. Click Next phrase to continue.");
    typingInput.classList.add("input-correct");
    typingInput.classList.remove("input-error");
    typingInput.setAttribute("contenteditable", "false");
    state.inputLocked = true;
    return;
  }

  if (targetLower.startsWith(typedLower)) {
    setStatus("Correct so far. Keep typing.");
    typingInput.classList.remove("input-correct", "input-error");
    typingInput.setAttribute("contenteditable", "true");
    state.inputLocked = false;
    return;
  }

  const mismatchIndex = [...typedLower].findIndex(
    (_, idx) => typedLower[idx] !== targetLower[idx]
  );
  const expected = target[mismatchIndex] ?? "";
  setStatus(`Mismatch at position ${mismatchIndex + 1}. Expected "${expected}".`);
  typingInput.classList.add("input-error");
  typingInput.classList.remove("input-correct");
  typingInput.setAttribute("contenteditable", "true");
  state.inputLocked = true;
  renderTypedValue(mismatchIndex);
};

const setSuggestionsVisible = (visible) => {
  suggestionBar.style.visibility = visible ? "visible" : "hidden";
  state.suggestionVisible = visible;
};

const getWordMeta = (plan, overrides = {}) => ({
  target_word: plan?.targetWord || "",
  word_length: plan?.wordLength ?? "",
  correct_suggestion_rank: overrides.correctRank ?? plan?.correctRank ?? "",
  appearance_index_k: plan?.appearanceIndexK ?? "",
  enabled_savable_keystrokes: plan?.enabledSavable ?? "",
});

const buildSuggestionsForPlan = (plan, correctVisible, correctRank) => {
  const baseIncorrect = plan?.incorrect || pickIncorrectWords(plan?.cleanWord || "", "fallback", 3);
  const suggestions = baseIncorrect.slice(0, 3).map((word) => ({
    display: word,
    insert: word,
    isCorrect: false,
  }));
  if (plan && correctVisible) {
    const idx = Math.min(Math.max((correctRank || plan.correctRank || 1) - 1, 0), 2);
    suggestions[idx] = {
      display: plan.cleanWord || plan.targetWord,
      insert: plan.targetWord,
      isCorrect: true,
    };
  }
  return suggestions;
};

const renderSuggestions = (suggestions) => {
  suggestion1.textContent = suggestions[0]?.display || "";
  suggestion2.textContent = suggestions[1]?.display || "";
  suggestion3.textContent = suggestions[2]?.display || "";
};

const logSuggestionDisplay = (plan, suggestions, correctVisible, correctRank) => {
  queueEvent("suggestion_events", {
    ...buildBaseEvent(),
    ...getWordMeta(plan, { correctRank }),
    event_type: "suggestion_display",
    suggestion_1: suggestions[0]?.display || "",
    suggestion_2: suggestions[1]?.display || "",
    suggestion_3: suggestions[2]?.display || "",
    correct_suggestion_visible: correctVisible,
    display_timestamp: nowMs(),
  });
};

const showSuggestionsForWord = (plan, correctVisible, correctRank) => {
  const suggestions = buildSuggestionsForPlan(plan, correctVisible, correctRank);
  state.currentSuggestions = suggestions;
  state.correctSuggestionVisible = correctVisible;
  state.currentCorrectRank = correctVisible ? correctRank : null;
  renderSuggestions(suggestions);
  setSuggestionsVisible(true);
  state.suggestionShownForWord = state.currentWordIndex;
  logSuggestionDisplay(plan, suggestions, correctVisible, correctRank);
};

const hideSuggestions = () => {
  setSuggestionsVisible(false);
  state.suggestionShownForWord = null;
  state.currentSuggestions = [];
  state.correctSuggestionVisible = false;
  state.currentCorrectRank = null;
  state.lastSuggestionSignature = "";
};

const focusTypingInput = () => {
  typingInput.focus();
  setCaretToEnd();
};

const resetTypingState = () => {
  state.currentWordIndex = 0;
  state.currentWordBuffer = "";
  state.typedValue = "";
  state.inputLocked = false;
  state.currentWordPlan = null;
  state.currentSuggestions = [];
  state.correctSuggestionVisible = false;
  state.currentCorrectRank = null;
  state.lastSuggestionSignature = "";
  state.suggestionVisible = false;
  state.suggestionShownForWord = null;
  state.delayActive = false;
  state.phraseCompleted = false;
  setSuggestionsVisible(false);
  setTypedValue("");
  typingInput.setAttribute("contenteditable", "true");
  focusTypingInput();
  typingInput.classList.remove("input-correct", "input-error");
  statusEl.textContent = "";
  phrasePanel.classList.remove("completed");
  completionIndicator.classList.add("hidden");
};

const updateBlockMeta = () => {
  if (state.phase === "practice") {
    phaseLabel.textContent = "Practice Session";
    const delayMs = PRACTICE_DELAYS[state.phraseIndex] ?? 0;
    blockMeta.textContent = `Practice phrase ${state.phraseIndex + 1} of 3. Delay: ${delayMs} ms.`;
  } else {
    const blockNumber = state.blockIndex + 1;
    const block = BLOCKS[state.blockIndex];
    phaseLabel.textContent = `Block ${blockNumber} of ${BLOCKS.length}`;
    blockMeta.textContent = `Accuracy label: ${block.accuracy}, Delay: ${block.delayMs} ms.`;
  }
};

const loadPhrase = async () => {
  resetTypingState();
  targetPhraseEl.textContent = "";
  if (state.phase === "main") {
    typingInput.setAttribute("contenteditable", "false");
    setStatus("Loading suggestions...");
    await fetchSuggestionBlock(state.blockIndex);
  } else if (state.phase === "practice") {
    await fetchPracticeBlocks();
  }
  const phrase = getCurrentTargetPhrase();
  targetPhraseEl.textContent = phrase;
  if (state.phase === "practice") {
    phraseCounterEl.textContent = `Phrase ${state.phraseIndex + 1} of 3`;
  } else {
    phraseCounterEl.textContent = `Phrase ${state.phraseIndex + 1} of 3`;
  }
  nextPhraseBtn.disabled = true;
  nextBlockBtn.classList.add("hidden");
  updateBlockMeta();
  if (state.phase === "practice") {
    const block = PRACTICE_BLOCKS[state.phraseIndex];
    if (block) {
      state.phrasePlan = block.words.map((word) => ({
        targetWord: word.target_word,
        cleanWord: word.clean_word,
        wordLength: word.word_length,
        appearanceIndexK: word.appearance_index_k,
        enabledSavable: word.enabled_savable_keystrokes,
        correctRank: (word.rank_sequence || [])[word.appearance_index_k] || 1,
        suggestionsByIndex: word.suggestions_by_index || {},
        incorrect: (word.suggestions_by_index?.["1"]?.suggestions || []).filter(
          (suggestion) => suggestion !== word.clean_word
        ),
      }));
    } else {
      state.phrasePlan = buildPhrasePlan(phrase, 1, "practice");
    }
  } else {
    const block = SUGGESTION_BLOCKS[state.blockIndex];
    const phrase = block?.phrases?.[state.phraseIndex];
    if (phrase) {
      state.phrasePlan = phrase.words.map((word) => ({
        targetWord: word.target_word,
        cleanWord: word.clean_word,
        wordLength: word.word_length,
        appearanceIndexK: word.appearance_index_k,
        enabledSavable: word.enabled_savable_keystrokes,
        correctRank: (word.rank_sequence || [])[word.appearance_index_k] || 1,
        suggestionsByIndex: word.suggestions_by_index || {},
        incorrect: (word.suggestions_by_index?.["1"]?.suggestions || []).filter(
          (suggestion) => suggestion !== word.clean_word
        ),
      }));
    } else {
      const blockId = `block_${state.blockIndex + 1}`;
      const accuracy = BLOCKS[state.blockIndex].accuracy;
      state.phrasePlan = buildPhrasePlan(phrase, accuracy, blockId);
    }
  }
  resetTypingState();
  state.phraseStartMs = null;
  updateTypingFeedback();
  requestAnimationFrame(() => {
    state.typedValue = "";
    setTypedValue("");
    typingInput.textContent = "";
  });
};

const finishPhrase = (endTimestamp) => {
  if (state.phraseCompleted) {
    return;
  }
  state.phraseCompleted = true;
  typingInput.setAttribute("contenteditable", "false");
  state.inputLocked = true;
  phrasePanel.classList.add("completed");
  completionIndicator.classList.remove("hidden");
  nextPhraseBtn.disabled = false;

  const endMs = endTimestamp || nowMs();
  const phraseStart = state.phraseStartMs || endMs;
  queueEvent("phrase_completion", {
    ...buildBaseEvent(),
    event_type: "phrase_complete",
    phrase_start_timestamp: phraseStart,
    phrase_end_timestamp: endMs,
    time_taken: endMs - phraseStart,
  });

  flushEvents()
    .then(() => {
      setStatus("Saved. Click Next phrase to continue.");
    })
    .catch((error) => {
      setStatus(error.message);
    });
};

const checkPhraseComplete = (endTimestamp) => {
  const typed = getTypedValue()
    .replace(/\s+$/u, "")
    .replace(/^\s+/u, "")
    .toLowerCase();
  const target = getCurrentTargetPhrase().toLowerCase();
  if (typed === target) {
    if (state.currentWordBuffer.length > 0) {
      queueEvent("suggestion_events", {
        ...buildBaseEvent(),
        event_type: "word_complete",
        typed_word: state.currentWordBuffer,
        completion_timestamp: nowMs(),
      });
      state.currentWordBuffer = "";
      state.currentWordIndex += 1;
      hideSuggestions();
    }
    finishPhrase(endTimestamp);
  }
};

const handleBackspace = () => {
  if (state.typedValue.length === 0) {
    return;
  }
  const newValue = state.typedValue.slice(0, -1);
  setTypedValue(newValue);
  const words = newValue.trim().split(/\s+/).filter(Boolean);
  if (!newValue.trim()) {
    state.currentWordIndex = 0;
    state.currentWordBuffer = "";
    state.currentWordPlan = getCurrentWordPlan();
    hideSuggestions();
    updateTypingFeedback();
    return;
  }
  if (newValue.endsWith(" ")) {
    state.currentWordIndex = words.length;
    state.currentWordBuffer = "";
    state.currentWordPlan = getCurrentWordPlan();
    hideSuggestions();
  } else {
    state.currentWordIndex = Math.max(0, words.length - 1);
    state.currentWordBuffer = words[words.length - 1];
    state.currentWordPlan = getCurrentWordPlan();
    if (state.currentWordBuffer.length === 0) {
      hideSuggestions();
    }
  }
  updateSuggestionsForCurrentWord();
  updateTypingFeedback();
};

const commitCharacter = (key, keypressTimestamp) => {
  const commitTimestamp = nowMs();
  if (state.phraseStartMs === null) {
    state.phraseStartMs = keypressTimestamp;
  }
  const baseEvent = buildBaseEvent();
  const plan = getCurrentWordPlan();
  queueEvent("keystrokes", {
    ...baseEvent,
    ...getWordMeta(plan, { correctRank: state.currentCorrectRank }),
    event_type: "keystroke",
    key_pressed: key,
    keypress_timestamp: keypressTimestamp,
    character_commit_timestamp: commitTimestamp,
    suggestion_shown: state.suggestionVisible,
    correct_suggestion_visible: state.correctSuggestionVisible,
  });

  if (key === " ") {
    const typedWord = state.currentWordBuffer;
    setTypedValue(`${state.typedValue} `);
    if (typedWord.length > 0) {
      queueEvent("suggestion_events", {
        ...baseEvent,
        ...getWordMeta(plan, { correctRank: state.currentCorrectRank }),
        event_type: "word_complete",
        typed_word: typedWord,
        completion_timestamp: commitTimestamp,
        correct_suggestion_visible: state.correctSuggestionVisible,
      });
      state.currentWordIndex += 1;
      state.currentWordBuffer = "";
      state.currentWordPlan = getCurrentWordPlan();
      hideSuggestions();
    }
  } else {
    if (state.currentWordBuffer.length === 0) {
      state.currentWordPlan = getCurrentWordPlan();
    }
    setTypedValue(`${state.typedValue}${key}`);
    state.currentWordBuffer += key;
    updateSuggestionsForCurrentWord();
  }

  state.delayActive = false;
  updateTypingFeedback();
  checkPhraseComplete(commitTimestamp);
};

const handleCharacterInput = (key) => {
  const delayMs = state.phase === "practice"
    ? PRACTICE_DELAYS[state.phraseIndex] ?? 0
    : BLOCKS[state.blockIndex].delayMs;
  const keypressTimestamp = nowMs();
  state.delayActive = delayMs > 0;
  setTimeout(() => commitCharacter(key, keypressTimestamp), delayMs);
};

const currentTypedCharCount = () => sanitizeSuggestionWord(state.currentWordBuffer).length;

const resolvePrefixSuggestions = (prefix) => {
  let key = prefix.toLowerCase();
  while (key.length > 0) {
    if (PREFIX_SUGGESTIONS[key]) {
      return PREFIX_SUGGESTIONS[key];
    }
    key = key.slice(0, -1);
  }
  return [];
};

const updateSuggestionsForCurrentWord = () => {
  const plan = getCurrentWordPlan();
  if (!plan) {
    return;
  }
  const typedCount = currentTypedCharCount();
  if (typedCount < 1) {
    hideSuggestions();
    return;
  }
  const entry = plan.suggestionsByIndex?.[typedCount];
  if (entry) {
    const signature = `${typedCount}|${entry.correct_visible}|${entry.correct_rank}`;
    if (state.lastSuggestionSignature !== signature) {
      state.currentSuggestions = entry.suggestions.map((word) => ({
        display: word,
        insert: word,
        isCorrect: false,
      }));
      if (entry.correct_visible) {
        const idx = Math.min(Math.max((entry.correct_rank || 1) - 1, 0), 2);
        state.currentSuggestions[idx] = {
          display: plan.cleanWord,
          insert: plan.targetWord,
          isCorrect: true,
        };
      }
      renderSuggestions(state.currentSuggestions);
      setSuggestionsVisible(true);
      state.suggestionShownForWord = state.currentWordIndex;
      state.correctSuggestionVisible = entry.correct_visible;
      state.currentCorrectRank = entry.correct_rank || null;
      logSuggestionDisplay(plan, state.currentSuggestions, entry.correct_visible, entry.correct_rank);
      state.lastSuggestionSignature = signature;
    }
    return;
  }

  // Fallback for practice or missing precomputed entries using prefix map.
  const shouldShowCorrect = typedCount >= (plan.appearanceIndexK || 1);
  const prefix = sanitizeSuggestionWord(state.currentWordBuffer).toLowerCase();
  const incorrect = resolvePrefixSuggestions(prefix);
  const paddedIncorrect = incorrect.length >= 3 ? incorrect.slice(0, 3) : (incorrect.concat(incorrect)).slice(0, 3);
  const signature = `${typedCount}|fallback|${shouldShowCorrect}|${prefix}`;
  if (state.lastSuggestionSignature !== signature) {
    state.currentSuggestions = paddedIncorrect.map((word) => ({
      display: word,
      insert: word,
      isCorrect: false,
    }));
    if (shouldShowCorrect) {
      const idx = Math.min(Math.max((plan.correctRank || 1) - 1, 0), 2);
      state.currentSuggestions[idx] = {
        display: plan.cleanWord || plan.targetWord,
        insert: plan.targetWord,
        isCorrect: true,
      };
    }
    renderSuggestions(state.currentSuggestions);
    setSuggestionsVisible(true);
    state.suggestionShownForWord = state.currentWordIndex;
    state.correctSuggestionVisible = shouldShowCorrect;
    state.currentCorrectRank = shouldShowCorrect ? (plan.correctRank || 1) : null;
    logSuggestionDisplay(plan, state.currentSuggestions, shouldShowCorrect, state.currentCorrectRank);
    state.lastSuggestionSignature = signature;
  }
};

const acceptSuggestion = (rank) => {
  if (!state.suggestionVisible) {
    return;
  }
  const plan = getCurrentWordPlan();
  const suggestions = state.currentSuggestions;
  const selected = suggestions[rank - 1];
  if (!selected) {
    return;
  }
  const suggestionWord = selected.insert;
  const keypressTimestamp = nowMs();
  const commitTimestamp = nowMs();

  const currentValue = state.typedValue;
  const baseValue = currentValue.slice(0, currentValue.length - state.currentWordBuffer.length);
  let newValue = baseValue + suggestionWord;
  const isLastWord = state.currentWordIndex >= state.phrasePlan.length - 1;
  if (!isLastWord) {
    newValue += " ";
  }
  setTypedValue(newValue);

  queueEvent("suggestion_events", {
    ...buildBaseEvent(),
    ...getWordMeta(plan, { correctRank: state.currentCorrectRank }),
    event_type: "suggestion_accept",
    suggestion_rank: rank,
    suggestion_word: suggestionWord,
    keypress_timestamp: keypressTimestamp,
    commit_timestamp: commitTimestamp,
    correct_suggestion_visible: state.correctSuggestionVisible,
  });

  queueEvent("suggestion_events", {
    ...buildBaseEvent(),
    ...getWordMeta(plan, { correctRank: state.currentCorrectRank }),
    event_type: "word_complete",
    typed_word: suggestionWord,
    completion_timestamp: commitTimestamp,
    correct_suggestion_visible: state.correctSuggestionVisible,
  });

  state.currentWordBuffer = "";
  hideSuggestions();
  if (!isLastWord) {
    state.currentWordIndex += 1;
    state.currentWordPlan = getCurrentWordPlan();
  }

  checkPhraseComplete(commitTimestamp);
  updateTypingFeedback();
};

typingInput.addEventListener("keydown", (event) => {
  if (state.phraseCompleted) {
    event.preventDefault();
    return;
  }
  if (state.delayActive) {
    event.preventDefault();
    return;
  }
  const key = event.key;
  if (key === "Backspace") {
    event.preventDefault();
    handleBackspace();
    return;
  }
  if (state.inputLocked) {
    event.preventDefault();
    return;
  }
  if (key === "1" || key === "2" || key === "3") {
    event.preventDefault();
    acceptSuggestion(Number(key));
    return;
  }
  if (key.length === 1) {
    event.preventDefault();
    handleCharacterInput(key);
    return;
  }
  event.preventDefault();
});

typingInput.addEventListener("focus", () => focusTypingInput());

nextPhraseBtn.addEventListener("click", () => {
  const phrasesInPhase = 3;
  if (state.phraseIndex < phrasesInPhase - 1) {
    state.phraseIndex += 1;
    loadPhrase().catch((error) => setStatus(error.message));
    return;
  }
  nextPhraseBtn.disabled = true;
  nextBlockBtn.classList.remove("hidden");
  setStatus("Block complete. Click Continue.");
});

const openQuestionnaireForBlock = (blockIndex) => {
  state.pendingBlockIndex = blockIndex;
  questionnaireStatus.textContent = "";
  submitQuestionnaire.disabled = true;
  document.querySelectorAll(".likert input").forEach((input) => {
    input.checked = false;
  });
  showPage(pageQuestionnaire);
  updatePageCounter(3 + blockIndex);
};

nextBlockBtn.addEventListener("click", () => {
  if (state.phase === "practice") {
    state.phase = "main";
    state.blockIndex = 0;
    state.phraseIndex = 0;
    updatePageCounter(3);
    updateBlockMeta();
    loadPhrase().catch((error) => setStatus(error.message));
    return;
  }
  openQuestionnaireForBlock(state.blockIndex);
});

const renderLikert = () => {
  document.querySelectorAll(".likert").forEach((container) => {
    const name = container.dataset.question;
    container.innerHTML = "";
    for (let i = 1; i <= 7; i += 1) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = i;
      label.append(input, ` ${i}`);
      container.appendChild(label);
    }
  });
};

const checkQuestionnaireComplete = () => {
  const names = ["perceptual_effort", "cognitive_evaluation", "decision_effort"];
  const complete = names.every((name) => document.querySelector(`input[name="${name}"]:checked`));
  submitQuestionnaire.disabled = !complete;
};

document.addEventListener("change", (event) => {
  if (event.target && event.target.matches(".likert input")) {
    checkQuestionnaireComplete();
  }
});

submitQuestionnaire.addEventListener("click", () => {
  const perceptual = document.querySelector('input[name="perceptual_effort"]:checked')?.value;
  const cognitive = document.querySelector('input[name="cognitive_evaluation"]:checked')?.value;
  const decision = document.querySelector('input[name="decision_effort"]:checked')?.value;

  if (!perceptual || !cognitive || !decision) {
    questionnaireStatus.textContent = "Please answer all questions.";
    return;
  }

  const blockIndex = state.pendingBlockIndex ?? state.blockIndex;
  const blockId = `block_${blockIndex + 1}`;
  queueEvent("questionnaire", {
    participant_id: state.participantId,
    block_id: blockId,
    perceptual_effort: perceptual,
    cognitive_evaluation: cognitive,
    decision_effort: decision,
    timestamp: nowMs(),
  });

  flushEvents()
    .then(() => {
      questionnaireStatus.textContent = "Saved.";
      if (blockIndex < BLOCKS.length - 1) {
        state.blockIndex = blockIndex + 1;
        state.phraseIndex = 0;
        state.pendingBlockIndex = null;
        showPage(pageTyping);
        updatePageCounter(3 + state.blockIndex);
        updateBlockMeta();
        loadPhrase().catch((error) => setStatus(error.message));
      } else {
        const endPayload = {
          participant_id: state.participantId,
          event_type: "session_end",
          experiment_end_time: new Date().toISOString(),
        };
        return postJson("/api/participant", endPayload).then(() => {
          showPage(pageThankyou);
          updatePageCounter(12);
        });
      }
      return null;
    })
    .catch((error) => {
      questionnaireStatus.textContent = error.message;
    });
});

const startPractice = () => {
  state.phase = "practice";
  state.blockIndex = -1;
  state.phraseIndex = 0;
  updatePageCounter(2);
  updateBlockMeta();
  showPage(pageTyping);
  loadPhrase().catch((error) => setStatus(error.message));
};

consentChecks.forEach((check) => {
  check.addEventListener("change", () => {
    consentContinue.disabled = !consentChecks.every((item) => item.checked);
  });
});

if (toggleInfoSheet && infoSheet) {
  toggleInfoSheet.addEventListener("click", () => {
    infoSheet.classList.toggle("hidden");
    toggleInfoSheet.textContent = infoSheet.classList.contains("hidden")
      ? "See the details"
      : "Hide details";
  });
}

consentContinue.addEventListener("click", () => {
  const participantId = `P${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  state.participantId = participantId;
  state.experimentStartIso = new Date().toISOString();
  participantIdLabel.textContent = `Participant ID: ${participantId}`;
  participantIdLabel.classList.remove("hidden");

  postJson("/api/participant", {
    participant_id: participantId,
    consent_time: new Date().toISOString(),
    browser_info: browserInfo(),
    screen_resolution: screenResolution(),
    device_type: isMobile() ? "mobile" : "desktop",
    participation_mode: participationMode.value,
    browser_type: browserType(),
    screen_size: screenSize(),
    experiment_start_time: state.experimentStartIso,
    event_type: "consent",
  })
    .then(() => {
      Promise.all([prefixReady]).then(() => startPractice());
    })
    .catch((error) => {
      participantIdLabel.textContent = error.message;
      participantIdLabel.classList.remove("hidden");
    });
});

renderLikert();
showPage(pageConsent);
updatePageCounter(1);

