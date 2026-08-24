/* ============================================================
   RowBot — front end
   Motion: anime.js v4 (pinned). Pinning matters here: an unpinned CDN
   import runs whatever that URL serves tomorrow, with full DOM access
   to the API key field.
   ============================================================ */
import { animate, createTimeline, stagger, utils } from "https://esm.sh/animejs@4.5.0";
import { splitText } from "https://esm.sh/animejs@4.5.0/text";
import { initParticles } from "./particles.js";
import { createGame } from "./game.js";

/* ---------- config ---------- */
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_BASE = IS_LOCAL ? "http://localhost:8000" : "https://rowbot-backend.onrender.com";
const WS_URL   = IS_LOCAL ? "ws://localhost:8000/ws" : "wss://rowbot-backend.onrender.com/ws";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Collapse every duration to ~0 when the user asked for less motion. */
const dur = (ms) => (REDUCED ? 0 : ms);

/* ---------- dom ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  heroTitle:   $("heroTitle"),
  connStatus:  $("connStatus"),
  connLabel:   $("connLabel"),
  connPop:      $("connPop"),
  connPopTitle: $("connPopTitle"),
  connPopBody:  $("connPopBody"),
  connPopClose: $("connPopClose"),
  apiKeyInput: $("apiKeyInput"),
  toggleKeyBtn:$("toggleKeyBtn"),
  dropzone:    $("dropzone"),
  fileInput:   $("fileInput"),
  fileMeta:    $("fileMeta"),
  uploadBtn:   $("uploadBtn"),
  uploadStatus:$("uploadStatus"),
  chatInput:   $("chatInput"),
  sendBtn:     $("sendBtn"),
  chips:       $("chips"),
  results:     $("results"),
  resultMeta:  $("resultMeta"),
  emptyState:  $("emptyState"),
  thinking:    $("thinking"),
  thinkingText:$("thinkingText"),
  sqlBlock:    $("sqlBlock"),
  sqlQuery:    $("sqlQuery"),
  copySqlBtn:  $("copySqlBtn"),
  queryResult: $("queryResult"),
  toasts:      $("toasts"),
};

let ws;
let reconnectDelay = 1000;      // grows on repeated failure
let thinkingLoop = null;

/* ============================================================
   API key — memory only, never persisted
   ============================================================ */
function getApiKey() {
  return els.apiKeyInput.value.trim();
}

function requireApiKey() {
  if (getApiKey()) return true;
  toast("Add your Gemini API key first.", "error");
  shake(els.apiKeyInput.closest(".input-wrap"));
  els.apiKeyInput.focus();
  return false;
}

function toggleKeyVisibility() {
  const hidden = els.apiKeyInput.type === "password";
  els.apiKeyInput.type = hidden ? "text" : "password";
  els.toggleKeyBtn.textContent = hidden ? "Hide" : "Show";
  els.toggleKeyBtn.setAttribute("aria-label", hidden ? "Hide API key" : "Show API key");
}

/* ============================================================
   Toasts — replaces blocking alert()
   ============================================================ */
const TOAST_ICON = { success: "✓", error: "!", info: "•" };

function toast(message, tone = "info", ttl = 4200) {
  const el = document.createElement("div");
  el.className = `toast toast--${tone}`;
  el.innerHTML = `<span class="toast__icon"></span><span class="toast__body"></span>`;
  el.querySelector(".toast__icon").textContent = TOAST_ICON[tone] ?? "•";
  el.querySelector(".toast__body").textContent = message;   // textContent: never inject
  els.toasts.appendChild(el);

  animate(el, {
    opacity: [0, 1],
    x: [40, 0],
    scale: [0.94, 1],
    duration: dur(420),
    ease: "outExpo",
  });

  setTimeout(() => {
    animate(el, {
      opacity: 0,
      x: 40,
      duration: dur(280),
      ease: "inQuad",
      onComplete: () => el.remove(),
    });
  }, ttl);
}

function shake(el) {
  if (!el || REDUCED) return;
  animate(el, {
    x: [0, -7, 6, -4, 3, 0],
    duration: 420,
    ease: "outQuad",
  });
}

/* ============================================================
   Connection status
   ============================================================ */
const CONN_TITLE = {
  online:     "Live connection to the RowBot server. Queries will run.",
  connecting: "Opening a connection to the RowBot server. Queries can't run until this is live.",
  offline:    "No connection to the RowBot server — retrying automatically.",
};

let dotPulse = null;
let coldStartTimers = [];

/* ---------- connection explainer popover ---------- */
const CONN_POP = {
  waking: {
    tone: "ok",
    title: "Give it a minute (or two)",
    body: "Have you seen our hosting plan? It's free, so the server naps between visitors. Waking it takes 1–2 minutes. Everything after that is quick, promise.",
  },
  snoozing: {
    tone: "ok",
    title: "The server hit snooze",
    body: "It's technically awake, it just isn't getting up yet. Another minute should do it. Free hosting has boundaries and we respect them.",
  },
  retrying: {
    tone: "error",
    title: "Lost the server",
    body: "It wandered off mid-conversation. We're knocking every few seconds and it usually answers within a minute or two. No need to refresh.",
  },
  noAnswer: {
    tone: "error",
    title: "Knocking. No answer yet.",
    body: "The server is almost certainly asleep — have you seen our hosting plan? It's free, so it naps between visitors. We'll keep knocking; give it 1–2 minutes.",
  },
  uploadStalled: {
    tone: "ok",
    title: "Your file is sent — now we wait",
    body: "The server hasn't answered yet. It naps between visitors on the free plan, so the first upload takes 1–2 minutes to get through. Nothing is broken.",
  },
  unreachable: {
    tone: "error",
    title: "The server isn't answering",
    body: "Either it's still asleep or it's having a moment. Give it another minute, then try a refresh. It almost always comes round.",
  },
};

let popKeyShowing = null;
let popDismissed = null;
let hadConnection = false;   // distinguishes "never connected" from "dropped"

