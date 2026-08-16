window.__ModuleLoader__.load({
  id: "@whalemaid/plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/client/AttachmentButton.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/native.ts
var MAX_NATIVE_CHUNK_BYTES = 256 * 1024;
var MAX_NATIVE_ASSET_BYTES = 64 * 1024 * 1024;
function getNativeBridge() {
  const capacitor = globalThis.Capacitor;
  const candidate = capacitor?.Plugins?.WhaleMaidNative;
  if (candidate === void 0) return null;
  const methods = [
    "capabilities",
    "capturePhoto",
    "pickGallery",
    "pickFiles",
    "startRecording",
    "stopRecording",
    "cancelRecording",
    "readAsset",
    "releaseAsset"
  ];
  if (methods.some((method) => typeof candidate[method] !== "function")) return null;
  return candidate;
}
function checkedAsset(value) {
  if (value === void 0 || typeof value.id !== "string" || value.id === "" || typeof value.name !== "string" || typeof value.mimeType !== "string" || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAX_NATIVE_ASSET_BYTES) {
    throw new Error("ASSET_UNREADABLE");
  }
  return value;
}
function decodeBase64(value) {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
async function readNativeAsset(bridge, rawAsset) {
  const releasableId = typeof rawAsset?.id === "string" && rawAsset.id !== "" ? rawAsset.id : null;
  const chunks = [];
  let offset = 0;
  try {
    const asset = checkedAsset(rawAsset);
    while (offset < asset.size) {
      const chunk = await bridge.readAsset({
        id: asset.id,
        offset,
        length: Math.min(MAX_NATIVE_CHUNK_BYTES, asset.size - offset)
      });
      if (chunk.offset !== offset) throw new Error("ASSET_UNREADABLE");
      const bytes = decodeBase64(chunk.data);
      if (bytes.length === 0 || bytes.length > MAX_NATIVE_CHUNK_BYTES) throw new Error("ASSET_UNREADABLE");
      if (offset + bytes.length > asset.size) throw new Error("ASSET_UNREADABLE");
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      chunks.push(copy.buffer);
      offset += bytes.length;
      if (chunk.done !== offset >= asset.size) throw new Error("ASSET_UNREADABLE");
    }
    return new File(chunks, asset.name, { type: asset.mimeType || "application/octet-stream" });
  } finally {
    if (releasableId !== null) await bridge.releaseAsset({ id: releasableId }).catch(() => void 0);
  }
}
async function readNativeAssets(bridge, response) {
  const assets = response.assets ?? (response.asset === void 0 ? [] : [response.asset]);
  if (assets.length === 0) throw new Error("ASSET_UNREADABLE");
  return await Promise.all(assets.map((asset) => readNativeAsset(bridge, asset)));
}
function pasteFilesIntoComposer(files) {
  if (files.length === 0) return false;
  const active = document.activeElement;
  const target = active instanceof HTMLTextAreaElement && active.closest("[data-composer-card]") !== null ? active : document.querySelector("[data-composer-card] textarea");
  if (target === null) return false;
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  target.focus();
  const event = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: transfer
  });
  target.dispatchEvent(event);
  return true;
}

// src/client/voice.ts
function bytesToBase64(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    const chunk = bytes.subarray(offset, offset + 32768);
    let binary = "";
    for (const byte of chunk) binary += String.fromCharCode(byte);
    parts.push(binary);
  }
  return globalThis.btoa(parts.join(""));
}
async function transcribeAudio(file, fetchImpl = fetch) {
  const audio = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  const response = await fetchImpl("/api/whalemaid/voice.transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audio, mimeType: file.type || "audio/mp4" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `\u8BED\u97F3\u8F6C\u5F55\u5931\u8D25 (${response.status})`);
  }
  if (typeof payload.text !== "string" || payload.text.trim() === "") throw new Error("\u8BED\u97F3\u8F6C\u5F55\u54CD\u5E94\u7F3A\u5C11 text");
  return payload.text.trim();
}
function appendTranscript(draft, transcript) {
  if (draft === "") return transcript;
  return `${draft}${/\s$/u.test(draft) ? "" : " "}${transcript}`;
}

