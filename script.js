/**
 * KeyFlow — Typing Speed Test
 * Pure vanilla JS, no dependencies.
 */

(function () {
  "use strict";

  /* ── DOM refs ─────────────────────────────────────────────── */
  const $words      = document.getElementById("words");
  const $typingArea = document.getElementById("typing-area");
  const $input      = document.getElementById("hidden-input");
  const $caret      = document.getElementById("caret");
  const $blur       = document.getElementById("blur-overlay");

  const $statWpm    = document.getElementById("stat-wpm");
  const $statAcc    = document.getElementById("stat-acc");
  const $statTime   = document.getElementById("stat-time");
  const $statErrors = document.getElementById("stat-errors");

  const $results       = document.getElementById("results");
  const $resWpm        = document.getElementById("res-wpm");
  const $resAcc        = document.getElementById("res-acc");
  const $resErrors     = document.getElementById("res-errors");
  const $resChars      = document.getElementById("res-chars");
  const $resultsRestart = document.getElementById("results-restart");
  const $restartBtn    = document.getElementById("restart-btn");

  const $durationBtns  = document.querySelectorAll(".settings button[data-time]");

  /* ── State ────────────────────────────────────────────────── */
  let duration       = 30;   // seconds
  let timerInterval  = null;
  let started        = false;
  let finished       = false;
  let startTime      = 0;
  let timeLeft       = 30;

  let wordList       = [];   // array of word strings
  let charIndex      = 0;    // current position in the flat char list
  let totalCorrect   = 0;
  let totalIncorrect = 0;
  let totalTyped     = 0;

  // Per-word tracking
  let currentWordIdx = 0;
  let currentCharIdx = 0;    // position within the current word (including space)

  // Tab-Enter restart shortcut
  let tabPressed     = false;

  /* ── Word generation ──────────────────────────────────────── */

  /** Return `count` randomly-picked words, avoiding heavy repeats. */
  function generateWords(count) {
    const result = [];
    const len = WORDS.length;
    let lastPick = -1;
    for (let i = 0; i < count; i++) {
      let idx;
      do {
        idx = Math.floor(Math.random() * len);
      } while (idx === lastPick);
      lastPick = idx;
      result.push(WORDS[idx]);
    }
    return result;
  }

  /** How many words to generate for a given duration. */
  function wordCountForDuration(sec) {
    // ~70 wpm × duration/60 × 1.5 safety margin ≈ words needed
    return Math.max(80, Math.ceil((sec / 60) * 70 * 1.5));
  }

  /* ── Render words into DOM ────────────────────────────────── */

  function renderWords() {
    $words.innerHTML = "";
    wordList.forEach(function (word, wi) {
      var wordEl = document.createElement("div");
      wordEl.classList.add("word");
      wordEl.dataset.index = wi;

      for (var ci = 0; ci < word.length; ci++) {
        var span = document.createElement("span");
        span.classList.add("letter");
        span.textContent = word[ci];
        wordEl.appendChild(span);
      }
      $words.appendChild(wordEl);
    });
  }

  /* ── Caret positioning ────────────────────────────────────── */

  function updateCaret() {
    var wordEls = $words.querySelectorAll(".word");
    if (currentWordIdx >= wordEls.length) return;

    var wordEl = wordEls[currentWordIdx];
    var letters = wordEl.querySelectorAll(".letter");
    var target;

    if (currentCharIdx < letters.length) {
      target = letters[currentCharIdx];
    } else if (letters.length > 0) {
      target = letters[letters.length - 1];
    } else {
      return;
    }

    var aRect = $typingArea.getBoundingClientRect();
    var tRect = target.getBoundingClientRect();

    var left, top;
    if (currentCharIdx < letters.length) {
      left = tRect.left - aRect.left;
    } else {
      left = tRect.right - aRect.left;
    }
    top = tRect.top - aRect.top;

    $caret.style.left = left + "px";
    $caret.style.top  = top + "px";
  }

  /* ── Line scrolling ───────────────────────────────────────── */

  function scrollWords() {
    var wordEls = $words.querySelectorAll(".word");
    if (currentWordIdx >= wordEls.length) return;

    var currentEl = wordEls[currentWordIdx];
    var wordsRect = $words.getBoundingClientRect();
    var wordRect  = currentEl.getBoundingClientRect();

    // If the current word is below the second visible line, scroll up
    var lineHeight = parseFloat(getComputedStyle($words).lineHeight) || 
                     parseFloat(getComputedStyle($words).fontSize) * 2.2;
    var offset = wordRect.top - wordsRect.top;

    if (offset > lineHeight * 1.2) {
      // Shift words up by the amount needed to keep current word on line 1
      var shift = offset - lineHeight * 0.1;
      $words.style.transform = "translateY(-" + shift + "px)";
    }
  }

  /* ── Timer ────────────────────────────────────────────────── */

  function startTimer() {
    startTime = Date.now();
    timeLeft = duration;
    $statTime.textContent = timeLeft;

    timerInterval = setInterval(function () {
      var elapsed = (Date.now() - startTime) / 1000;
      timeLeft = Math.max(0, Math.ceil(duration - elapsed));
      $statTime.textContent = timeLeft;

      updateLiveStats(elapsed);

      if (timeLeft <= 0) {
        endTest();
      }
    }, 200);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  /* ── Stats ────────────────────────────────────────────────── */

  function updateLiveStats(elapsedSec) {
    if (elapsedSec <= 0) elapsedSec = 0.1;
    var minutes = elapsedSec / 60;
    var wpm = Math.round(totalCorrect / 5 / minutes);
    var acc = totalTyped > 0 ? Math.round((totalCorrect / totalTyped) * 100) : 100;

    $statWpm.textContent    = wpm;
    $statAcc.textContent    = acc;
    $statErrors.textContent = totalIncorrect;
  }

  /* ── End test ─────────────────────────────────────────────── */

  function endTest() {
    finished = true;
    stopTimer();

    var elapsed = (Date.now() - startTime) / 1000;
    if (elapsed <= 0) elapsed = 0.1;
    var minutes = elapsed / 60;
    var wpm = Math.round(totalCorrect / 5 / minutes);
    var acc = totalTyped > 0 ? Math.round((totalCorrect / totalTyped) * 100) : 100;

    $resWpm.textContent    = wpm;
    $resAcc.textContent    = acc + "%";
    $resErrors.textContent = totalIncorrect;
    $resChars.textContent  = totalTyped;

    // Hide typing content, show results
    $words.style.display  = "none";
    $caret.style.display  = "none";
    $results.classList.add("visible");

    // Notify competition module (if loaded)
    if (typeof window.onTestComplete === "function") {
      window.onTestComplete(wpm, acc, totalIncorrect, totalTyped);
    }
  }

  /* ── Reset / Restart ──────────────────────────────────────── */

  function resetTest() {
    stopTimer();
    started  = false;
    finished = false;
    startTime = 0;
    timeLeft  = duration;

    charIndex      = 0;
    totalCorrect   = 0;
    totalIncorrect = 0;
    totalTyped     = 0;
    currentWordIdx = 0;
    currentCharIdx = 0;

    $statWpm.textContent    = "0";
    $statAcc.textContent    = "100";
    $statTime.textContent   = duration;
    $statErrors.textContent = "0";

    $words.style.display  = "";
    $words.style.transform = "";
    $caret.style.display  = "";
    $results.classList.remove("visible");

    wordList = generateWords(wordCountForDuration(duration));
    renderWords();

    // Reset caret
    requestAnimationFrame(function () {
      updateCaret();
    });

    focusInput();
  }

  /* ── Focus management ─────────────────────────────────────── */

  function focusInput() {
    $input.focus({ preventScroll: true });
  }

  function onFocusChange() {
    if (document.activeElement === $input) {
      $typingArea.classList.remove("blurred");
    } else {
      if (!finished) {
        $typingArea.classList.add("blurred");
      }
    }
  }

  /* ── Input handling ───────────────────────────────────────── */

  function handleKeyDown(e) {
    if (finished) {
      // Allow Tab+Enter to restart even when finished
      if (e.key === "Tab") {
        tabPressed = true;
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && tabPressed) {
        e.preventDefault();
        tabPressed = false;
        resetTest();
        return;
      }
      tabPressed = false;
      return;
    }

    // Tab+Enter restart shortcut
    if (e.key === "Tab") {
      tabPressed = true;
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" && tabPressed) {
      e.preventDefault();
      tabPressed = false;
      resetTest();
      return;
    }
    if (e.key !== "Tab") {
      tabPressed = false;
    }

    // Caret goes into "typing" mode (no blink)
    $caret.classList.add("typing");
    clearTimeout($caret._blinkTimeout);
    $caret._blinkTimeout = setTimeout(function () {
      $caret.classList.remove("typing");
    }, 500);

    // ── Backspace (must come before the Ctrl guard) ──
    if (e.key === "Backspace") {
      e.preventDefault();
      handleBackspace(e.ctrlKey);
      return;
    }

    // Allow browser shortcuts (Ctrl+C, Cmd+R, etc.) through
    if (e.ctrlKey || e.metaKey) return;

    // Ignore modifier-only keys
    if (e.key.length > 1 && e.key !== "Backspace") return;

    e.preventDefault();

    // Start timer on first real keypress
    if (!started) {
      started = true;
      startTimer();
    }

    handleCharInput(e.key);
  }

  function handleCharInput(char) {
    var wordEls = $words.querySelectorAll(".word");
    if (currentWordIdx >= wordEls.length) return;

    var wordEl  = wordEls[currentWordIdx];
    var letters = wordEl.querySelectorAll(".letter");
    var word    = wordList[currentWordIdx];

    // Space → advance to next word
    if (char === " ") {
      // Only advance if we've typed at least something
      if (currentCharIdx > 0) {
        // Mark remaining letters as incorrect (skipped)
        for (var i = currentCharIdx; i < word.length; i++) {
          if (!letters[i].classList.contains("correct") && !letters[i].classList.contains("incorrect")) {
            letters[i].classList.add("incorrect");
            totalIncorrect++;
            totalTyped++;
          }
        }
        currentWordIdx++;
        currentCharIdx = 0;

        // Generate more words if running low
        if (currentWordIdx >= wordList.length - 10) {
          var extra = generateWords(40);
          wordList = wordList.concat(extra);
          extra.forEach(function (w, idx) {
            var we = document.createElement("div");
            we.classList.add("word");
            we.dataset.index = wordList.length - 40 + idx;
            for (var ci = 0; ci < w.length; ci++) {
              var sp = document.createElement("span");
              sp.classList.add("letter");
              sp.textContent = w[ci];
              we.appendChild(sp);
            }
            $words.appendChild(we);
          });
        }

        scrollWords();
        updateCaret();
      }
      return;
    }

    // Typing a character
    if (currentCharIdx < word.length) {
      // Normal character position
      var expected = word[currentCharIdx];
      totalTyped++;
      if (char === expected) {
        letters[currentCharIdx].classList.add("correct");
        totalCorrect++;
      } else {
        letters[currentCharIdx].classList.add("incorrect");
        totalIncorrect++;
      }
      currentCharIdx++;
    } else {
      // Extra characters beyond word length
      totalTyped++;
      totalIncorrect++;
      var extra = document.createElement("span");
      extra.classList.add("letter", "extra", "incorrect");
      extra.textContent = char;
      wordEl.appendChild(extra);
      currentCharIdx++;
    }

    updateCaret();
  }

  function handleBackspace(ctrlKey) {
    var wordEls = $words.querySelectorAll(".word");

    if (ctrlKey) {
      // Ctrl+Backspace: delete entire current word progress
      if (currentCharIdx === 0 && currentWordIdx > 0) {
        // Go back to previous word
        currentWordIdx--;
      }
      var wEl = wordEls[currentWordIdx];
      var lets = wEl.querySelectorAll(".letter");

      // Remove extras
      wEl.querySelectorAll(".letter.extra").forEach(function (el) { el.remove(); });

      // Clear states, adjust counters
      for (var i = 0; i < lets.length; i++) {
        if (lets[i].classList.contains("extra")) continue;
        if (lets[i].classList.contains("correct")) {
          totalCorrect--;
          totalTyped--;
        } else if (lets[i].classList.contains("incorrect")) {
          totalIncorrect--;
          totalTyped--;
        }
        lets[i].classList.remove("correct", "incorrect");
      }
      currentCharIdx = 0;
      updateCaret();
      scrollWords();
      return;
    }

    // Normal backspace
    if (currentCharIdx > 0) {
      currentCharIdx--;
      var wordEl  = wordEls[currentWordIdx];
      var letters = wordEl.querySelectorAll(".letter");

      if (currentCharIdx < letters.length) {
        var letter = letters[currentCharIdx];
        if (letter.classList.contains("extra")) {
          // Remove extra character
          letter.remove();
          totalIncorrect--;
          totalTyped--;
        } else {
          if (letter.classList.contains("correct")) {
            totalCorrect--;
          } else if (letter.classList.contains("incorrect")) {
            totalIncorrect--;
          }
          totalTyped--;
          letter.classList.remove("correct", "incorrect");
        }
      }
      updateCaret();
    }
    // Don't go back to previous words on normal backspace (standard behavior)
  }

  /* ── Event listeners ──────────────────────────────────────── */

  // Focus
  $typingArea.addEventListener("click", focusInput);
  $input.addEventListener("focus", onFocusChange);
  $input.addEventListener("blur", onFocusChange);

  // On any key while body is focused, redirect to input
  // (but don't steal focus from modal inputs or other form fields)
  document.addEventListener("keydown", function (e) {
    if (document.activeElement !== $input && !finished) {
      var tag = document.activeElement.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key.length === 1 || e.key === "Backspace") {
        focusInput();
      }
    }
  });

  // Typing
  $input.addEventListener("keydown", handleKeyDown);

  // Prevent mobile keyboard from doing autocomplete weirdness
  $input.addEventListener("input", function (e) {
    $input.value = "";
  });

  // Duration buttons
  $durationBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      $durationBtns.forEach(function (b) {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      duration = parseInt(btn.dataset.time, 10);
      resetTest();
    });
  });

  // Restart buttons
  $restartBtn.addEventListener("click", function () {
    resetTest();
  });
  $resultsRestart.addEventListener("click", function () {
    resetTest();
  });

  // Prevent text selection in typing area
  $typingArea.addEventListener("selectstart", function (e) {
    e.preventDefault();
  });

  // Re-focus on window focus (but not if a modal input is active)
  window.addEventListener("focus", function () {
    if (!finished) {
      var tag = document.activeElement.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      focusInput();
    }
  });

  /* ── Init ─────────────────────────────────────────────────── */

  resetTest();
})();