function showConnPop(key) {
  const copy = CONN_POP[key];
  if (!copy) return;
  if (popKeyShowing === key) return;   // already up, don't restart it
  if (popDismissed === key) return;    // user closed this one

  popKeyShowing = key;
  els.connPopTitle.textContent = copy.title;
  els.connPopBody.textContent = copy.body;
  els.connPop.dataset.tone = copy.tone;
  els.connPop.hidden = false;

  animate(els.connPop, {
    opacity: [0, 1],
    y: [-10, 0],
    scale: [0.96, 1],
    duration: dur(360),
    ease: "outExpo",
  });
}

function hideConnPop() {
  if (els.connPop.hidden) return;
  popKeyShowing = null;

  animate(els.connPop, {
    opacity: 0,
    y: -8,
    duration: dur(220),
    ease: "inQuad",
    onComplete: () => { els.connPop.hidden = true; },
  });
}

function dismissConnPop() {
  popDismissed = popKeyShowing;   // stays closed until a different state occurs
  hideConnPop();
}

function setConn(state, label) {
  els.connStatus.dataset.state = state;
  els.connLabel.textContent = label;
  els.connStatus.title = CONN_TITLE[state] ?? "";

  // Only the online state pulses; stop any previous loop so they don't stack.
  if (dotPulse) {
    dotPulse.pause();
    dotPulse = null;
  }
  if (state === "online" && !REDUCED) {
    dotPulse = animate(els.connStatus.querySelector(".status__dot"), {
      scale: [1, 1.9, 1],
      opacity: [1, 0.5, 1],
      duration: 1600,
      loop: true,
      ease: "inOutQuad",
    });
  }
}

function clearColdStartTimers() {
  coldStartTimers.forEach(clearTimeout);
  coldStartTimers = [];
}

/* A free-tier backend sleeps after inactivity and takes ~50s to wake.
   A pill that just says "Connecting" for a minute looks broken, so say why —
   and say it in a way that makes the wait bearable. */
function watchColdStart() {
  // Armed ONCE, timed from the first attempt. Re-arming per attempt meant a
  // fast-failing socket cleared these every ~1s and they never fired at all.
  if (coldStartTimers.length) return;
  const asleep = () => ws?.readyState !== WebSocket.OPEN;

  coldStartTimers.push(
    setTimeout(() => {
      if (!asleep()) return;
      setConn("connecting", "Poking the server");
      showConnPop("waking");        // popover replaces the old toast here
      callMysteryBox(true);          // and the box starts asking to be clicked
    }, 5000),
    setTimeout(() => {
      if (!asleep()) return;
      setConn("connecting", "Server hit snooze");
      showConnPop("snoozing");
    }, 20000),
    setTimeout(() => {
      if (asleep()) setConn("connecting", "Making it coffee");
    }, 38000),
    setTimeout(() => {
      if (!asleep()) return;
      setConn("offline", "Server unreachable");
      showConnPop("unreachable");
    }, 100000)
  );
}

function connectWebSocket() {
  setConn("connecting", "Connecting");
  watchColdStart();
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    reconnectDelay = 1000;
    clearColdStartTimers();
    setConn("online", "Connected");
    hadConnection = true;
    // Connected — the explainer is moot, and a fresh stall should show again.
    popDismissed = null;
    hideConnPop();
    callMysteryBox(false);
    // Never yank a player out mid-run; just let them know.
    game?.notifyReady("Server's awake — finish your run, then Esc.");
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      stopThinking();
      toast("Received a malformed response from the server.", "error");
      return;
    }

    stopThinking();

    if (data.error) {
      toast(String(data.error), "error", 6000);
      return;
    }
    if (data.sql_query) showSql(data.sql_query);
    if (data.data && data.data.result) renderTable(data.data.result);
  };

  ws.onerror = () => setConn("offline", "Connection error");

  ws.onclose = () => {
    // NB: cold-start timers are deliberately NOT cleared here. A refused
    // socket closes in ~1s, and clearing meant the explainer never fired.
    setConn("offline", "Reconnecting…");
    // Different story depending on whether we ever got through.
    showConnPop(hadConnection ? "retrying" : "noAnswer");
    stopThinking();
    // Exponential backoff, capped — the backend cold-starts slowly on free tiers.
    setTimeout(connectWebSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  };
}

/* ============================================================
   Upload
   ============================================================ */
function describeFile(file) {
  const kb = file.size / 1024;
  const size = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  return `${file.name} · ${size}`;
}

function onFileChosen() {
  const file = els.fileInput.files[0];
  if (!file) {
    els.fileMeta.textContent = "No file selected";
    els.dropzone.classList.remove("has-file");
    return;
  }
  els.fileMeta.textContent = describeFile(file);
  els.dropzone.classList.add("has-file");

  animate(els.dropzone.querySelector(".dropzone__icon"), {
    scale: [1, 1.18, 1],
    rotate: [0, -8, 0],
    duration: dur(560),
    ease: "outBack",
  });
  animate(els.fileMeta, {
    opacity: [0, 1],
    y: [6, 0],
    duration: dur(360),
    ease: "outExpo",
  });
}

/* The upload hits the same sleeping server as the socket does, so it stalls
   just as long. Same treatment: say why, and don't hang forever. */
const UPLOAD_LINES = [
  "Uploading your file…",
  "Sent. Waiting on the server to answer…",
  "Have you seen our hosting plan? It's free, so the server naps between visitors.",
  "Still nudging it. This is the slow part — it only happens once.",
  "Any moment now. Free tier, remember.",
];

const UPLOAD_TIMEOUT_MS = 150000;   // longer than a worst-case cold start
let uploadLineTimer = null;

function startUploadLines() {
  let i = 0;
  setStatus(UPLOAD_LINES[0]);
  clearInterval(uploadLineTimer);
  uploadLineTimer = setInterval(() => {
    if (i >= UPLOAD_LINES.length - 1) return;   // hold on the last line
    i += 1;
    setStatus(UPLOAD_LINES[i]);
  }, 7000);
}

