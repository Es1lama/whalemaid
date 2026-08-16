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

// src/client/index.ts
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left",
    id: "whalemaid-attachments",
    order: 10,
    inject: attachmentInjected
  }, AttachmentButton));
}

    return module.exports;
  },
});