// src/client/AttachmentButton.css
var AttachmentButton_default = ".whalemaid-attachment-root {\n  position: relative;\n  flex: none;\n}\n\n.whalemaid-attachment-button {\n  display: grid;\n  place-items: center;\n  width: 28px;\n  height: 28px;\n  padding: 0;\n  border: none;\n  border-radius: 999px;\n  background: var(--dsw-specific-selector);\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n}\n\n.whalemaid-attachment-button:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-solid);\n}\n\n.whalemaid-attachment-button:focus-visible,\n.whalemaid-attachment-option:focus-visible {\n  outline: 2px solid var(--dsw-alias-label-tertiary);\n  outline-offset: 2px;\n}\n\n.whalemaid-attachment-button:disabled {\n  cursor: default;\n  opacity: 0.45;\n}\n\n.whalemaid-attachment-menu {\n  position: absolute;\n  z-index: 20;\n  bottom: calc(100% + 8px);\n  left: 0;\n  display: grid;\n  gap: 2px;\n  min-width: 112px;\n  padding: 4px;\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 8px;\n  background: var(--dsw-specific-tip);\n}\n\n.whalemaid-attachment-option {\n  min-height: 32px;\n  padding: 6px 10px;\n  border: none;\n  border-radius: 5px;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  text-align: left;\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.whalemaid-attachment-option:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-solid);\n}\n\n.whalemaid-attachment-option:disabled {\n  cursor: default;\n  opacity: 0.5;\n}\n\n.whalemaid-attachment-stop {\n  width: 10px;\n  height: 10px;\n  border-radius: 2px;\n  background: currentColor;\n}\n\n.whalemaid-attachment-recording,\n.whalemaid-attachment-error {\n  position: absolute;\n  z-index: 21;\n  bottom: calc(100% + 8px);\n  left: 0;\n  max-width: min(260px, 70vw);\n  padding: 6px 8px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-specific-tip);\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 1.35;\n  white-space: normal;\n}\n";