function stopUploadLines() {
  clearInterval(uploadLineTimer);
  uploadLineTimer = null;
}

function setStatus(text, tone = "ok") {
  els.uploadStatus.textContent = text;
  els.uploadStatus.dataset.tone = tone === "error" ? "error" : "ok";
  if (text) {
    animate(els.uploadStatus, { opacity: [0, 1], duration: dur(280), ease: "outQuad" });
  }
}

function uploadFile() {
  if (!requireApiKey()) return;

  const file = els.fileInput.files[0];
  if (!file) {
    toast("Choose a file to upload first.", "error");
    shake(els.dropzone);
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  // The key is deliberately NOT sent here. Upload just parses the file into
  // SQLite — no model call — so there's no reason to put the secret on the
  // wire. It travels only with the query, over the socket.

  setBusy(els.uploadBtn, true, "Uploading…");
  startUploadLines();

  // Only explain once the backend has actually failed to answer — popping the
  // panel on click would cry wolf on every fast upload.
  const stallTimer = setTimeout(() => {
    popKeyShowing = null;
    popDismissed = null;
    showConnPop("uploadStalled");
  }, 6000);

  // No timeout means a permanently-asleep server hangs the UI forever.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  fetch(`${API_BASE}/upload/`, {
    method: "POST",
    body: formData,
    referrerPolicy: "no-referrer",
    signal: controller.signal,
  })
    .then((resp) => {
      if (!resp.ok) throw new Error(`Upload failed (${resp.status})`);
      return resp.json();
    })
    .then((data) => {
      if (data.error) throw new Error(data.error);

      setStatus(data.message || "File uploaded.");
      toast("File uploaded — table is ready.", "success");
      pulse(els.dropzone);

      // Backend returns the table name inside its message; non-greedy so a
      // second quoted phrase can't swallow the capture.
      const match = (data.message || "").match(/'(.+?)'/);
      const tableName = match ? match[1] : null;
      if (tableName) sendQuery(`Show all rows from ${tableName}`);
    })
    .catch((err) => {
      // Log the message only — never the payload, which carries the key.
      console.error("Upload failed:", err.message);

      if (err.name === "AbortError") {
        setStatus("Gave up waiting on the server.", "error");
        toast("The server never woke up. Give it a minute and try again — it usually comes round.", "error", 8000);
        popKeyShowing = null;
        popDismissed = null;
        showConnPop("unreachable");
        return;
      }
      setStatus(err.message || "Upload failed.", "error");
      toast("Upload failed. Check your API key and the file format.", "error", 6000);
    })
    .finally(() => {
      clearTimeout(stallTimer);
      clearTimeout(timeoutId);
      stopUploadLines();
      setBusy(els.uploadBtn, false, "Upload file");
      // Clear the stall panel once it's resolved either way; a genuine
      // connection failure will have swapped in its own message already.
      if (popKeyShowing === "uploadStalled") hideConnPop();
    });
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.querySelector(".btn__label").textContent = label;
}

function pulse(el) {
  if (REDUCED) return;
  animate(el, {
    scale: [1, 1.015, 1],
    duration: 620,
    ease: "outQuad",
  });
}

/* ============================================================
   Query
   ============================================================ */
function sendQuery(prompt) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast("Not connected to the server yet — hold on a moment.", "error");
    return;
  }
  if (!requireApiKey()) return;

  // Refuse to put the key on an unencrypted socket outside local dev.
  if (!IS_LOCAL && !WS_URL.startsWith("wss://")) {
    toast("Refusing to send your API key over an unencrypted connection.", "error");
    return;
  }

  startThinking();
  ws.send(JSON.stringify({
    command: "chat_to_sql",
    message: prompt,
    api_key: getApiKey(),
  }));
}

function sendChat() {
  const message = els.chatInput.value.trim();
  if (!message) {
    shake(els.chatInput.closest(".input-wrap"));
    return;
  }
  if (!requireApiKey()) return;

  sendQuery(message);
  els.chatInput.value = "";
}

/* ---------- thinking state ----------
   The first query after idle can take ~50s while the free-tier server wakes.
   Rotating copy makes that wait feel intentional instead of broken. */
const THINKING_LINES = [
  "Reading your question…",
  "Translating human into SQL…",
  "Taking a while? Have you seen our hosting plan?",
  "It's free, so the server naps between visitors. Currently nudging it.",
  "The server is awake but wants five more minutes.",
  "Still going. This is normal, we promise.",
  "Writing a query. Deleting it. Writing a better one.",
  "Almost there. Probably. Definitely maybe.",
  "First query of the day is the slow one. The next will be quick.",
];

let thinkingTimer = null;
let thinkingIndex = 0;

function rotateThinkingLine() {
  // Hold on the last line rather than looping back to "Reading your question…"
  if (thinkingIndex >= THINKING_LINES.length - 1) return;
  thinkingIndex += 1;

  const next = THINKING_LINES[thinkingIndex];
  if (REDUCED) {
    els.thinkingText.textContent = next;
    return;
  }
  animate(els.thinkingText, {
    opacity: [1, 0],
    y: [0, -6],
    duration: 220,
    ease: "inQuad",
    onComplete: () => {
      els.thinkingText.textContent = next;
      animate(els.thinkingText, { opacity: [0, 1], y: [6, 0], duration: 320, ease: "outExpo" });
    },
  });
}

function startThinking() {
  els.emptyState.hidden = true;
  els.sqlBlock.hidden = true;
  els.queryResult.innerHTML = "";
  els.resultMeta.textContent = "";
  els.thinking.hidden = false;

  thinkingIndex = 0;
  els.thinkingText.textContent = THINKING_LINES[0];
  clearInterval(thinkingTimer);
  thinkingTimer = setInterval(rotateThinkingLine, 6500);

  animate(els.thinking, { opacity: [0, 1], duration: dur(240), ease: "outQuad" });

  if (!REDUCED && !thinkingLoop) {
    thinkingLoop = animate(".thinking__bars span", {
      scaleY: [0.3, 1],
      alternate: true,
      loop: true,
      duration: 620,
      ease: "inOutQuad",
      delay: stagger(90),
    });
  }
}

