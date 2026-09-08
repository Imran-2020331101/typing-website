/**
 * KeyFlow — Competition Module (client-side)
 * Adds async competition support on top of the existing typing test.
 * Loaded after script.js. Communicates via:
 *   - window.onTestComplete(wpm, accuracy, errors, chars)  ← set by this file
 *   - Existing DOM elements (restart buttons, duration buttons, results div)
 */

(function () {
  "use strict";

  /* ── Config ───────────────────────────────────────────────── */
  var API = "/api/competition";

  /* ── State ────────────────────────────────────────────────── */
  var compId = null;
  var compData = null; // { id, duration, metric, deadline, creatorSession, ended, expired }
  var sessionId = null;
  var username = null;
  var isCreator = false;
  var compMode = false;
  var deadlineInterval = null;

  /* ── Cookie helpers ───────────────────────────────────────── */

  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : null;
  }

  function setCookie(name, value, days) {
    var d = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; expires=" +
      d +
      "; path=/; SameSite=Lax";
  }

  /* ── Session ──────────────────────────────────────────────── */

  function initSession() {
    sessionId = getCookie("kf_session");
    if (!sessionId) {
      sessionId = generateSid();
      setCookie("kf_session", sessionId, 30);
    }
    username = getCookie("kf_username") || null;
  }

  function generateSid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, "").substring(0, 16);
    }
    var s = "";
    for (var i = 0; i < 16; i++)
      s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  function displayName() {
    return username || "Anon-" + sessionId.substring(0, 4);
  }

  /* ── API helpers ──────────────────────────────────────────── */

  function apiGet(id) {
    return fetch(API + "?id=" + encodeURIComponent(id))
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return { error: "Could not reach the server. Competitions require Vercel deployment." };
      });
  }

  function apiPost(body) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return { error: "Could not reach the server." };
      });
  }

  /* ── Modal helpers ────────────────────────────────────────── */

  function showModal(id) {
    document.getElementById(id).style.display = "flex";
  }
  function hideModal(id) {
    document.getElementById(id).style.display = "none";
  }

  /* ── Enter / leave competition mode ───────────────────────── */

  function enterCompMode(data) {
    compMode = true;
    compData = data.competition;
    compId = compData.id;
    isCreator = compData.creatorSession === sessionId;

    lockDuration(compData.duration);
    showBanner();

    // Change the compete button to show "In Competition"
    var btn = document.getElementById("comp-btn");
    btn.textContent = "🏆 In Competition";
    btn.title = "Currently in a competition";
  }

  function leaveCompMode() {
    compMode = false;
    compData = null;
    compId = null;
    isCreator = false;

    unlockDuration();
    hideBanner();
    hideLeaderboard();

    // Restore button
    var btn = document.getElementById("comp-btn");
    btn.textContent = "🏆 Compete";
    btn.title = "";

    // Clean URL
    history.pushState(null, "", window.location.pathname);
  }

  /* ── Duration locking ─────────────────────────────────────── */

  function lockDuration(sec) {
    var btn = document.querySelector(
      '.settings button[data-time="' + sec + '"]'
    );
    if (btn && !btn.classList.contains("active")) {
      btn.click(); // triggers duration change + reset in script.js
    }
    document
      .querySelectorAll(".settings button[data-time]")
      .forEach(function (b) {
        b.disabled = true;
      });
    document.querySelector(".settings").classList.add("comp-locked");
  }

  function unlockDuration() {
    document
      .querySelectorAll(".settings button[data-time]")
      .forEach(function (b) {
        b.disabled = false;
      });
    document.querySelector(".settings").classList.remove("comp-locked");
  }

  /* ── Banner ───────────────────────────────────────────────── */

  function showBanner() {
    var banner = document.getElementById("comp-banner");
    var textEl = document.getElementById("comp-banner-text");
    var deadlineEl = document.getElementById("comp-banner-deadline");

    textEl.textContent =
      "Ranked by " + (compData.metric === "wpm" ? "WPM" : "Accuracy");
    updateDeadline(deadlineEl);

    banner.style.display = "flex";

    if (deadlineInterval) clearInterval(deadlineInterval);
    deadlineInterval = setInterval(function () {
      updateDeadline(deadlineEl);
    }, 1000);
  }

  function hideBanner() {
    document.getElementById("comp-banner").style.display = "none";
    if (deadlineInterval) {
      clearInterval(deadlineInterval);
      deadlineInterval = null;
    }
  }

  function updateDeadline(el) {
    if (!compData) return;
    var rem = compData.deadline - Date.now();
    if (compData.ended) {
      el.textContent = "Ended";
      return;
    }
    if (rem <= 0) {
      el.textContent = "Expired";
      return;
    }
    var h = Math.floor(rem / 3600000);
    var m = Math.floor((rem % 3600000) / 60000);
    var s = Math.floor((rem % 60000) / 1000);
    if (h > 0) el.textContent = h + "h " + m + "m left";
    else if (m > 0) el.textContent = m + "m " + s + "s left";
    else el.textContent = s + "s left";
  }

  /* ── Leaderboard ──────────────────────────────────────────── */

  function renderLeaderboard(leaderboard) {
    var container = document.getElementById("comp-leaderboard");
    var tbody = document.getElementById("comp-lb-body");
    var info = document.getElementById("comp-lb-info");
    var endBtn = document.getElementById("comp-end-btn");
    var deadlineEl = document.getElementById("comp-lb-deadline");

    // Info text
    var statusText = "";
    if (compData.ended) statusText = "Competition ended";
    else if (compData.expired || Date.now() > compData.deadline)
      statusText = "Competition expired";
    else statusText = "Ranked by " + (compData.metric === "wpm" ? "WPM" : "Accuracy");
    info.textContent = statusText;

    // Deadline in leaderboard footer
    updateDeadline(deadlineEl);

    // Build rows
    tbody.innerHTML = "";
    if (leaderboard.length === 0) {
      var emptyRow = document.createElement("tr");
      emptyRow.innerHTML =
        '<td colspan="4" style="text-align:center;color:var(--text-dimmed)">No scores yet</td>';
      tbody.appendChild(emptyRow);
    } else {
      leaderboard.forEach(function (entry, i) {
        var tr = document.createElement("tr");
        var isYou = entry.sessionId === sessionId;
        if (isYou) tr.classList.add("comp-you");

        var rankIcon = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1;

        tr.innerHTML =
          "<td>" + rankIcon + "</td>" +
          "<td>" + escapeHtml(entry.name) + (isYou ? " <small>(you)</small>" : "") + "</td>" +
          '<td class="' + (compData.metric === "wpm" ? "comp-metric-hl" : "") + '">' + entry.wpm + "</td>" +
          '<td class="' + (compData.metric === "accuracy" ? "comp-metric-hl" : "") + '">' + entry.accuracy + "%</td>";

        tbody.appendChild(tr);
      });
    }

    // End button — only for creator, only if active
    if (
      isCreator &&
      !compData.ended &&
      !(compData.expired || Date.now() > compData.deadline)
    ) {
      endBtn.style.display = "inline-flex";
    } else {
      endBtn.style.display = "none";
    }

    container.style.display = "block";
    document.body.classList.add("comp-results-visible");

    // Scroll results + leaderboard into view so user doesn't have to scroll
    setTimeout(function () {
      document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function hideLeaderboard() {
    document.getElementById("comp-leaderboard").style.display = "none";
    document.body.classList.remove("comp-results-visible");
  }

  function escapeHtml(str) {
    var d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  /* ── Score submission ─────────────────────────────────────── */

  function submitScore(wpm, accuracy, errors, chars) {
    if (!compMode || !compId) return;

    apiPost({
      action: "submit",
      compId: compId,
      sessionId: sessionId,
      name: displayName(),
      wpm: wpm,
      accuracy: accuracy,
      errors: errors,
      chars: chars,
    }).then(function (result) {
      if (result.error) {
        console.error("Submit error:", result.error);
        return;
      }
      if (result.ended) {
        compData.ended = true;
      }
      if (result.leaderboard) {
        renderLeaderboard(result.leaderboard);
      }
    });
  }

  /* ── Create competition ───────────────────────────────────── */

  function createCompetition() {
    var dur = parseInt(document.getElementById("comp-duration").value, 10);
    var met = document.getElementById("comp-metric").value;
    var hrs = parseInt(document.getElementById("comp-deadline").value, 10);
    var name = document.getElementById("comp-creator-name").value.trim();

    if (name) {
      username = name;
      setCookie("kf_username", username, 30);
    }

    var createBtn = document.getElementById("comp-create-btn");
    createBtn.disabled = true;
    createBtn.textContent = "Creating…";

    apiPost({
      action: "create",
      duration: dur,
      metric: met,
      deadlineHours: hrs,
      creatorSession: sessionId,
      creatorName: displayName(),
    }).then(function (result) {
      createBtn.disabled = false;
      createBtn.textContent = "Create";

      if (result.error) {
        alert("Error: " + result.error);
        return;
      }

      compId = result.id;

      // Show link
      var link =
        window.location.origin +
        window.location.pathname +
        "?comp=" +
        compId;
      document.getElementById("comp-link-input").value = link;
      document.getElementById("comp-link-area").style.display = "block";
      document.getElementById("comp-create-form").style.display = "none";

      // Update URL
      history.pushState(null, "", "?comp=" + compId);

      // Fetch full data & enter mode
      apiGet(compId).then(function (data) {
        if (!data.error) {
          enterCompMode(data);
        }
      });
    });
  }

  /* ── Join competition ─────────────────────────────────────── */

  function joinCompetition(id) {
    apiGet(id).then(function (data) {
      if (data.error) {
        alert(data.error);
        history.pushState(null, "", window.location.pathname);
        return;
      }

      // Prompt for name if we don't have one
      if (!username) {
        window._pendingCompData = data;
        showModal("comp-name-modal");
        // Focus the name input
        setTimeout(function () {
          document.getElementById("comp-name-input").focus();
        }, 100);
      } else {
        enterCompMode(data);
        // If already ended, show final leaderboard
        if (data.competition.ended || data.competition.expired) {
          renderLeaderboard(data.leaderboard);
        }
      }
    });
  }

  /* ── End competition ──────────────────────────────────────── */

  function endCompetition() {
    if (!compId || !isCreator) return;
    if (!confirm("End this competition? This cannot be undone.")) return;

    apiPost({
      action: "end",
      compId: compId,
      sessionId: sessionId,
    }).then(function (result) {
      if (result.error) {
        alert("Error: " + result.error);
        return;
      }
      compData.ended = true;
      // Refresh leaderboard
      apiGet(compId).then(function (data) {
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
      });
    });
  }

  /* ── MutationObserver — auto-hide leaderboard on test reset ─ */

  function setupObserver() {
    var resultsEl = document.getElementById("results");
    var obs = new MutationObserver(function () {
      if (!resultsEl.classList.contains("visible")) {
        hideLeaderboard();
      }
    });
    obs.observe(resultsEl, { attributes: true, attributeFilter: ["class"] });
  }

  /* ── Hook: test completion ────────────────────────────────── */

  window.onTestComplete = function (wpm, accuracy, errors, chars) {
    if (compMode) {
      submitScore(wpm, accuracy, errors, chars);
    }
  };

  /* ── Event listeners ──────────────────────────────────────── */

  function bindEvents() {
    // Open create modal
    document.getElementById("comp-btn").addEventListener("click", function () {
      if (compMode) {
        // Already in competition — offer to leave or copy link
        if (
          confirm(
            "You are in a competition.\n\nPress OK to leave, or Cancel to stay."
          )
        ) {
          leaveCompMode();
        }
        return;
      }
      // Reset form state
      document.getElementById("comp-create-form").style.display = "block";
      document.getElementById("comp-link-area").style.display = "none";
      showModal("comp-create-modal");
    });

    // Create
    document
      .getElementById("comp-create-btn")
      .addEventListener("click", createCompetition);

    // Cancel create
    document
      .getElementById("comp-create-cancel")
      .addEventListener("click", function () {
        hideModal("comp-create-modal");
      });

    // Close create (after link shown) → start typing
    document
      .getElementById("comp-create-close")
      .addEventListener("click", function () {
        hideModal("comp-create-modal");
        // Focus typing
        document.getElementById("hidden-input").focus({ preventScroll: true });
      });

    // Copy link
    document
      .getElementById("comp-link-copy")
      .addEventListener("click", function () {
        var input = document.getElementById("comp-link-input");
        var btn = this;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(input.value).then(function () {
            btn.textContent = "Copied!";
            setTimeout(function () {
              btn.textContent = "Copy";
            }, 2000);
          });
        } else {
          input.select();
          document.execCommand("copy");
          btn.textContent = "Copied!";
          setTimeout(function () {
            btn.textContent = "Copy";
          }, 2000);
        }
      });

    // Name submit
    document
      .getElementById("comp-name-submit")
      .addEventListener("click", function () {
        var name = document.getElementById("comp-name-input").value.trim();
        if (name) {
          username = name;
          setCookie("kf_username", username, 30);
        }
        hideModal("comp-name-modal");
        if (window._pendingCompData) {
          enterCompMode(window._pendingCompData);
          if (
            window._pendingCompData.competition.ended ||
            window._pendingCompData.competition.expired
          ) {
            renderLeaderboard(window._pendingCompData.leaderboard);
          }
          delete window._pendingCompData;
        }
      });

    // Name skip
    document
      .getElementById("comp-name-skip")
      .addEventListener("click", function () {
        hideModal("comp-name-modal");
        if (window._pendingCompData) {
          enterCompMode(window._pendingCompData);
          if (
            window._pendingCompData.competition.ended ||
            window._pendingCompData.competition.expired
          ) {
            renderLeaderboard(window._pendingCompData.leaderboard);
          }
          delete window._pendingCompData;
        }
      });

    // Name input — Enter key submits
    document
      .getElementById("comp-name-input")
      .addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          document.getElementById("comp-name-submit").click();
        }
      });

    // End competition
    document
      .getElementById("comp-end-btn")
      .addEventListener("click", endCompetition);

    // Leave competition (banner button)
    document
      .getElementById("comp-leave-btn")
      .addEventListener("click", function () {
        leaveCompMode();
      });
  }

  /* ── Init ─────────────────────────────────────────────────── */

  function init() {
    initSession();
    bindEvents();
    setupObserver();

    // Check URL for competition
    var params = new URLSearchParams(window.location.search);
    var urlComp = params.get("comp");
    if (urlComp) {
      joinCompetition(urlComp);
    }
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