// src/client/AttachmentButton.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var classes = {
  root: "whalemaid-attachment-root",
  button: "whalemaid-attachment-button",
  menu: "whalemaid-attachment-menu",
  option: "whalemaid-attachment-option",
  stop: "whalemaid-attachment-stop",
  recording: "whalemaid-attachment-recording",
  error: "whalemaid-attachment-error"
};
function installStyles() {
  const existing = document.querySelector("style[data-whalemaid-attachments]");
  if (existing !== null) return () => void 0;
  const style = document.createElement("style");
  style.dataset.whalemaidAttachments = "";
  style.textContent = AttachmentButton_default;
  document.head.append(style);
  return () => {
    style.remove();
  };
}
function isCancelled(error) {
  return error instanceof Error && error.message === "USER_CANCELLED";
}
function AttachmentButton({ input, inputActions, getBridge }) {
  const bridge = getBridge();
  const rootRef = (0, import_react.useRef)(null);
  const recordingRef = (0, import_react.useRef)(null);
  const [open, setOpen] = (0, import_react.useState)(false);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [recordingHandle, setRecordingHandle] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => installStyles(), []);
  (0, import_react.useEffect)(() => () => {
    const handle = recordingRef.current;
    if (handle !== null && bridge !== null) void bridge.cancelRecording({ handle }).catch(() => void 0);
  }, [bridge]);
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const close = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  if (bridge === null || inputActions === void 0) return null;
  const disabled = busy || recordingHandle === null && input.phase !== "plain";
  const pick = async (kind) => {
    setBusy(true);
    setError(null);
    try {
      const response = kind === "camera" ? await bridge.capturePhoto() : kind === "gallery" ? await bridge.pickGallery({ multiple: true }) : await bridge.pickFiles({ multiple: true, mimeTypes: ["image/*"] });
      const files = await readNativeAssets(bridge, response);
      if (!pasteFilesIntoComposer(files)) throw new Error("INPUT_UNAVAILABLE");
      setOpen(false);
    } catch (cause) {
      if (!isCancelled(cause)) setError("\u9644\u4EF6\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  const beginRecording = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.startRecording();
      if (typeof result.handle !== "string" || result.handle === "") throw new Error("RECORDING_START_FAILED");
      recordingRef.current = result.handle;
      setRecordingHandle(result.handle);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "\u65E0\u6CD5\u5F00\u59CB\u5F55\u97F3");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  const finishRecording = async () => {
    const handle = recordingRef.current;
    if (handle === null) return;
    recordingRef.current = null;
    setRecordingHandle(null);
    setBusy(true);
    setError(null);
    try {
      const response = await bridge.stopRecording({ handle });
      const [file] = await readNativeAssets(bridge, response);
      if (file === void 0) throw new Error("ASSET_UNREADABLE");
      const transcript = await transcribeAudio(file);
      inputActions.setDraft(appendTranscript(input.draft, transcript));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "\u8BED\u97F3\u8F6C\u5F55\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const buttonLabel = recordingHandle === null ? "\u6DFB\u52A0\u56FE\u7247\u6216\u8BED\u97F3" : "\u505C\u6B62\u5F55\u97F3";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: rootRef, className: classes.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: buttonLabel, side: "top", delayMs: 500, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: classes.button,
        "aria-label": buttonLabel,
        "aria-expanded": recordingHandle === null ? open : void 0,
        "aria-haspopup": recordingHandle === null ? "menu" : void 0,
        disabled,
        onMouseDown: (event) => {
          event.preventDefault();
        },
        onClick: () => {
          setError(null);
          if (recordingHandle !== null) void finishRecording();
          else setOpen((value) => !value);
        },
        children: recordingHandle === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconPaperclipOutline16, { size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: classes.stop, "aria-hidden": true })
      }
    ) }),
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: classes.menu, role: "menu", "aria-label": "\u6DFB\u52A0\u56FE\u7247", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: classes.option, role: "menuitem", disabled: busy, onClick: () => {
        void pick("camera");
      }, children: "\u62CD\u7167" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: classes.option, role: "menuitem", disabled: busy, onClick: () => {
        void pick("gallery");
      }, children: "\u76F8\u518C" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: classes.option, role: "menuitem", disabled: busy, onClick: () => {
        void pick("file");
      }, children: "\u6587\u4EF6" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: classes.option, role: "menuitem", disabled: busy, onClick: () => {
        void beginRecording();
      }, children: "\u5F55\u97F3" })
    ] }),
    recordingHandle !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: classes.recording, role: "status", children: "\u5F55\u97F3\u4E2D" }),
    error !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: classes.error, role: "status", "aria-live": "polite", children: error })
  ] });
}
function attachmentInjected() {
  return { getBridge: getNativeBridge };
}

// src/client/TemporaryAccessPanel.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/temporary-client.ts
var HEADERS = { "x-whalemaid-client": "1" };
async function parse(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `\u8BF7\u6C42\u5931\u8D25 ${response.status}`);
  return body;
}
async function readDeviceAccess(request = fetch) {
  return parse(await request("/api/whalemaid/device", { headers: HEADERS }));
}
async function issueTemporaryPassword(ttlSec, request = fetch) {
  return parse(await request("/api/whalemaid/temporary-password", {
    method: "POST",
    headers: { ...HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ ttlSec })
  }));
}
async function revokeTemporaryPassword(request = fetch) {
  return parse(await request("/api/whalemaid/temporary-password", {
    method: "DELETE",
    headers: HEADERS
  }));
}