function stopThinking() {
  if (thinkingLoop) {
    thinkingLoop.pause();
    thinkingLoop = null;
  }
  clearInterval(thinkingTimer);
  thinkingTimer = null;
  els.thinking.hidden = true;
}

/* ---------- sql reveal ---------- */
function showSql(sqlText) {
  els.sqlBlock.hidden = false;
  els.sqlQuery.textContent = "";

  animate(els.sqlBlock, {
    opacity: [0, 1],
    y: [14, 0],
    duration: dur(460),
    ease: "outExpo",
  });

  if (REDUCED) {
    els.sqlQuery.textContent = sqlText;
    return;
  }

  // Typewriter, driven by anime.js interpolating over the string length.
  const cursor = { i: 0 };
  animate(cursor, {
    i: sqlText.length,
    duration: Math.min(1400, 280 + sqlText.length * 14),
    ease: "outQuad",
    onUpdate: () => {
      els.sqlQuery.textContent = sqlText.slice(0, Math.round(cursor.i));
    },
    onComplete: () => { els.sqlQuery.textContent = sqlText; },
  });
}

function copySql() {
  const text = els.sqlQuery.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text)
    .then(() => {
      els.copySqlBtn.textContent = "Copied";
      setTimeout(() => { els.copySqlBtn.textContent = "Copy"; }, 1600);
    })
    .catch(() => toast("Couldn't copy to clipboard.", "error"));
}

