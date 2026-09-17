// ==UserScript==
// @name         Nghẹo Game - Tự động đổi code Delta Force
// @namespace    https://ngheogame.com/
// @version      1.3.10
// @description  Đổi danh sách Gift Code Delta Force và tổng hợp kết quả ngay trên thiết bị của bạn.
// @author       Nghẹo Game
// @homepageURL  https://ngheogame.com/cong-cu/doi-code-delta-force
// @supportURL   https://discord.gg/BuZWYtNwyf
// @downloadURL  https://ngheogame.com/tools/delta-force-auto-redeem.user.js
// @updateURL    https://ngheogame.com/tools/delta-force-auto-redeem.user.js
// @match        https://ngheogame.com/cong-cu/doi-code-delta-force*
// @match        https://www.ngheogame.com/cong-cu/doi-code-delta-force*
// @match        http://localhost:3001/cong-cu/doi-code-delta-force*
// @match        http://127.0.0.1:3001/cong-cu/doi-code-delta-force*
// @match        https://redeem.df.garena.sg/*
// @run-at       document-idle
// @sandbox      JavaScript
// @inject-into  auto
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_getResourceURL
// @resource     NGHEO_AVATAR https://ngheogame.com/assets/branding/midorikosakurai.jpg
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const INSTANCE_KEY = "__ngheoDeltaForceRedeemTool";
  const HOST_ID = "ngheo-delta-force-tool";
  const LAUNCHER_ID = "ngheo-delta-force-launcher";
  const PENDING_CODES_KEY = "ngheo-df-pending-codes-v1";
  const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;
  const ACTIVE_MARKER = "data-ngheo-df-tool-active";
  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const SOURCE = {
    name: "Nghẹo Game",
    website: "https://ngheogame.com/",
    discord: "https://discord.gg/BuZWYtNwyf"
  };
  const CONFIG = {
    delayBetweenCodesMs: 1000,
    timeoutMs: 2000,
    maxRetries: 0,
    pollMs: 50,
    resultDetectionDelayMs: 80
  };
  const STATUS_LABELS = {
    SUCCESS: "Thành công",
    LIMIT_REACHED: "Đã sử dụng",
    EXPIRED: "Hết hạn",
    PRESENT_ERROR: "Lỗi quà",
    INVALID: "Không hợp lệ",
    USED: "Đã dùng",
    VERIFY: "Cần xác minh",
    TEMP_ERROR: "Lỗi tạm thời",
    NO_RESPONSE: "Không thấy phản hồi",
    STOPPED: "Đã dừng",
    SCRIPT_ERROR: "Lỗi Script",
    OTHER: "Khác"
  };

  if (location.hostname !== "redeem.df.garena.sg") {
    setupWebsiteBridge();
    return;
  }

  if (window[INSTANCE_KEY]) {
    window[INSTANCE_KEY].open();
    return;
  }
  if (document.documentElement.hasAttribute(ACTIVE_MARKER)) return;
  document.documentElement.setAttribute(ACTIVE_MARKER, "true");

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let latestResults = [];
  let running = false;

  const ui = createUi();
  window[INSTANCE_KEY] = {
    open: ui.open,
    parseCodes,
    getResults: () => [...latestResults]
  };
  void mountUiAfterLogin(ui);
  void consumePendingCodes(ui);

  async function mountUiAfterLogin(uiController) {
    if (findInput() && findButton()) {
      uiController.mountLauncher();
      return;
    }
    const controls = await waitForRedeemControls(HANDOFF_MAX_AGE_MS);
    if (controls) uiController.mountLauncher();
  }

  function setupWebsiteBridge() {
    const announceReady = () => {
      document.documentElement.dataset.ngheoDfUserscript = "ready";
      document.dispatchEvent(new Event("ngheo-df-userscript-ready"));
    };

    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin) return;
      if (event.data?.type !== "NGHEO_DF_CODE_HANDOFF") return;

      const input = Array.isArray(event.data.codes) ? event.data.codes.join("\n") : "";
      const parsed = parseCodes(input);
      if (!parsed.codes.length) return;

      setStoredValue(PENDING_CODES_KEY, {
        version: 1,
        codes: parsed.codes,
        createdAt: Date.now()
      });
    });

    document.addEventListener("ngheo-df-userscript-ping", announceReady);
    announceReady();
  }

  async function consumePendingCodes(uiController) {
    const hashPayload = readCodesFromHash();
    let storedPayload = getStoredValue(PENDING_CODES_KEY, null);

    if (!hashPayload) {
      for (let attempt = 0; attempt < 8 && !storedPayload; attempt += 1) {
        storedPayload = getStoredValue(PENDING_CODES_KEY, null);
        if (!storedPayload && attempt < 7) await sleep(150);
      }
    }

    const payload = hashPayload || storedPayload;
    const createdAt = Number(payload?.createdAt || Date.now());
    const fresh = Date.now() - createdAt <= HANDOFF_MAX_AGE_MS;
    const input = fresh && Array.isArray(payload?.codes) ? payload.codes.join("\n") : "";
    const parsed = parseCodes(input);

    clearHandoffHash();
    if (!parsed.codes.length) {
      if (payload) deleteStoredValue(PENDING_CODES_KEY);
      return;
    }

    setStoredValue(PENDING_CODES_KEY, {
      version: 1,
      codes: parsed.codes,
      createdAt
    });
    uiController.loadCodes(parsed.codes, false);

    const controls = await waitForRedeemControls(HANDOFF_MAX_AGE_MS);
    if (!controls) return;

    deleteStoredValue(PENDING_CODES_KEY);
    uiController.loadCodes(parsed.codes, true);
  }

  function readCodesFromHash() {
    try {
      const encoded = new URLSearchParams(location.hash.slice(1)).get("ngheo-codes");
      if (!encoded) return null;
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const payload = JSON.parse(atob(padded));
      return Array.isArray(payload?.codes)
        ? { codes: payload.codes, createdAt: Date.now() }
        : null;
    } catch (_) {
      return null;
    }
  }

  function clearHandoffHash() {
    if (!location.hash.includes("ngheo-codes=")) return;
    try {
      pageWindow.history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch (_) {}
  }

  function setStoredValue(key, value) {
    if (typeof GM_setValue === "function") GM_setValue(key, value);
  }

  function getStoredValue(key, fallback) {
    return typeof GM_getValue === "function" ? GM_getValue(key, fallback) : fallback;
  }

  function deleteStoredValue(key) {
    if (typeof GM_deleteValue === "function") GM_deleteValue(key);
  }

  function normalizeCode(value) {
    return String(value)
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .trim()
      .toUpperCase();
  }

  function parseCodes(input) {
    const rawValues = String(input)
      .split(/[\r\n,;]+/u)
      .map((value) => value.trim())
      .filter(Boolean);
    const codes = [];
    const invalid = [];
    const seen = new Set();
    let duplicates = 0;
    const candidateCodes = new Set(
      rawValues
        .map(normalizeCode)
        .filter((code) => /^[A-Z0-9][A-Z0-9_-]{3,63}$/.test(code))
    );

    for (const rawValue of rawValues) {
      const code = normalizeCode(rawValue);
      if (
        !/^[A-Z0-9][A-Z0-9_-]{3,63}$/.test(code) ||
        isJoinedKnownCodePair(code, candidateCodes)
      ) {
        invalid.push(rawValue);
      } else if (seen.has(code)) {
        duplicates += 1;
      } else {
        seen.add(code);
        codes.push(code);
      }
    }
    return { codes, invalid, duplicates, submitted: rawValues.length };
  }

  function isJoinedKnownCodePair(code, candidateCodes) {
    const parts = code.split("-");
    return parts.length > 1 && parts.every(
      (part) => /^[A-Z0-9][A-Z0-9_-]{3,63}$/.test(part) && candidateCodes.has(part)
    );
  }

  function classifyMessage(message) {
    const text = String(message || "").toLowerCase();
    if (/^ok$|thành công|success/.test(text)) return "SUCCESS";
    if (/error_hint_400067|400067|reached the redemption limit|limit of cdkey group|đạt giới hạn/.test(text)) return "LIMIT_REACHED";
    if (/error_hint_400068|400068|hết hạn|expired/.test(text)) return "EXPIRED";
    if (/error_hint_400073|400073|current cdkey present error/.test(text)) return "PRESENT_ERROR";
    if (/không hợp lệ|invalid|sai|current cdk does not match|error_hint_400054|400054/.test(text)) return "INVALID";
    if (/đã.*(nhận|sử dụng)|already|used/.test(text)) return "USED";
    if (/captcha|xác minh|verification/.test(text)) return "VERIFY";
    if (/lỗi mạng|network|rate|quá nhanh|too fast/.test(text)) return "TEMP_ERROR";
    return text ? "OTHER" : "NO_RESPONSE";
  }

  function visible(element) {
    if (!element) return false;
    const style = pageWindow.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function findInput() {
    return document.querySelector(".exc-input") ||
      [...document.querySelectorAll("input")].find(
        (element) => visible(element) && !element.disabled && !element.readOnly
      );
  }

  function findButton() {
    return document.querySelector(".btn-exchange") ||
      [...document.querySelectorAll("a,button")].find(
        (element) => visible(element) && element.textContent.trim() === "Đổi"
      );
  }

  async function waitForRedeemControls(timeoutMs = 12_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const input = findInput();
      const button = findButton();
      if (input && button) return { input, button };
      await sleep(200);
    }
    return null;
  }

  function setValue(input, value) {
    input.value = value;
    for (const type of ["input", "change"]) {
      const event = input.ownerDocument.createEvent("Event");
      event.initEvent(type, true, false);
      input.dispatchEvent(event);
    }
  }

  function clickRedeem(button) {
    button.click();
  }

  function readPageMessage() {
    const dialog = [...document.querySelectorAll('[role="dialog"], .dialog, .pop, .popup, .modal')]
      .find(visible);
    if (dialog) {
      const text = (dialog.innerText || dialog.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    const tip = document.querySelector("#superTips, .super-tips");
    return tip ? (tip.innerText || tip.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function closeDialog() {
    const dialog = [...document.querySelectorAll('[role="dialog"], .dialog, .pop, .popup, .modal')]
      .find(visible);
    if (!dialog) return;
    const closeButton = dialog.querySelector(".close, .btn-close, a[href='javascript:void(0);'], a[href='javascript:void(0)']") ||
      [...dialog.querySelectorAll("a,button")].find(visible);
    if (closeButton) clickRedeem(closeButton);
  }

  async function clearOldMessage() {
    const tip = document.querySelector("#superTips, .super-tips");
    if (tip) tip.textContent = "";
    closeDialog();
    await sleep(140);
    if (tip) tip.textContent = "";
  }

  async function redeemOne(
    code,
    position,
    total,
    onProgress = () => {},
    shouldStop = () => false
  ) {
    const attempts = [];
    for (let number = 1; number <= CONFIG.maxRetries + 1; number += 1) {
      onProgress("Đang chuẩn bị ô nhập");
      await clearOldMessage();
      const controls = await waitForRedeemControls();
      if (!controls) {
        return buildResult(code, position, total, "SCRIPT_ERROR", "Không tìm thấy ô nhập hoặc nút Đổi.", attempts);
      }

      onProgress("Đang điền code vào Garena");
      setValue(controls.input, "");
      await sleep(20);
      setValue(controls.input, code);
      await sleep(40);
      if (controls.input.value.trim() !== code) {
        throw new Error("Garena không nhận giá trị code trong ô nhập.");
      }

      const startedAt = Date.now();
      let cancelled = false;
      let pageMessage = "";
      onProgress("Đang gửi yêu cầu tới Garena");
      clickRedeem(controls.button);

      let reportedSecond = -1;
      while (!cancelled && Date.now() - startedAt < CONFIG.timeoutMs) {
        await sleep(CONFIG.pollMs);
        if (shouldStop()) {
          cancelled = true;
          break;
        }
        const elapsedMs = Date.now() - startedAt;
        const elapsedSecond = Math.max(1, Math.ceil(elapsedMs / 1000));
        if (elapsedSecond !== reportedSecond) {
          reportedSecond = elapsedSecond;
          onProgress(`Đang chờ Garena phản hồi (${elapsedSecond}s)`);
        }
        if (elapsedMs > CONFIG.resultDetectionDelayMs) {
          pageMessage = readPageMessage();
          if (pageMessage) break;
        }
      }

      closeDialog();
      if (cancelled) {
        return buildResult(
          code,
          position,
          total,
          "STOPPED",
          "Đã dừng theo yêu cầu.",
          attempts
        );
      }
      const status = classifyMessage(pageMessage);
      const message = pageMessage || "Garena không hiển thị kết quả trong 2 giây sau khi bấm Đổi.";
      attempts.push({ attempt: number, status, message });

      return buildResult(code, position, total, status, message, attempts);
    }
  }

  function buildResult(code, position, total, status, message, attempts, responseCode) {
    return {
      stt: `${position}/${total}`,
      code,
      status,
      message,
      responseCode,
      attempts
    };
  }

  function getLauncherAvatarUrl() {
    try {
      if (typeof GM_getResourceURL === "function") {
        return GM_getResourceURL("NGHEO_AVATAR");
      }
    } catch (_) {}
    return "https://ngheogame.com/assets/branding/midorikosakurai.jpg";
  }

  function createUi() {
    document.getElementById(HOST_ID)?.remove();
    document.getElementById(LAUNCHER_ID)?.remove();

    const launcher = document.createElement("button");
    launcher.id = LAUNCHER_ID;
    launcher.type = "button";
    launcher.title = "Mở công cụ đổi code";
    launcher.setAttribute("aria-label", "Mở công cụ đổi code");
    launcher.style.cssText = "all:initial;box-sizing:border-box;position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));width:50px;height:50px;overflow:hidden;z-index:2147483646;border:1px solid #10f79a;border-radius:50%;padding:0;background:#061516;box-shadow:0 10px 30px rgba(0,0,0,.45);cursor:pointer;pointer-events:auto";
    const launcherAvatar = document.createElement("img");
    launcherAvatar.src = getLauncherAvatarUrl();
    launcherAvatar.alt = "";
    launcherAvatar.style.cssText = "display:block;width:100%;height:100%;object-fit:cover;object-position:50% 36%;pointer-events:none";
    const launcherFallback = document.createElement("span");
    launcherFallback.textContent = "NG";
    launcherFallback.setAttribute("aria-hidden", "true");
    launcherFallback.style.cssText = "display:none;width:100%;height:100%;place-items:center;color:#10f79a;font:900 14px Arial,sans-serif;pointer-events:none";
    launcher.append(launcherAvatar, launcherFallback);

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:auto";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${toolStyles()}</style>
      <div class="backdrop" hidden>
        <section class="panel" role="dialog" aria-modal="true" aria-labelledby="ngheo-tool-title">
          <header>
            <div><small>NGHẸO GAME</small><h2 id="ngheo-tool-title">Đổi code Delta Force</h2></div>
            <button class="icon close" type="button" aria-label="Đóng">×</button>
          </header>
          <main>
            <button class="code-list-toggle" type="button" hidden aria-expanded="false">Danh sách code</button>
            <div class="code-editor">
              <label class="field">Danh sách code
                <textarea rows="7" spellcheck="false" placeholder="Dán danh sách đã tạo trên Nghẹo Game"></textarea>
              </label>
              <div class="input-meta"><span class="parse-status">0 code hợp lệ</span><button class="paste" type="button">Dán clipboard</button></div>
            </div>
            <div class="actions"><button class="run" type="button" disabled>Chạy đổi code</button><button class="stop" type="button" hidden>Dừng sau code hiện tại</button></div>
            <p class="progress" role="status"></p>
            <div class="summary" hidden></div>
            <div class="result-actions" hidden><button class="copy-success" type="button">Copy code thành công</button><button class="retry" type="button">Chạy lại code lỗi tạm thời</button></div>
            <div class="results" hidden><table><thead><tr><th>STT</th><th>Code</th><th>Kết quả</th></tr></thead><tbody></tbody></table></div>
          </main>
          <footer>
            <strong>Nguồn: ${SOURCE.name}</strong>
            <a class="discord-cta" href="${SOURCE.discord}" target="_blank" rel="noreferrer">Tham gia Cộng đồng Discord</a>
            <p>Tham gia cộng đồng Discord để thảo luận, nhận hỗ trợ và giao lưu cùng Nghẹo Game.</p>
          </footer>
        </section>
      </div>`;

    const backdrop = shadow.querySelector(".backdrop");
    const close = shadow.querySelector(".close");
    const codeListToggle = shadow.querySelector(".code-list-toggle");
    const codeEditor = shadow.querySelector(".code-editor");
    const textarea = shadow.querySelector("textarea");
    const parseStatus = shadow.querySelector(".parse-status");
    const paste = shadow.querySelector(".paste");
    const run = shadow.querySelector(".run");
    const stop = shadow.querySelector(".stop");
    const progress = shadow.querySelector(".progress");
    const summary = shadow.querySelector(".summary");
    const results = shadow.querySelector(".results");
    const tbody = shadow.querySelector("tbody");
    const resultActions = shadow.querySelector(".result-actions");
    const copySuccess = shadow.querySelector(".copy-success");
    const retry = shadow.querySelector(".retry");
    let stopRequested = false;
    let stopMessage = "";
    let activeTotal = 0;

    const showLauncherFallback = () => {
      launcherAvatar.style.display = "none";
      launcherFallback.style.display = "grid";
    };
    launcherAvatar.addEventListener("error", showLauncherFallback);
    if (launcherAvatar.complete && launcherAvatar.naturalWidth === 0) showLauncherFallback();

    const mountLauncher = () => {
      if (!launcher.isConnected) document.documentElement.appendChild(launcher);
    };

    const setLauncherPending = (pending) => {
      launcher.style.boxShadow = pending
        ? "0 0 0 5px rgba(16,247,154,.16),0 10px 30px rgba(0,0,0,.45)"
        : "0 10px 30px rgba(0,0,0,.45)";
    };

    const open = () => {
      if (!findInput() || !findButton()) {
        launcher.title = "Hãy đăng nhập Garena trước";
        return;
      }
      mountLauncher();
      if (!host.isConnected) document.documentElement.appendChild(host);
      backdrop.hidden = false;
      launcher.hidden = true;
      setLauncherPending(false);
      setTimeout(() => textarea.focus(), 0);
    };
    const closePanel = () => {
      if (running) {
        stopRequested = true;
        stopMessage = "Đã đóng công cụ và dừng theo yêu cầu.";
        stop.disabled = true;
      }
      backdrop.hidden = true;
      host.remove();
      launcher.hidden = false;
    };
    const updateParseStatus = () => {
      const parsed = parseCodes(textarea.value);
      parseStatus.textContent = `${parsed.codes.length} hợp lệ · ${parsed.duplicates} trùng · ${parsed.invalid.length} sai`;
      codeListToggle.textContent = `Danh sách code (${parsed.codes.length})`;
      run.disabled = running || parsed.codes.length === 0;
    };
    const setCodeEditorCollapsed = (collapsed) => {
      codeEditor.hidden = collapsed;
      codeListToggle.hidden = !collapsed && !running && latestResults.length === 0;
      codeListToggle.setAttribute("aria-expanded", String(!collapsed));
      const count = parseCodes(textarea.value).codes.length;
      codeListToggle.textContent = collapsed ? `Danh sách code (${count})` : "Thu gọn danh sách code";
    };
    const setProgress = (position, total, code, status) => {
      progress.className = "progress active";
      progress.replaceChildren();
      const sequence = document.createElement("strong");
      const currentCode = document.createElement("b");
      const state = document.createElement("span");
      sequence.textContent = `[${position}/${total}]`;
      currentCode.textContent = code;
      state.textContent = status;
      progress.append(sequence, currentCode, state);
    };
    const setProgressMessage = (message, tone = "") => {
      progress.className = `progress${tone ? ` ${tone}` : ""}`;
      progress.textContent = message;
    };
    const updateLiveSummary = (total = activeTotal) => {
      const processed = latestResults.length;
      const success = latestResults.filter((item) => item.status === "SUCCESS").length;
      summary.hidden = false;
      summary.innerHTML = `<span class="processed"><small>Đã xử lý</small><strong>${processed}/${total}</strong></span><span class="ok"><small>Thành công</small><strong>${success}</strong></span><span class="fail"><small>Thất bại</small><strong>${processed - success}</strong></span>`;
    };
    const loadCodes = (codes, openPanel = true) => {
      const parsed = parseCodes(Array.isArray(codes) ? codes.join("\n") : "");
      if (!parsed.codes.length) return;
      textarea.value = parsed.codes.join("\n");
      updateParseStatus();
      setProgressMessage(openPanel
        ? `Đã nhận ${parsed.codes.length} code từ Nghẹo Game. Nhấn Chạy đổi code để bắt đầu.`
        : `Đã nhận ${parsed.codes.length} code. Hãy đăng nhập Garena để tiếp tục.`);
      launcher.title = openPanel
        ? "Mở công cụ đổi code"
        : `Đã lưu ${parsed.codes.length} code - hãy đăng nhập Garena`;
      setLauncherPending(!openPanel);
      if (openPanel) open();
    };

    launcher.addEventListener("click", open);
    close.addEventListener("click", closePanel);
    codeListToggle.addEventListener("click", () => {
      setCodeEditorCollapsed(!codeEditor.hidden);
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closePanel();
    });
    textarea.addEventListener("input", updateParseStatus);
    paste.addEventListener("click", async () => {
      try {
        const clipboardText = await navigator.clipboard.readText();
        textarea.value = textarea.value ? `${textarea.value}\n${clipboardText}` : clipboardText;
        updateParseStatus();
      } catch (_) {
        setProgressMessage("Chưa được cấp quyền đọc clipboard. Hãy dán trực tiếp vào ô nhập.", "error");
      }
    });
    stop.addEventListener("click", () => {
      stopRequested = true;
      stopMessage = "Đã dừng theo yêu cầu.";
      stop.disabled = true;
      setProgressMessage("Sẽ dừng sau code đang chạy.", "warning");
    });
    copySuccess.addEventListener("click", async () => {
      const codes = latestResults.filter((item) => item.status === "SUCCESS").map((item) => item.code);
      if (!codes.length) return;
      await navigator.clipboard.writeText(codes.join("\n"));
      copySuccess.textContent = "Đã copy";
    });
    retry.addEventListener("click", () => {
      const codes = latestResults
        .filter((item) => item.status === "NO_RESPONSE" || item.status === "TEMP_ERROR")
        .map((item) => item.code);
      textarea.value = codes.join("\n");
      updateParseStatus();
      void startRun();
    });
    run.addEventListener("click", () => void startRun());

    async function startRun() {
      if (running) return;
      const parsed = parseCodes(textarea.value);
      if (!parsed.codes.length) return;
      running = true;
      stopRequested = false;
      stopMessage = "";
      activeTotal = parsed.codes.length;
      latestResults = [];
      tbody.textContent = "";
      setCodeEditorCollapsed(true);
      updateLiveSummary();
      results.hidden = false;
      resultActions.hidden = true;
      run.disabled = true;
      run.hidden = true;
      stop.hidden = false;
      stop.disabled = false;
      textarea.disabled = true;
      paste.disabled = true;

      try {
        for (let index = 0; index < parsed.codes.length; index += 1) {
          const code = parsed.codes[index];
          setProgress(index + 1, parsed.codes.length, code, "Đang bắt đầu");
          let result;
          try {
            result = await redeemOne(
              code,
              index + 1,
              parsed.codes.length,
              (status) => {
                if (!stopRequested) setProgress(index + 1, parsed.codes.length, code, status);
              },
              () => stopRequested
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error || "Lỗi không xác định");
            result = buildResult(
              code,
              index + 1,
              parsed.codes.length,
              "SCRIPT_ERROR",
              `Script không thể kích hoạt nút Đổi: ${message}`,
              [{ attempt: 1, status: "SCRIPT_ERROR", message }]
            );
            console.error("[Nghẹo Game] Lỗi khi chạy code", { code, error });
          }
          if (result.status === "SCRIPT_ERROR") {
            stopRequested = true;
            stopMessage = result.message;
          }
          latestResults.push(result);
          appendResultRow(tbody, result);
          updateLiveSummary();
          console.log(`[Nghẹo Game ${result.stt}] ${STATUS_LABELS[result.status]} ${result.code}: ${result.message}`);
          if (stopRequested) break;
          if (index < parsed.codes.length - 1) await sleep(CONFIG.delayBetweenCodesMs);
        }
      } finally {
        running = false;
        run.hidden = false;
        stop.hidden = true;
        textarea.disabled = false;
        paste.disabled = false;
      }

      const success = latestResults.filter((item) => item.status === "SUCCESS").length;
      const retryable = latestResults.filter(
        (item) => item.status === "NO_RESPONSE" || item.status === "TEMP_ERROR"
      ).length;
      updateLiveSummary();
      setProgressMessage(
        stopRequested ? (stopMessage || "Đã dừng theo yêu cầu.") : "Hoàn tất.",
        stopRequested ? "warning" : "complete"
      );
      resultActions.hidden = false;
      copySuccess.hidden = success === 0;
      copySuccess.textContent = `Copy code thành công (${success})`;
      retry.hidden = retryable === 0;
      retry.textContent = `Chạy lại code lỗi tạm thời (${retryable})`;
      updateParseStatus();
      logCompletion(latestResults);
    }

    updateParseStatus();
    return { open, loadCodes, mountLauncher };
  }

  function appendResultRow(tbody, result) {
    const row = document.createElement("tr");
    const sequence = document.createElement("td");
    const code = document.createElement("td");
    const status = document.createElement("td");
    sequence.textContent = result.stt;
    code.textContent = result.code;
    status.textContent = STATUS_LABELS[result.status] || result.status;
    status.className = result.status === "SUCCESS" ? "ok" : "fail";
    status.title = result.message;
    row.append(sequence, code, status);
    tbody.appendChild(row);
  }

  function logCompletion(results) {
    const success = results.filter((item) => item.status === "SUCCESS").length;
    console.log("========================================");
    console.log("HOÀN TẤT");
    console.log(`Tổng: ${results.length} | Thành công: ${success} | Thất bại: ${results.length - success}`);
    console.table(results.map((item) => ({
      STT: item.stt,
      code: item.code,
      "trạng thái": STATUS_LABELS[item.status],
      "thông báo": item.message
    })));
    console.log(`Nguồn: ${SOURCE.name}`);
    console.log(`Website: ${SOURCE.website}`);
    console.log(`Discord: ${SOURCE.discord}`);
    console.log("Ủng hộ mua clone tại website và tham gia cộng đồng Discord thảo luận & giao lưu nhé ♥");
    console.log("========================================");
  }

  function toolStyles() {
    return `
      :host { all: initial; position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; pointer-events: auto !important; font-family: Arial, sans-serif; color: #effff9; }
      * { box-sizing: border-box; letter-spacing: 0; }
      [hidden] { display: none !important; }
      button, textarea { font: inherit; }
      .backdrop { position: absolute; inset: 0; display: grid; place-items: center; padding: 14px; background: rgba(0,8,9,.78); pointer-events: auto; }
      .backdrop[hidden] { display: none; }
      .panel { display: grid; width: min(560px, 100%); max-height: calc(100dvh - 28px); grid-template-rows: auto minmax(0,1fr) auto; overflow: hidden; border: 1px solid #10f79a; background: #071415; box-shadow: 0 24px 70px rgba(0,0,0,.65); }
      header { display: flex; min-height: 66px; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-bottom: 1px solid rgba(16,247,154,.25); }
      header small { color: #10f79a; font-size: 9px; font-weight: 800; }
      h2 { margin: 3px 0 0; font-size: 20px; line-height: 1.1; }
      .icon { width: 36px; height: 36px; border: 1px solid #37534b; background: transparent; color: #dff9ef; cursor: pointer; font-size: 22px; }
      main { overflow: auto; padding: 16px; }
      .code-editor { display: grid; }
      .code-list-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; border-color: #3d5b52; color: #cffff0; text-align: left; }
      .code-list-toggle::after { content: "+"; color: #10f79a; font-size: 16px; }
      .code-list-toggle[aria-expanded="true"]::after { content: "−"; }
      .field { display: grid; gap: 7px; color: #a9c1b9; font-size: 11px; }
      textarea { width: 100%; min-height: 130px; resize: vertical; border: 1px solid #37534b; outline: 0; padding: 11px; background: #020a0b; color: #effff9; font: 12px/1.5 Consolas, monospace; }
      textarea:focus { border-color: #10f79a; }
      .input-meta, .actions, .result-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
      .input-meta { color: #91aaa2; font-size: 10px; }
      button { min-height: 36px; border: 1px solid #4a645d; padding: 0 11px; background: transparent; color: #e7fff7; cursor: pointer; font-weight: 700; }
      button:disabled { cursor: not-allowed; opacity: .5; }
      .run, .copy-success { border-color: #10f79a; background: #10f79a; color: #03110d; }
      .stop { border-color: #f4c341; color: #f4c341; }
      .progress { min-height: 18px; margin: 12px 0 0; color: #a9c1b9; font-size: 11px; line-height: 1.45; }
      .progress.active { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 9px 10px; border-left: 3px solid #10f79a; background: rgba(16,247,154,.06); }
      .progress.active strong { color: #f4c341; font-size: 12px; }
      .progress.active b { overflow-wrap: anywhere; color: #effff9; font: 800 12px/1.4 Consolas, monospace; }
      .progress.active span { color: #10e9b0; font-weight: 700; }
      .progress.complete { color: #10e9b0; font-weight: 800; }
      .progress.warning, .progress.error { color: #f4c341; font-weight: 800; }
      .summary { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1px; margin-top: 12px; background: #385149; }
      .summary span { display: grid; min-height: 58px; place-content: center; gap: 3px; background: #0a1d1b; text-align: center; }
      .summary small { color: #8ba39b; font-size: 9px; }
      .summary strong { font-size: 18px; }
      .summary .processed strong { color: #effff9; }
      .ok { color: #10f79a !important; }
      .fail { color: #f4c341 !important; }
      .result-actions { margin-top: 12px; }
      .results { max-height: 210px; overflow: auto; margin-top: 12px; border: 1px solid #30483f; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
      th, td { overflow: hidden; padding: 8px; border-bottom: 1px solid #263d36; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
      th:first-child, td:first-child { width: 54px; }
      th:last-child, td:last-child { width: 118px; }
      footer { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; padding: 12px 16px; border-top: 1px solid rgba(16,247,154,.25); color: #a9c1b9; font-size: 10px; }
      footer strong { color: #10f79a; }
      footer a { color: #74e9c1; }
      footer .discord-cta { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; border: 1px solid #10f79a; padding: 0 11px; background: rgba(16,247,154,.1); color: #bfffe9; font-weight: 800; text-decoration: none; }
      footer p { width: 100%; margin: 0; color: #d5fff1; line-height: 1.35; }
      @media (max-width: 520px) {
        .backdrop { align-items: end; padding: 0; }
        .panel { width: 100%; max-height: 94dvh; border-right: 0; border-bottom: 0; border-left: 0; }
        .actions, .result-actions { display: grid; grid-template-columns: 1fr; }
        .actions button, .result-actions button { width: 100%; }
        footer .discord-cta { width: 100%; }
      }
    `;
  }
})();
