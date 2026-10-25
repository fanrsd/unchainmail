// UnchainMail client. State lives only in localStorage (id + token).
// No cookies, no analytics, no third-party requests.
(() => {
  "use strict";

  const LS_KEY = "unchainmail.inbox";
  const POLL_MS = 8000;

  /** @type {{id:string, address:string, token:string, expiresAt:number}|null} */
  let inbox = null;
  let pollTimer = null;
  let countdownTimer = null;
  let openMessageId = null;

  const $ = (id) => document.getElementById(id);
  const els = {
    address: $("address"),
    copy: $("copy-btn"),
    expiry: $("expiry"),
    extend: $("extend-btn"),
    neu: $("new-btn"),
    refresh: $("refresh-btn"),
    refreshStatus: $("refresh-status"),
    list: $("message-list"),
    viewer: $("viewer"),
    vSubject: $("viewer-subject"),
    vFrom: $("viewer-from"),
    vDate: $("viewer-date"),
    vText: $("viewer-text"),
    vHtml: $("viewer-html"),
    vClose: $("viewer-close"),
    vDelete: $("viewer-delete"),
    tabText: $("tab-text"),
    tabHtml: $("tab-html"),
  };

  // ---- storage ----
  function save() {
    if (inbox) localStorage.setItem(LS_KEY, JSON.stringify(inbox));
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) inbox = JSON.parse(raw);
    } catch {
      inbox = null;
    }
  }
  function clear() {
    localStorage.removeItem(LS_KEY);
    inbox = null;
  }

  // ---- api ----
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (inbox && inbox.token) headers["Authorization"] = `Bearer ${inbox.token}`;
    if (opts.body) headers["Content-Type"] = "application/json";
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async function createInbox() {
    const data = await api("/api/inboxes", { method: "POST", body: "{}" });
    inbox = {
      id: data.id,
      address: data.address,
      token: data.token,
      expiresAt: data.expiresAt,
    };
    save();
    render();
    await refresh();
  }

  // ---- rendering ----
  function render() {
    if (!inbox) {
      els.address.value = "Generating…";
      return;
    }
    els.address.value = inbox.address;
    renderExpiry();
  }

  function renderExpiry() {
    if (!inbox) return;
    const ms = inbox.expiresAt - Date.now();
    if (ms <= 0) {
      els.expiry.textContent = "This address has expired.";
      els.expiry.classList.add("expiring");
      return;
    }
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    els.expiry.textContent = `Expires in ${mins}m ${secs.toString().padStart(2, "0")}s`;
    els.expiry.classList.toggle("expiring", ms < 5 * 60000);
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function renderList(messages) {
    els.list.innerHTML = "";
    if (!messages.length) {
      const li = document.createElement("li");
      li.className = "empty-state";
      li.textContent = "Waiting for the first message…";
      els.list.appendChild(li);
      return;
    }
    for (const m of messages) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "message-item" + (m.seen ? "" : " unseen");
      btn.addEventListener("click", () => openMessage(m.id));

      const top = document.createElement("div");
      top.className = "message-top";
      const from = document.createElement("span");
      from.className = "message-from";
      from.textContent = m.from_name || m.from_addr || "(unknown)";
      const time = document.createElement("span");
      time.className = "message-time";
      time.textContent = fmtTime(m.received_at);
      top.append(from, time);

      const subj = document.createElement("div");
      subj.className = "message-subject";
      subj.textContent = m.subject || "(no subject)";

      const prev = document.createElement("div");
      prev.className = "message-preview";
      prev.textContent = m.preview || "";

      btn.append(top, subj, prev);
      li.appendChild(btn);
      els.list.appendChild(li);
    }
  }

  // ---- actions ----
  async function refresh() {
    if (!inbox) return;
    try {
      const data = await api(`/api/inboxes/${inbox.id}/messages`);
      renderList(data.messages || []);
      els.refreshStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      if (e.status === 404 || e.status === 410) {
        clear();
        await createInbox();
      }
    }
  }

  async function openMessage(id) {
    if (!inbox) return;
    try {
      const data = await api(`/api/inboxes/${inbox.id}/messages/${id}`);
      const m = data.message;
      openMessageId = id;
      els.vSubject.textContent = m.subject || "(no subject)";
      els.vFrom.textContent = m.from_name
        ? `${m.from_name} <${m.from_addr}>`
        : m.from_addr;
      els.vDate.textContent = fmtTime(m.received_at);
      els.vText.textContent = m.text_body || "(no text part)";

      const hasHtml = !!m.html_body;
      if (hasHtml) {
        // Rendered in a fully sandboxed iframe (no scripts, no same-origin).
        els.vHtml.srcdoc = m.html_body;
      }
      els.tabHtml.hidden = !hasHtml;
      selectTab("text");
      els.viewer.showModal();
    } catch {
      /* ignore */
    }
  }

  function selectTab(which) {
    const showHtml = which === "html";
    els.tabText.setAttribute("aria-selected", String(!showHtml));
    els.tabHtml.setAttribute("aria-selected", String(showHtml));
    els.vText.hidden = showHtml;
    els.vHtml.hidden = !showHtml;
  }

  async function deleteOpenMessage() {
    if (!inbox || !openMessageId) return;
    await api(`/api/inboxes/${inbox.id}/messages/${openMessageId}`, {
      method: "DELETE",
    });
    els.viewer.close();
    openMessageId = null;
    await refresh();
  }

  async function copyAddress() {
    if (!inbox) return;
    try {
      await navigator.clipboard.writeText(inbox.address);
    } catch {
      els.address.select();
      document.execCommand("copy");
    }
    els.copy.textContent = "Copied!";
    els.copy.classList.add("copied");
    setTimeout(() => {
      els.copy.textContent = "Copy";
      els.copy.classList.remove("copied");
    }, 1500);
  }

  async function extend() {
    if (!inbox) return;
    try {
      const data = await api(`/api/inboxes/${inbox.id}/extend`, { method: "POST" });
      inbox.expiresAt = data.expiresAt;
      save();
      renderExpiry();
    } catch { /* ignore */ }
  }

  async function newAddress() {
    if (inbox) {
      try { await api(`/api/inboxes/${inbox.id}`, { method: "DELETE" }); }
      catch { /* ignore */ }
    }
    clear();
    await createInbox();
  }

  // ---- timers ----
  function startTimers() {
    stopTimers();
    pollTimer = setInterval(refresh, POLL_MS);
    countdownTimer = setInterval(renderExpiry, 1000);
  }
  function stopTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
  }

  // ---- init ----
  async function init() {
    els.copy.addEventListener("click", copyAddress);
    els.extend.addEventListener("click", extend);
    els.neu.addEventListener("click", newAddress);
    els.refresh.addEventListener("click", refresh);
    els.vClose.addEventListener("click", () => els.viewer.close());
    els.vDelete.addEventListener("click", deleteOpenMessage);
    els.tabText.addEventListener("click", () => selectTab("text"));
    els.tabHtml.addEventListener("click", () => selectTab("html"));
    els.viewer.addEventListener("close", () => { openMessageId = null; });

    load();
    if (inbox && inbox.expiresAt > Date.now()) {
      render();
      await refresh();
    } else {
      clear();
      await createInbox();
    }
    startTimers();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }

  init();
})();