// src/client/TemporaryAccessPanel.css
var TemporaryAccessPanel_default = ".whalemaid-access-trigger {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  min-width: 32px;\n  height: 32px;\n  padding: 0 8px;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n}\n\n.whalemaid-access-trigger:hover {\n  background: var(--dsw-alias-interactive-bg-hover-solid);\n  color: var(--dsw-alias-label-primary);\n}\n\n.whalemaid-access-trigger:focus-visible,\n.whalemaid-access-button:focus-visible,\n.whalemaid-access-icon-button:focus-visible,\n.whalemaid-access-select:focus-visible {\n  outline: 2px solid var(--dsw-alias-label-tertiary);\n  outline-offset: 2px;\n}\n\n.whalemaid-access-trigger-label {\n  white-space: nowrap;\n}\n\n.whalemaid-access-dialog {\n  width: min(440px, calc(100vw - 24px));\n  max-height: calc(100vh - 24px);\n  border-radius: 8px;\n}\n\n.whalemaid-access-body {\n  display: grid;\n  gap: 18px;\n  min-width: 0;\n}\n\n.whalemaid-access-field {\n  display: grid;\n  gap: 7px;\n}\n\n.whalemaid-access-label {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.whalemaid-access-value-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n\n.whalemaid-access-code {\n  min-width: 0;\n  overflow-wrap: anywhere;\n  color: var(--dsw-alias-label-primary);\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 15px;\n}\n\n.whalemaid-access-password {\n  font-size: 19px;\n  font-weight: 600;\n}\n\n.whalemaid-access-status {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.whalemaid-access-error {\n  margin: 0;\n  color: var(--dsw-alias-label-error);\n  font-size: 13px;\n  overflow-wrap: anywhere;\n}\n\n.whalemaid-access-select {\n  width: 100%;\n  height: 36px;\n  padding: 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n}\n\n.whalemaid-access-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.whalemaid-access-button,\n.whalemaid-access-icon-button {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 7px;\n  min-height: 34px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  cursor: pointer;\n}\n\n.whalemaid-access-button {\n  padding: 0 12px;\n}\n\n.whalemaid-access-icon-button {\n  width: 34px;\n  padding: 0;\n  flex: none;\n}\n\n.whalemaid-access-button:hover:not(:disabled),\n.whalemaid-access-icon-button:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-solid);\n}\n\n.whalemaid-access-button:disabled,\n.whalemaid-access-icon-button:disabled {\n  cursor: default;\n  opacity: 0.45;\n}\n\n@media (max-width: 520px) {\n  .whalemaid-access-dialog {\n    width: calc(100vw - 16px);\n    max-height: calc(100vh - 16px);\n  }\n\n  .whalemaid-access-actions .whalemaid-access-button {\n    flex: 1 1 120px;\n  }\n}\n";