/* ---------- table ---------- */
function renderTable(rows) {
  els.emptyState.hidden = true;
  els.queryResult.innerHTML = "";

  if (!rows.length) {
    els.resultMeta.textContent = "0 rows";
    const p = document.createElement("p");
    p.className = "empty__text";
    p.textContent = "No results found.";
    els.queryResult.appendChild(p);
    animate(p, { opacity: [0, 1], duration: dur(300) });
    return;
  }

  const cols = Object.keys(rows[0]);
  els.resultMeta.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${cols.length} columns`;

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  cols.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;               // textContent, not innerHTML — no XSS from data
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    cols.forEach((col) => {
      const td = document.createElement("td");
      const val = row[col];
      td.textContent = val === null || val === undefined ? "—" : String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  els.queryResult.appendChild(table);

  // Staggered row reveal, capped so a 5,000-row result doesn't animate for a minute.
  animate(table.querySelectorAll("tbody tr"), {
    opacity: [0, 1],
    y: [10, 0],
    duration: dur(460),
    delay: stagger(18, { start: 60, from: "first" }),
    ease: "outExpo",
  });
  animate(table.querySelectorAll("thead th"), {
    opacity: [0, 1],
    y: [-8, 0],
    duration: dur(380),
    delay: stagger(24),
    ease: "outExpo",
  });
}

/* ============================================================
   Entrance choreography
   ============================================================ */
function splitHero() {
  // splitText wraps each character so they can be staggered individually.
  try {
    const s = splitText(els.heroTitle, { chars: true, words: false });
    if (s && s.chars && s.chars.length) return s.chars;
  } catch (err) {
    console.warn("splitText unavailable, falling back:", err.message);
  }
  // Fallback: split by hand so the hero still animates.
  const text = els.heroTitle.textContent;
  els.heroTitle.textContent = "";
  return [...text].map((ch) => {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = ch;
    els.heroTitle.appendChild(span);
    return span;
  });
}

let heroChars = [];   // kept so the flyby can recolour each letter

function playIntro() {
  const chars = splitHero();
  heroChars = Array.from(chars);
  const reveals = document.querySelectorAll("[data-reveal]");
  const cards = document.querySelectorAll("[data-card]");

  // Start hidden from JS, not CSS — if the module fails to load, content
  // stays visible instead of being stuck at opacity 0.
  utils.set(chars, { opacity: 0, y: "1.1em", rotate: 8 });
  utils.set(reveals, { opacity: 0, y: 14 });
  utils.set(cards, { opacity: 0, y: 26 });

  const tl = createTimeline({ defaults: { ease: "outExpo", duration: dur(900) } });

  tl.add(chars, {
    opacity: [0, 1],
    y: ["1.1em", "0em"],
    rotate: [8, 0],
    duration: dur(1000),
    delay: stagger(58, { from: "center" }),
  })
    .add(reveals, {
      opacity: [0, 1],
      y: [14, 0],
      duration: dur(700),
      delay: stagger(80),
    }, "-=700")
    .add(cards, {
      opacity: [0, 1],
      y: [26, 0],
      duration: dur(800),
      delay: stagger(110),
    }, "-=520");

  return tl;
}

let field = null;   // particle field control API, set in startBackground()

function startBackground() {
  const canvas = $("particles");
  if (!canvas) return;

  // The field is its own rAF loop; anime.js just fades the layer in so the
  // page doesn't snap from black to a full particle web on first paint.
  field = initParticles(canvas);
  animate(canvas, {
    opacity: [0, 1],
    duration: dur(1600),
    ease: "outQuad",
  });
}

/* ---------- button micro-interactions ---------- */
function wireButtonMotion() {
  if (REDUCED) return;

  document.querySelectorAll(".btn").forEach((btn) => {
    // Magnetic pull toward the cursor.
    btn.addEventListener("mousemove", (e) => {
      const r = btn.getBoundingClientRect();
      animate(btn, {
        x: (e.clientX - (r.left + r.width / 2)) * 0.16,
        y: (e.clientY - (r.top + r.height / 2)) * 0.28,
        duration: 420,
        ease: "outQuad",
      });
    });
    btn.addEventListener("mouseleave", () => {
      animate(btn, { x: 0, y: 0, duration: 620, ease: "outElastic(1, .5)" });
    });
    btn.addEventListener("pointerdown", () => {
      animate(btn, { scale: 0.96, duration: 140, ease: "outQuad" });
    });
    ["pointerup", "pointerleave"].forEach((evt) =>
      btn.addEventListener(evt, () => {
        animate(btn, { scale: 1, duration: 420, ease: "outElastic(1, .6)" });
      })
    );
  });

  document.querySelectorAll(".card__num").forEach((num) => {
    const card = num.closest("[data-card]");
    card.addEventListener("mouseenter", () => {
      animate(num, { scale: [1, 1.12, 1], rotate: [0, -6, 0], duration: 620, ease: "outBack" });
    });
  });
}

/* ============================================================
   Mystery box → the wait game
   ============================================================ */
let game = null;

function callMysteryBox(on) {
  $("mysteryBox")?.classList.toggle("is-calling", on);
}

/* ---------- the box glitches ----------
   Black at rest. Every few seconds a glyph flashes for a frame or two and is
   gone. Intervals are randomised so it never settles into a rhythm you can
   predict — the effect depends on not being sure you saw it. */
const GLITCH_CHARS = "?§▓▚◱⌗✳◈▞⧉¤‡▒◧⨯#@%&01".split("");

function wireGlitchGlyph(box) {
  const glyph = box.querySelector(".mystery__glyph");
  if (!glyph || REDUCED) return;

  let timer = null;
  let hovering = false;

  const rand = (a, b) => a + Math.random() * (b - a);

  function flash() {
    if (hovering) return schedule();

    // Usually a single blip; sometimes a short stutter of two or three.
    const bursts = Math.random() < 0.32 ? 2 + Math.floor(Math.random() * 2) : 1;
    let i = 0;

    const tick = () => {
      // On hover, back off without touching the text — mouseenter owns it,
      // and clearing here wiped the "?" it had just set.
      if (hovering) {
        glyph.classList.remove("is-glitch");
        glyph.style.transform = "";
        return schedule();
      }
      if (i >= bursts) {
        glyph.textContent = "";
        glyph.classList.remove("is-glitch");
        glyph.style.transform = "";
        return schedule();
      }
      glyph.textContent = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
      glyph.classList.add("is-glitch");
      glyph.style.transform = `translate(${rand(-2, 2).toFixed(1)}px, ${rand(-2, 2).toFixed(1)}px)`;
      i += 1;
      setTimeout(tick, rand(45, 95));
    };
    tick();
  }

  function schedule() {
    clearTimeout(timer);
    // Roughly every 10s at rest; a bit oftener while the server is stalling,
    // since the glitch is now the only thing that reveals the box at all.
    const calling = box.classList.contains("is-calling");
    timer = setTimeout(flash, calling ? rand(3500, 6000) : rand(8000, 13000));
  }

  box.addEventListener("mouseenter", () => {
    hovering = true;
    clearTimeout(timer);
    glyph.classList.remove("is-glitch");
    glyph.style.transform = "";
    glyph.textContent = "?";        // resolves to a plain "?" on hover
  });
  box.addEventListener("mouseleave", () => {
    hovering = false;
    glyph.textContent = "";
    schedule();
  });

  schedule();
}

function wireMysteryBox() {
  const box = $("mysteryBox");
  if (!box) return;

  // Wired after startBackground(), so `field` is already resolved here.
  game = createGame({ field, onExit: restorePage });
  wireGlitchGlyph(box);

  box.addEventListener("click", () => {
    box.classList.remove("is-calling");
    sweepPageAside(() => game.open());
  });
}

/** Slide the page out of the way, then hand over to the game. */
function sweepPageAside(done) {
  const topbar = document.querySelector(".topbar");
  const shell = document.querySelector(".shell");

  if (REDUCED) {
    utils.set([topbar, shell], { opacity: 0 });
    if (topbar) topbar.style.pointerEvents = "none";
    if (shell) shell.style.pointerEvents = "none";
    done();
    return;
  }

  // Paced to be watchable — the first pass was over before you saw it.
  animate(topbar, { translateY: -90, opacity: 0, duration: 780, ease: "inOutQuad" });
  animate(shell, {
    translateX: "-75vw",
    opacity: 0,
    scale: 0.9,
    duration: 1050,
    delay: 90,          // the bar leaves first, then the page follows
    ease: "inOutQuad",
    onComplete: () => {
      // Out of the way and out of the tab order while the game is up.
      topbar.style.pointerEvents = "none";
      shell.style.pointerEvents = "none";
      done();
    },
  });
}

/** Bring the page back after the game closes. */
function restorePage() {
  const topbar = document.querySelector(".topbar");
  const shell = document.querySelector(".shell");
  topbar.style.pointerEvents = "";
  shell.style.pointerEvents = "";

  if (REDUCED) {
    utils.set([topbar, shell], { opacity: 1, translateX: 0, translateY: 0, scale: 1 });
    return;
  }

  animate(shell, {
    translateX: 0,
    opacity: 1,
    scale: 1,
    duration: 950,
    ease: "outExpo",
  });
  animate(topbar, {
    translateY: 0,
    opacity: 1,
    duration: 820,
    delay: 160,         // page slides back first, then the bar drops in
    ease: "outExpo",
  });
}

/* ============================================================
   Shockwave — the page reacts to a blast
   Amplitude falls off with distance from the blast, so panels near it get
   thrown around and distant ones barely register.
   ============================================================ */
const SHAKE_SELECTOR = ".topbar, .hero, .card, .results, .footnote";
/* Wide enough to reach the bottom of a tall page — the squared falloff keeps
   distant panels to a faint tremor while the hero still gets thrown around. */
const SHAKE_RADIUS = 2200;
const SHAKE_MAX = 17;        // px of travel at the epicentre

function shockwave(cx, cy, strength = 1) {
  if (REDUCED) return;

  const targets = [...document.querySelectorAll(SHAKE_SELECTOR)]
    .map((el) => {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      const falloff = Math.max(0, 1 - d / SHAKE_RADIUS);
      return {
        el,
        // Squared falloff: near things get hit hard, far things only nudged.
        amp: falloff ** 2 * SHAKE_MAX * strength,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 2,
      };
    })
    .filter((t) => t.amp > 0.3);

  if (!targets.length) return;

  const wave = { t: 0 };
  animate(wave, {
    t: 1,
    duration: 760,
    ease: "linear",
    onUpdate: () => {
      // Written straight to style rather than utils.set: this runs every frame
      // across several elements, and it must not fight anime's own transform
      // bookkeeping on the cards.
      const decay = (1 - wave.t) ** 2;
      for (const t of targets) {
        const a = t.amp * decay;
        const x = Math.sin(wave.t * 54 + t.phase) * a;
        const y = Math.cos(wave.t * 43 + t.phase) * a * 0.66;
        t.el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${(t.spin * a * 0.05).toFixed(3)}deg)`;
      }
    },
    onComplete: () => {
      // Intro animations end at identity, so clearing is safe.
      for (const t of targets) t.el.style.transform = "";
    },
  });
}

