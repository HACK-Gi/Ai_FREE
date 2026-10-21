(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const chatEl = $("chat");
  const messagesEl = $("messages");
  const emptyEl = $("empty");
  const formEl = $("form");
  const inputEl = $("input");
  const sendBtn = $("sendBtn");
  const stopBtn = $("stopBtn");
  const newChatBtn = $("newChatBtn");
  const charCount = $("charCount");
  const jumpBtn = $("jumpBtn");
  const toastEl = $("toast");
  const sidebarEl = $("sidebar");
  const scrimEl = $("scrim");
  const menuBtn = $("menuBtn");
  const themeBtn = $("themeBtn");
  const themeIcon = $("themeIcon");
  const themeText = $("themeText");
  const modelLabel = $("modelLabel");
  const modelBase = $("modelBase");
  const offlineHint = $("offlineHint");
  const topStatus = $("topStatus");
  const topStatusText = $("topStatusText");
  const sideStatus = $("sideStatus");
  const sideStatusText = $("sideStatusText");
  const chatTitle = $("chatTitle");
  const chatSubtitle = $("chatSubtitle");
  const contextCount = $("contextCount");
  const contextBar = $("contextBar");

  const STORE_KEY = "aiden.chat.v2";
  const THEME_KEY = "aiden.theme";
  const MAX_SEND = 32;
  const MAX_CHARS = 16000;

  const state = {
    messages: [],
    streaming: false,
    controller: null,
    assistant: null,
    raf: 0,
    session: 0,
  };

  let toastTimer = 0;

  /* ---------- text + markdown ---------- */

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));

  function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    out = out.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return out;
  }

  function codeBlock(code, lang) {
    const encoded = encodeURIComponent(code);
    return (
      '<div class="code"><div class="code-head"><span>' +
      escapeHtml(lang || "code") +
      '</span><button class="copy" type="button" data-code="' +
      encoded +
      '">Copy</button></div><pre><code>' +
      escapeHtml(code) +
      "</code></pre></div>"
    );
  }

  function renderText(text) {
    if (!text) return "";
    const lines = text.split("\n");
    let html = "";
    let list = null;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html += `<p>${inline(paragraph.join(" "))}</p>`;
      paragraph = [];
    };
    const closeList = () => {
      if (!list) return;
      html += `</${list}>`;
      list = null;
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const quote = line.match(/^\s*>\s?(.*)$/);
      const rule = line.match(/^\s*([-*_])\1\1+\s*$/);

      if (heading) {
        flushParagraph();
        closeList();
        const size = Math.min(heading[1].length + 1, 4);
        html += `<h${size}>${inline(heading[2])}</h${size}>`;
      } else if (bullet) {
        flushParagraph();
        if (list !== "ul") {
          closeList();
          html += "<ul>";
          list = "ul";
        }
        html += `<li>${inline(bullet[1])}</li>`;
      } else if (numbered) {
        flushParagraph();
        if (list !== "ol") {
          closeList();
          html += "<ol>";
          list = "ol";
        }
        html += `<li>${inline(numbered[1])}</li>`;
      } else if (quote) {
        flushParagraph();
        closeList();
        html += `<blockquote>${inline(quote[1])}</blockquote>`;
      } else if (rule) {
        flushParagraph();
        closeList();
        html += "<hr>";
      } else {
        closeList();
        paragraph.push(line.trim());
      }
    }
    flushParagraph();
    closeList();
    return html;
  }

  function renderMarkdown(text) {
    if (!text) return "";
    const parts = [];
    const fence = /```([a-zA-Z0-9_+.-]*)\n([\s\S]*?)```/g;
    let last = 0;
    let match;

    while ((match = fence.exec(text)) !== null) {
      parts.push(renderText(text.slice(last, match.index)));
      parts.push(codeBlock(match[2], match[1]));
      last = fence.lastIndex;
    }

    const rest = text.slice(last);
    const open = rest.match(/```([a-zA-Z0-9_+.-]*)\n([\s\S]*)$/);
    if (open) {
      parts.push(renderText(rest.slice(0, open.index)));
      parts.push(codeBlock(open[2], open[1]));
    } else {
      parts.push(renderText(rest));
    }
    return parts.join("");
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function friendlyError(message) {
    const raw = String(message || "").trim();
    if (/(?:429|402|FREE_LIMIT|free limit|still running|rate.?limit)/i.test(raw)) {
      return "The free model is busy right now. Wait about 30 seconds, then try again.";
    }
    if (/(?:502|503|504|cannot reach|endpoint|fetch)/i.test(raw)) {
      return "The model endpoint is not responding. Check the status, then try again.";
    }
    return raw || "Something went wrong.";
  }

  function retryLast(holder) {
    if (state.streaming) return;
    const lastUser = [...state.messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    const index = state.messages.lastIndexOf(lastUser);
    if (index >= 0) state.messages.splice(index, 1);
    holder.row.remove();
    const userRows = messagesEl.querySelectorAll(".row.user");
    if (userRows.length) userRows[userRows.length - 1].remove();
    persist();
    updateEmpty();
    updateHeader();
    updateContext();
    sendMessage(lastUser.content);
  }

  function attachRetry(note, holder) {
    const retry = document.createElement("button");
    retry.className = "retry-btn";
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => retryLast(holder));
    note.appendChild(retry);
  }

  /* ---------- message rows ---------- */

  function createRow(role, timestamp) {
    const row = document.createElement("div");
    row.className = `row ${role}`;

    if (role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = "◈";
      row.appendChild(avatar);
    }

    const wrap = document.createElement("div");
    wrap.className = "msg-wrap";

    const meta = document.createElement("div");
    meta.className = "msg-meta";

    const name = document.createElement("strong");
    name.textContent = role === "assistant" ? "AIDEN" : "dj";
    const time = document.createElement("span");
    time.textContent = formatTime(timestamp);
    const copy = document.createElement("button");
    copy.className = "msg-copy";
    copy.type = "button";
    copy.textContent = "copy";
    copy.dataset.text = "";
    meta.append(name, time, copy);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const body = document.createElement("div");
    body.className = "md";
    bubble.appendChild(body);
    wrap.append(meta, bubble);
    row.appendChild(wrap);
    messagesEl.appendChild(row);

    return { row, wrap, meta, bubble, body, copy };
  }

  function addMessage(role, text, timestamp) {
    const refs = createRow(role, timestamp);
    if (role === "assistant") refs.body.innerHTML = renderMarkdown(text);
    else refs.body.textContent = text;
    refs.copy.dataset.text = encodeURIComponent(text);
    refs.copy.style.visibility = "visible";
    return refs;
  }

  function beginAssistant() {
    const refs = createRow("assistant", Date.now());
    refs.body.innerHTML =
      '<span class="typing" aria-label="Working"><span></span><span></span><span></span></span>';
    refs.copy.style.visibility = "hidden";
    return { ...refs, text: "" };
  }

  function nearBottom() {
    return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 180;
  }

  function updateJump() {
    const distance = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
    jumpBtn.hidden = distance < 260;
  }

  function maybeScroll(force = false) {
    if (force || nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
    updateJump();
  }

  function updateEmpty() {
    emptyEl.hidden = state.messages.length > 0;
  }

  function updateHeader() {
    const firstUser = state.messages.find((message) => message.role === "user");
    if (firstUser) {
      const text = firstUser.content.replace(/\s+/g, " ").trim();
      const title = text.length > 54 ? `${text.slice(0, 54)}…` : text;
      chatTitle.textContent = title || "Conversation";
      document.title = `${title || "Conversation"} · AIDEN`;
    } else {
      chatTitle.textContent = "New conversation";
      document.title = "AIDEN · DeepSeek Mix";
    }
    chatSubtitle.textContent = state.streaming ? "AIDEN is working…" : "AIDEN is listening";
  }

  function updateContext() {
    const count = Math.min(state.messages.length, MAX_SEND);
    contextCount.textContent = `${count} message${count === 1 ? "" : "s"}`;
    contextBar.style.width = `${Math.min(100, (count / MAX_SEND) * 100)}%`;
  }

  /* ---------- persistence ---------- */

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.messages.slice(-80)));
    } catch {
      /* private mode or quota */
    }
  }

  function restore() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    } catch {
      saved = [];
    }
    if (!Array.isArray(saved)) return;
    state.messages = saved
      .filter(
        (message) =>
          message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim()
      )
      .map((message) => ({
        role: message.role,
        content: message.content,
        ts: Number(message.ts) || Date.now(),
      }))
      .slice(-80);
    for (const message of state.messages) {
      addMessage(message.role, message.content, message.ts);
    }
    updateEmpty();
    updateHeader();
    updateContext();
    if (state.messages.length) requestAnimationFrame(() => maybeScroll(true));
  }

  /* ---------- status ---------- */

  function setStatus(kind, text, title = "") {
    sideStatus.className = `status-line is-${kind}`;
    topStatus.className = `status-pill is-${kind}`;
    sideStatusText.textContent = text;
    topStatusText.textContent = text;
    sideStatus.title = title;
    topStatus.title = title;
  }

  async function checkHealth() {
    setStatus("checking", "connecting", "Checking the model endpoint");
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      if (data.model) modelLabel.textContent = data.model;
      if (data.base) modelBase.textContent = data.base;
      if (data.ok) {
        setStatus("ready", "online", data.base ? `Connected to ${data.base}` : "Connected");
        offlineHint.hidden = true;
      } else {
        setStatus("offline", "offline", data.error || "Model endpoint not reachable");
        offlineHint.hidden = false;
      }
    } catch {
      setStatus("offline", "offline", "Website server not reachable");
      offlineHint.hidden = false;
    }
  }

  /* ---------- streaming ---------- */

  function scheduleRender(holder) {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      if (!holder || state.assistant !== holder) return;
      holder.body.innerHTML = renderMarkdown(holder.text) + '<span class="cursor"></span>';
      maybeScroll();
    });
  }

  function handleBlock(block, holder) {
    let event = "message";
    const dataLines = [];

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }

    const data = dataLines.join("\n");
    if (!data || data === "[DONE]") return;

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    if (event === "error" || payload.error) {
      const error = payload.error;
      throw new Error(
        typeof error === "string" ? error : (error && error.message) || "The model returned an error."
      );
    }

    const choice = payload.choices && payload.choices[0];
    const delta = (choice && choice.delta) || {};
    // reasoning_content is intentionally ignored: private reasoning stays server-side.
    const content = delta.content || "";
    if (content) {
      if (!holder.text) holder.body.innerHTML = "";
      holder.text += content;
      scheduleRender(holder);
    }
  }

  async function consumeStream(res, holder) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handleBlock(block, holder);
      }
    }
    if (buffer.trim()) handleBlock(buffer, holder);
  }

  function finalize(holder, errorMessage, aborted = false, session = state.session) {
    if (session !== state.session) return;

    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }

    if (holder.text) {
      holder.body.innerHTML = renderMarkdown(holder.text);
      holder.copy.dataset.text = encodeURIComponent(holder.text);
      holder.copy.style.visibility = "visible";
    } else {
      holder.body.innerHTML = "";
    }

    if (errorMessage) {
      const note = document.createElement("div");
      note.className = "error-note";
      note.textContent = friendlyError(errorMessage);
      note.title = errorMessage;
      attachRetry(note, holder);
      holder.bubble.appendChild(note);
      if (!holder.text) holder.bubble.classList.add("is-error");
    } else if (!holder.text && aborted) {
      const note = document.createElement("div");
      note.className = "error-note is-muted";
      note.textContent = "Stopped.";
      holder.bubble.appendChild(note);
    } else if (!holder.text) {
      const note = document.createElement("div");
      note.className = "error-note";
      note.textContent = "The model returned an empty reply.";
      attachRetry(note, holder);
      holder.bubble.appendChild(note);
    }

    const text = holder.text.trim();
    if (text) {
      state.messages.push({ role: "assistant", content: text, ts: Date.now() });
    }
    state.assistant = null;
    persist();
    updateHeader();
    updateContext();
    maybeScroll();
  }

  function setStreaming(on) {
    state.streaming = on;
    stopBtn.hidden = !on;
    sendBtn.disabled = on || !inputEl.value.trim();
    if (!on) state.controller = null;
    updateHeader();
  }

  async function sendMessage(rawText) {
    const text = rawText.trim().slice(0, MAX_CHARS);
    if (!text || state.streaming) return;

    const timestamp = Date.now();
    state.messages.push({ role: "user", content: text, ts: timestamp });
    addMessage("user", text, timestamp);
    persist();
    updateEmpty();
    updateHeader();
    updateContext();

    inputEl.value = "";
    updateCharCount();
    resizeInput();
    sendBtn.disabled = true;
    maybeScroll(true);

    const holder = beginAssistant();
    const controller = new AbortController();
    const session = state.session;
    state.assistant = holder;
    state.controller = controller;
    setStreaming(true);
    maybeScroll(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: state.messages
            .slice(-MAX_SEND)
            .map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          if (data.error) detail = data.error;
        } catch {
          /* keep the generic message */
        }
        throw new Error(detail);
      }
      if (!res.body) throw new Error("This browser cannot read streamed responses.");

      await consumeStream(res, holder);
      finalize(holder, "", false, session);
    } catch (error) {
      if (error.name === "AbortError") {
        finalize(holder, "", true, session);
      } else {
        finalize(holder, error.message || "Something went wrong.", false, session);
      }
    } finally {
      setStreaming(false);
      inputEl.focus();
    }
  }

  /* ---------- composer ---------- */

  function resizeInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 220)}px`;
  }

  function updateCharCount() {
    charCount.textContent = `${inputEl.value.length.toLocaleString()} / 16,000`;
    sendBtn.disabled = state.streaming || !inputEl.value.trim();
  }

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(inputEl.value);
  });

  inputEl.addEventListener("input", () => {
    updateCharCount();
    resizeInput();
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      formEl.requestSubmit();
    }
  });

  stopBtn.addEventListener("click", () => {
    if (state.controller) state.controller.abort();
  });

  /* ---------- new chat ---------- */

  function newChat() {
    state.session += 1;
    if (state.controller) state.controller.abort();
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    state.assistant = null;
    state.messages = [];
    messagesEl.innerHTML = "";
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    inputEl.value = "";
    updateCharCount();
    resizeInput();
    updateEmpty();
    updateHeader();
    updateContext();
    setStreaming(false);
    maybeScroll(true);
    inputEl.focus();
    closeSidebar();
  }

  newChatBtn.addEventListener("click", newChat);

  /* ---------- sidebar + theme ---------- */

  function openSidebar() {
    sidebarEl.classList.add("is-open");
    scrimEl.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    sidebarEl.classList.remove("is-open");
    scrimEl.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  menuBtn.addEventListener("click", openSidebar);
  scrimEl.addEventListener("click", closeSidebar);

  function applyTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    themeIcon.textContent = next === "dark" ? "☾" : "☀";
    themeText.textContent = next === "dark" ? "Dark" : "Light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#070a11" : "#f4f6fb");
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }

  let savedTheme = "dark";
  try {
    savedTheme = localStorage.getItem(THEME_KEY) || "dark";
  } catch {
    /* ignore */
  }
  applyTheme(savedTheme);

  themeBtn.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  /* ---------- interactions ---------- */

  emptyEl.addEventListener("click", (event) => {
    const card = event.target.closest(".prompt-card");
    if (card && card.dataset.prompt) sendMessage(card.dataset.prompt);
  });

  topStatus.addEventListener("click", checkHealth);
  sideStatus.addEventListener("click", checkHealth);
  topStatus.tabIndex = 0;
  sideStatus.tabIndex = 0;
  for (const status of [topStatus, sideStatus]) {
    status.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        checkHealth();
      }
    });
  }

  chatEl.addEventListener("scroll", updateJump, { passive: true });
  jumpBtn.addEventListener("click", () => {
    chatEl.scrollTo({
      top: chatEl.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  });

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("is-on"), 1600);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    document.execCommand("copy");
    scratch.remove();
  }

  messagesEl.addEventListener("click", async (event) => {
    const codeButton = event.target.closest("button.copy");
    if (codeButton) {
      const code = decodeURIComponent(codeButton.dataset.code || "");
      const original = codeButton.textContent;
      try {
        await copyText(code);
        codeButton.textContent = "Copied";
        window.setTimeout(() => {
          codeButton.textContent = original;
        }, 1400);
      } catch {
        codeButton.textContent = "Failed";
        window.setTimeout(() => {
          codeButton.textContent = original;
        }, 1400);
      }
      return;
    }

    const messageButton = event.target.closest("button.msg-copy");
    if (messageButton) {
      const text = decodeURIComponent(messageButton.dataset.text || "");
      if (!text) return;
      try {
        await copyText(text);
        showToast("Copied message");
      } catch {
        showToast("Copy failed");
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      newChat();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 880) closeSidebar();
  });

  /* ---------- start ---------- */

  restore();
  updateEmpty();
  updateHeader();
  updateContext();
  updateCharCount();
  resizeInput();
  checkHealth();
  inputEl.focus();
})();