// src/client/TemporaryAccessPanel.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function installStyles2() {
  const existing = document.querySelector("style[data-whalemaid-access]");
  if (existing !== null) return () => void 0;
  const style = document.createElement("style");
  style.dataset.whalemaidAccess = "";
  style.textContent = TemporaryAccessPanel_default;
  document.head.append(style);
  return () => {
    style.remove();
  };
}
function stateLabel(state) {
  switch (state) {
    case "none":
      return "\u5C1A\u672A\u751F\u6210";
    case "active":
      return "\u53EF\u4F7F\u7528\u4E00\u6B21";
    case "consumed":
      return "\u5DF2\u4F7F\u7528";
    case "expired":
      return "\u5DF2\u8FC7\u671F";
    case "revoked":
      return "\u5DF2\u64A4\u9500";
  }
}
function remainingLabel(expiresAt, now) {
  const seconds = Math.max(0, expiresAt - now);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} \u5C0F\u65F6 ${minutes % 60} \u5206`;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
function TemporaryAccessPanel({ wide }) {
  const [open, setOpen] = (0, import_react2.useState)(false);
  const [view, setView] = (0, import_react2.useState)(null);
  const [ttlSec, setTtlSec] = (0, import_react2.useState)(600);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const [copied, setCopied] = (0, import_react2.useState)(null);
  const [now, setNow] = (0, import_react2.useState)(() => Math.floor(Date.now() / 1e3));
  (0, import_react2.useEffect)(() => installStyles2(), []);
  (0, import_react2.useEffect)(() => {
    if (!open) return;
    setBusy(true);
    setError(null);
    void readDeviceAccess().then(setView).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      setBusy(false);
    });
  }, [open]);
  (0, import_react2.useEffect)(() => {
    if (!open || view?.temporaryPassword.state !== "active") return;
    const timer = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1e3));
    }, 1e3);
    return () => {
      window.clearInterval(timer);
    };
  }, [open, view?.temporaryPassword.state]);
  const temporary = view?.temporaryPassword;
  const remaining = (0, import_react2.useMemo)(
    () => temporary?.state === "active" ? remainingLabel(temporary.expiresAt, now) : null,
    [now, temporary]
  );
  const issue = async () => {
    setBusy(true);
    setError(null);
    setCopied(null);
    try {
      setView(await issueTemporaryPassword(ttlSec));
      setNow(Math.floor(Date.now() / 1e3));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await revokeTemporaryPassword());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (label, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => {
        setCopied((current) => current === label ? null : current);
      }, 1500);
    } catch {
      setError("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9");
    }
  };
  const trigger = /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "button",
    {
      type: "button",
      className: "whalemaid-access-trigger",
      "aria-label": "\u8FDC\u7A0B\u534F\u52A9",
      "aria-expanded": open,
      onClick: () => {
        setOpen(true);
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconShareOutline16, { size: 16 }),
        wide && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "whalemaid-access-trigger-label", children: "\u8FDC\u7A0B\u534F\u52A9" })
      ]
    }
  );
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    wide ? trigger : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: "\u8FDC\u7A0B\u534F\u52A9", side: "right", delayMs: 500, children: trigger }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      import_dsh_client_ui_primitives2.Modal,
      {
        open,
        onClose: () => {
          setOpen(false);
        },
        title: "\u8FDC\u7A0B\u534F\u52A9",
        closeLabel: "\u5173\u95ED",
        description: "\u77ED\u671F\u5BC6\u7801\u4EC5\u53EF\u4F7F\u7528\u4E00\u6B21\uFF0C\u5230\u671F\u6216\u64A4\u9500\u540E\u7ACB\u5373\u5931\u6548\u3002",
        className: "whalemaid-access-dialog",
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "whalemaid-access-body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "whalemaid-access-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "whalemaid-access-label", children: "\u8BBE\u5907\u7F16\u53F7" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "whalemaid-access-value-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "whalemaid-access-code", children: view?.deviceId ?? (busy ? "\u8BFB\u53D6\u4E2D" : "-") }),
              view?.deviceId && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: "\u590D\u5236\u8BBE\u5907\u7F16\u53F7", side: "top", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "whalemaid-access-icon-button", "aria-label": "\u590D\u5236\u8BBE\u5907\u7F16\u53F7", onClick: () => {
                void copy("device", view.deviceId);
              }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconCopyOutline16, { size: 16 }) }) })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "whalemaid-access-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "whalemaid-access-label", children: "\u6709\u6548\u671F" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { className: "whalemaid-access-select", value: ttlSec, disabled: busy, onChange: (event) => {
              setTtlSec(Number(event.target.value));
            }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: 600, children: "10 \u5206\u949F" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: 1800, children: "30 \u5206\u949F" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: 3600, children: "1 \u5C0F\u65F6" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: 14400, children: "4 \u5C0F\u65F6" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "whalemaid-access-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "whalemaid-access-label", children: "\u77ED\u671F\u5BC6\u7801" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "whalemaid-access-value-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "whalemaid-access-code whalemaid-access-password", children: temporary?.password || stateLabel(temporary?.state ?? "none") }),
              temporary?.password && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: "\u590D\u5236\u77ED\u671F\u5BC6\u7801", side: "top", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "whalemaid-access-icon-button", "aria-label": "\u590D\u5236\u77ED\u671F\u5BC6\u7801", onClick: () => {
                void copy("password", temporary.password);
              }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconCopyOutline16, { size: 16 }) }) })
            ] }),
            temporary && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "whalemaid-access-status", role: "status", children: [
              stateLabel(temporary.state),
              remaining !== null ? `\uFF0C\u5269\u4F59 ${remaining}` : "",
              copied !== null ? "\uFF0C\u5DF2\u590D\u5236" : ""
            ] })
          ] }),
          error !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "whalemaid-access-error", role: "alert", children: error }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "whalemaid-access-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: "whalemaid-access-button", disabled: busy, onClick: () => {
              void issue();
            }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutline16, { size: 16 }),
              temporary?.state === "active" ? "\u5237\u65B0\u5BC6\u7801" : "\u751F\u6210\u5BC6\u7801"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: "whalemaid-access-button", disabled: busy || temporary?.state !== "active", onClick: () => {
              void revoke();
            }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconTrashOutline16, { size: 16 }),
              "\u64A4\u9500"
            ] })
          ] })
        ] })
      }
    )
  ] });
}

// src/client/index.ts
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left",
    id: "whalemaid-attachments",
    order: 10,
    inject: attachmentInjected
  }, AttachmentButton));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "whalemaid-temporary-access",
    order: 20
  }, TemporaryAccessPanel));
}

    return module.exports;
  },
});