/* ---------- logo wink ----------
   Hovering the mark: head tilts, left eye squints, right eye closes into a
   happy curve, and the smile deepens. Reverses on leave. */
function wireLogoWink() {
  const brand = $("brandLink");
  if (!brand) return;

  const parts = {
    head:   brand.querySelector(".bot__head"),
    eyeL:   brand.querySelector(".bot__eye--l"),
    eyeR:   brand.querySelector(".bot__eye--r"),
    wink:   brand.querySelector(".bot__wink"),
    mouth:  brand.querySelector(".bot__mouth"),
    bulb:   brand.querySelector(".bot__bulb"),
  };
  if (Object.values(parts).some((p) => !p)) return;

  if (REDUCED) {
    // No motion: just swap the open eye for the closed one on hover.
    brand.addEventListener("mouseenter", () => {
      parts.eyeR.style.opacity = 0;
      parts.wink.style.opacity = 1;
    });
    brand.addEventListener("mouseleave", () => {
      parts.eyeR.style.opacity = 1;
      parts.wink.style.opacity = 0;
    });
    return;
  }

  let playing = false;

  function wink() {
    if (playing) return;      // don't restack on repeated mouseenter
    playing = true;

    animate(parts.head,  { rotate: -7, translateY: -0.6, duration: 420, ease: "outBack" });
    animate(parts.eyeL,  { scaleY: 0.55, duration: 220, ease: "outQuad" });
    animate(parts.eyeR,  { scaleY: 0.1, opacity: 0, duration: 160, ease: "outQuad" });
    animate(parts.wink,  { opacity: 1, scale: [0.6, 1], duration: 240, delay: 110, ease: "outBack" });
    animate(parts.mouth, { scaleY: 1.7, duration: 420, ease: "outBack" });
    animate(parts.bulb,  { scale: [1, 1.5, 1], duration: 620, ease: "outQuad" });
  }

  function unwink() {
    playing = false;

    animate(parts.head,  { rotate: 0, translateY: 0, duration: 620, ease: "outElastic(1, .6)" });
    animate(parts.eyeL,  { scaleY: 1, duration: 300, ease: "outBack" });
    animate(parts.eyeR,  { scaleY: 1, opacity: 1, duration: 240, delay: 80, ease: "outBack" });
    animate(parts.wink,  { opacity: 0, duration: 140, ease: "outQuad" });
    animate(parts.mouth, { scaleY: 1, duration: 420, ease: "outBack" });
  }

  brand.addEventListener("mouseenter", wink);
  brand.addEventListener("mouseleave", unwink);
  brand.addEventListener("focus", wink);      // keyboard users get it too
  brand.addEventListener("blur", unwink);

  /* ---- click: leap out of the box, in full colour ---- */
  const svgEl = brand.querySelector(".bot");
  const mark = brand.querySelector(".brand__mark");
  let popping = false;

  // Everything in the mark is drawn with currentColor, so going multi-colour
  // means giving each part its own explicit stroke/fill for the duration.
  const PARTY = [
    { el: brand.querySelector(".bot__body"),    prop: "stroke", color: "#ff2d95" },
    { el: parts.head.querySelector(".bot__antenna"), prop: "stroke", color: "#00e5ff" },
    { el: parts.bulb,                            prop: "fill",   color: "#ffd400" },
    { el: parts.eyeL,                            prop: "stroke", color: "#ff8a00" },
    { el: parts.eyeR,                            prop: "stroke", color: "#00ff9d" },
    { el: parts.wink,                            prop: "stroke", color: "#00ff9d" },
    { el: parts.mouth,                           prop: "stroke", color: "#b16cff" },
  ].filter((p) => p.el);

  let hueCycle = null;
  let windDown = null;
  const spin = { h: 0 };
  const paintFilter = () => {
    svgEl.style.filter = `hue-rotate(${spin.h}deg) saturate(1.35)`;
  };

  function goRainbow(delay) {
    PARTY.forEach(({ el, prop, color }, i) => {
      animate(el, { [prop]: color, duration: 320, delay: delay + i * 40, ease: "outQuad" });
    });

    // Spin the whole palette so the colours keep moving while it's airborne.
    // Driven through a proxy object because filter strings don't interpolate.
    spin.h = 0;
    hueCycle = animate(spin, {
      h: 360,
      duration: 1400,
      delay,
      loop: true,
      ease: "linear",
      onUpdate: paintFilter,
    });
  }

  function goGreen(delay) {
    PARTY.forEach(({ el, prop }) => {
      animate(el, { [prop]: "#70e000", duration: 380, delay, ease: "outQuad" });
    });

    // The hue spin has to stop and unwind in step with the parts going green,
    // or the "green" is still being hue-shifted and snaps on cleanup.
    clearTimeout(windDown);
    windDown = setTimeout(() => {
      if (hueCycle) { hueCycle.pause(); hueCycle = null; }
      animate(spin, { h: 0, duration: 380, ease: "outQuad", onUpdate: paintFilter });
    }, delay);
  }

  /* ---- the big hero RowBot goes full spectrum during the flyby ---- */
  const heroEl = $("heroTitle");
  const heroPos = { p: 0 };
  let heroFlow = null;

  function partyHero(on) {
    if (!heroEl) return;

    if (!on) {
      if (heroFlow) { heroFlow.pause(); heroFlow = null; }
      heroEl.classList.remove("is-party");
      heroChars.forEach((c) => c.style.removeProperty("background-position-x"));
      return;
    }

    heroEl.classList.add("is-party");
    heroPos.p = 0;
    // Each letter is offset along the gradient, so the whole spectrum is
    // visible across the word at once instead of one colour at a time —
    // and sliding p makes those colours travel through the letters.
    heroFlow = animate(heroPos, {
      p: 300,
      duration: 2200,
      loop: true,
      ease: "linear",
      onUpdate: () => {
        heroChars.forEach((c, i) => {
          c.style.backgroundPositionX = `${(heroPos.p + i * 34) % 300}%`;
        });
      },
    });
  }

  function clearColour() {
    partyHero(false);
    clearTimeout(windDown);
    if (hueCycle) { hueCycle.pause(); hueCycle = null; }
    spin.h = 0;
    svgEl.style.filter = "";
    // Drop the inline colours so the parts inherit currentColor again —
    // that's what lets the hover wink and the theme keep working.
    PARTY.forEach(({ el, prop }) => el.style.removeProperty(prop));
  }

  brand.addEventListener("click", (e) => {
    // The mark is a back-to-top link. Keep that, but scroll it ourselves so
    // the anchor jump doesn't fight the animation.
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });

    if (REDUCED || popping) return;
    popping = true;

    mark.classList.add("is-vacated");   // dims the empty box, see style.css

    // Pin the svg to the viewport at its current spot. This is the fix for the
    // clipping: the mark sits ~70px from the left edge, so scaling it in place
    // ran it off-screen into body{overflow-x:hidden}. Fixed positioning takes
    // it out of every ancestor's flow and clip, so it can go anywhere.
    const r = svgEl.getBoundingClientRect();
    Object.assign(svgEl.style, {
      position: "fixed",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      margin: "0",
      zIndex: "200",
      pointerEvents: "none",
      overflow: "visible",
      // It's leaving .brand__mark, which is where currentColor came from.
      color: "#70e000",
    });
    // .topbar has backdrop-filter, which makes it the containing block for
    // fixed-position descendants — "fixed" inside it is NOT fixed to the
    // viewport. Reparenting to <body> sidesteps that and every ancestor clip.
    document.body.appendChild(svgEl);

    const home = { x: r.left + r.width / 2, y: r.top + r.height / 2 };

    /* Orbit the BIG hero title, not the little topbar wordmark. Measured in
       document coords then read back as viewport coords, because we scroll to
       the top first and the hero's on-screen position changes as that happens. */
    /* Measure the union of the character spans, not the <h1>. The h1 is a
       block that fills the container, so its width orbits empty space either
       side of the word. The chars give the word's true extent. */
    const wordBox = (() => {
      const boxes = heroChars.map((c) => c.getBoundingClientRect()).filter((b) => b.width);
      if (!boxes.length) return heroEl.getBoundingClientRect();
      return {
        left: Math.min(...boxes.map((b) => b.left)),
        right: Math.max(...boxes.map((b) => b.right)),
        top: Math.min(...boxes.map((b) => b.top)),
        bottom: Math.max(...boxes.map((b) => b.bottom)),
      };
    })();

    const wW = wordBox.right - wordBox.left;
    const wH = wordBox.bottom - wordBox.top;
    const orbit = {
      x: wordBox.left + wW / 2,
      y: wordBox.top + window.scrollY + wH / 2,
      rx: wW / 2 + 52,
      ry: wH / 2 + 34,
    };

    const START = Math.PI;          // enter on the left, where the robot flies in from
    const LAPS = 2;
    const angle = { a: START };
    const entry = { x: orbit.x - orbit.rx, y: orbit.y };
    let trailTick = 0;

    const emitTrail = (px, py) => {
      if (++trailTick % 3 === 0) field?.trail(px, py, 2);
    };

    const placeOnOrbit = () => {
      const px = orbit.x + orbit.rx * Math.cos(angle.a);
      const py = orbit.y + orbit.ry * Math.sin(angle.a);
      // translateX/Y, never x/y: <svg> has real x/y presentation attributes,
      // so anime animates those instead of the transform and nothing moves.
      utils.set(svgEl, {
        translateX: px - home.x,
        translateY: py - home.y,
        rotate: -Math.sin(angle.a) * 20,   // banks into the turn
      });
      emitTrail(px, py);
    };

    // The scrim dims the particle layer right where the hero sits, which is
    // exactly where the sparks now go. Lift it for the duration.
    const scrim = document.querySelector(".bg__scrim");

    goRainbow(200);
    goGreen(3350);

    // A smooth scroll is in flight if the page was scrolled; let it land first
    // or the hero's measured position is stale before the robot arrives.
    const startDelay = window.scrollY > 4 ? 480 : 0;

    setTimeout(() => {
      if (scrim) animate(scrim, { opacity: [1, 0.28], duration: 500, ease: "outQuad" });

      createTimeline({ defaults: { ease: "outQuad" } })
        // wind up
        .add(svgEl, { scale: 0.72, duration: 170 })
        // launch: cross the page down to the hero
        .add(svgEl, {
          translateX: entry.x - home.x,
          translateY: entry.y - home.y,
          scale: 2,
          rotate: -14,
          duration: 700,
          ease: "inOutQuad",
          onBegin: () => {
            field?.burst(home.x, home.y, 12);
            shockwave(home.x, home.y, 0.35);        // small jolt at the launch
            partyHero(true);                        // the big word lights up
            field?.focus(orbit.x, orbit.y, 0.22);   // field drifts to the hero
          },
          onUpdate: () => {
            const b = svgEl.getBoundingClientRect();
            emitTrail(b.left + b.width / 2, b.top + b.height / 2);
          },
        })
        // two laps around the hero title
        .add(angle, {
          a: START + Math.PI * 2 * LAPS,
          duration: 2200,
          ease: "inOutSine",
          onUpdate: placeOnOrbit,
        })
        // fly home
        .add(svgEl, {
          translateX: 0,
          translateY: 0,
          scale: 1,
          rotate: 0,
          duration: 780,
          ease: "inOutQuad",
          onBegin: () => {
            field?.burst(orbit.x, orbit.y, 30);   // big burst over the hero
            shockwave(orbit.x, orbit.y, 1);       // and the page feels it
            field?.release(7);
            if (scrim) animate(scrim, { opacity: 1, duration: 700, ease: "outQuad" });
          },
          onUpdate: () => {
            const b = svgEl.getBoundingClientRect();
            emitTrail(b.left + b.width / 2, b.top + b.height / 2);
          },
          onComplete: () => {
            mark.appendChild(svgEl);        // home first, then drop the overrides
            clearColour();
            svgEl.removeAttribute("style");
            mark.classList.remove("is-vacated");
            popping = false;
          },
        });
    }, startDelay);
    // Note: the box is deliberately NOT transformed. The svg is its child,
    // so any transform on the box would multiply into the robot mid-flight.
  });
}

/* ---------- dropzone ---------- */
function wireDropzone() {
  const dz = els.dropzone;

  dz.addEventListener("click", () => els.fileInput.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener("change", onFileChosen);

  ["dragenter", "dragover"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add("is-dragging");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.remove("is-dragging");
    })
  );

  dz.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    // DataTransfer -> the real input, so the rest of the flow is unchanged.
    const dt = new DataTransfer();
    dt.items.add(file);
    els.fileInput.files = dt.files;
    onFileChosen();
  });
}

/* ---------- suggestion chips ---------- */
function wireChips() {
  els.chips.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      els.chatInput.value = chip.textContent;
      els.chatInput.focus();
      animate(els.chatInput.closest(".input-wrap"), {
        scale: [1, 1.014, 1],
        duration: dur(420),
        ease: "outQuad",
      });
    });
  });
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  playIntro();
  startBackground();
  wireButtonMotion();
  wireLogoWink();
  wireMysteryBox();     // after startBackground(): the game needs the field
  wireDropzone();
  wireChips();

  connectWebSocket();

  els.uploadBtn.addEventListener("click", uploadFile);
  els.sendBtn.addEventListener("click", sendChat);
  els.toggleKeyBtn.addEventListener("click", toggleKeyVisibility);
  els.copySqlBtn.addEventListener("click", copySql);
  els.connPopClose.addEventListener("click", dismissConnPop);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.connPop.hidden) dismissConnPop();
  });

  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });
  els.apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.fileInput.click();
  });

  // Don't leave the key in a restored form field on back/forward navigation.
  els.apiKeyInput.value = "";
  window.addEventListener("pagehide", () => { els.apiKeyInput.value = ""; });

  exposePreview();
}

/* ============================================================
   Dev preview — localhost only
   The wait copy only shows up after a real 20-50s stall, which makes it
   painful to review. This lets you page through every state instantly
   from the console. It is not exposed on the deployed site.
   ============================================================ */
function exposePreview() {
  if (!IS_LOCAL) return;

  window.rowbot = {
    /** Step through every thinking line, `ms` apart. */
    waitLines(ms = 1500) {
      startThinking();
      clearInterval(thinkingTimer);
      thinkingTimer = setInterval(() => {
        if (thinkingIndex >= THINKING_LINES.length - 1) {
          clearInterval(thinkingTimer);
          return;
        }
        rotateThinkingLine();
      }, ms);
      return THINKING_LINES;
    },
    /** Fast-forward the pill and its explainer popover through every state. */
    coldStart(ms = 2600) {
      const steps = [
        ["connecting", "Connecting", null],
        ["connecting", "Poking the server", "waking"],
        ["connecting", "Server hit snooze", "snoozing"],
        ["connecting", "Making it coffee", null],
        ["offline", "Reconnecting…", "retrying"],
        ["offline", "Server unreachable", "unreachable"],
      ];
      popDismissed = null;
      steps.forEach(([state, label, key], i) => {
        setTimeout(() => {
          setConn(state, label);
          if (key) { popKeyShowing = null; popDismissed = null; showConnPop(key); }
        }, i * ms);
      });
      return steps.map(([, l]) => l);
    },

    /** Show one popover on demand: rowbot.pop("uploadStalled") */
    pop(key = "waking") {
      popKeyShowing = null;
      popDismissed = null;
      showConnPop(key);
      return Object.keys(CONN_POP);
    },
    /** Drop back to the idle panel with the pre-wait hint. */
    game: () => game,
    reset() {
      stopThinking();
      hideConnPop();
      popDismissed = null;
      els.emptyState.hidden = false;
      els.sqlBlock.hidden = true;
      els.queryResult.innerHTML = "";
      els.resultMeta.textContent = "";
      setConn(ws?.readyState === WebSocket.OPEN ? "online" : "connecting",
              ws?.readyState === WebSocket.OPEN ? "Connected" : "Connecting");
    },
    toast,
  };

  console.info(
    "%cRowBot dev preview%c\n" +
    "  rowbot.waitLines()  — play every waiting message\n" +
    "  rowbot.coldStart()  — play the pill states + explainer popovers\n" +
    "  rowbot.pop(key)     — one popover: waking | snoozing | retrying |\n" +
    "                        noAnswer | unreachable | uploadStalled\n" +
    "  rowbot.reset()      — back to idle",
    "color:#70e000;font-weight:bold", "color:inherit"
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
