// src/index.ts
import { credentialRef } from "@deepseek-ai/dsh-credentials";

// ../contract/src/envelope.ts
var PROTOCOL_VERSION = 1;

// ../contract/src/caps.ts
var CAPABILITIES = {
  session: "session",
  workspaceCreate: "workspace-create",
  directoryBrowse: "directory-browse",
  voiceByok: "voice-byok",
  visionByok: "vision-byok",
  hotwords: "hotwords",
  relay: "relay",
  direct: "direct"
};

// ../contract/src/errors.ts
var ERROR_CODES = {
  badRequest: "bad-request",
  authFailed: "auth-failed",
  deviceRevoked: "device-revoked",
  tokenExpired: "token-expired",
  rateLimited: "rate-limited",
  methodUnknown: "method-unknown",
  capUnsupported: "cap-unsupported",
  directoryUnreadable: "directory-unreadable",
  directoryExists: "directory-exists",
  directoryCreateFailed: "directory-create-failed",
  scopeDenied: "scope-denied",
  serverError: "server-error"
};

// ../contract/src/device.ts
var DEVICE_ID_PATTERN = /^WHALE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

// ../contract/src/channels.ts
var VOICE_PROVIDERS = {
  /** 阿里 DashScope Paraformer-v2（录音文件识别） */
  dashscope: "dashscope",
  /** OpenAI whisper-1（audio/transcriptions） */
  openai: "openai",
  /** Groq whisper-large-v3（OpenAI 兼容） */
  groq: "groq",
  /** 讯飞（预留，待接入） */
  iflytek: "iflytek"
};
var VISION_PROVIDERS = {
  /** DeepSeek-OCR（OpenAI 兼容 chat） */
  deepseekOcr: "deepseek-ocr",
  /** 通义千问 VL（max/plus 由 model 决定，OpenAI 兼容模式） */
  qwenVl: "qwen-vl",
  /** OpenAI 视觉（GPT-5.6 等） */
  openai: "openai-vision",
  /** xAI Grok 视觉 */
  grok: "grok-vision",
  /** Google Gemini（generateContent） */
  gemini: "gemini"
};

// src/store.ts
import { createHash, randomBytes as randomBytes2 } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// src/device.ts
import { randomBytes } from "node:crypto";
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function base32(bytes, groups) {
  let bits = 0;
  let value = 0;
  let out = "";
  const size = groups[0] + groups[1];
  for (const byte of bytes) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[value >>> bits & 31];
    }
  }
  return out.slice(0, size);
}
function generateDeviceId() {
  const raw = base32(randomBytes(8), [4, 4]);
  return `WHALE-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}
function generatePassword() {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

// src/store.ts
var TOKEN_TTL_MS = 10 * 6e4;
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
var Store = class {
  state;
  path;
  constructor(dataDir) {
    const base = dataDir || join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "whalemaid");
    this.path = join(base, "store.json");
    mkdirSync(base, { recursive: true });
    this.state = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : {
      longPassword: this.newPassword(),
      deviceId: generateDeviceId(),
      relayCredential: "",
      pendingNonces: {},
      devices: [],
      tempTokens: [],
      tempPasswords: [],
      audit: []
    };
    this.state.tempPasswords ??= [];
    this.state.relayCredential ??= "";
    this.state.deviceId ??= generateDeviceId();
    this.persist();
  }
  /** 长期密码生成在构造时完成；插件设置页可触发重新生成（重生成=全量吊销，REQ-002） */
  newPassword() {
    return generatePassword();
  }
  persist() {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2), { mode: 384 });
  }
  get longPassword() {
    return this.state.longPassword;
  }
  get file() {
    return this.path;
  }
  /** UX-002：受控端设备编号（主界面展示） */
  get deviceId() {
    return this.state.deviceId;
  }
  get relayCredential() {
    return this.state.relayCredential;
  }
  setRelayCredential(value) {
    this.state.relayCredential = value;
    this.persist();
  }
  rotatePassword() {
    this.state.longPassword = this.newPassword();
    this.state.devices = [];
    this.state.tempTokens = [];
    this.persist();
    return this.state.longPassword;
  }
  /** 握手时登记：nonce 绑定设备与公钥（绑定流程验签用，TM-004） */
  addNonce(deviceId, publicKeyJwk, ttlMs = 6e4) {
    const nonce = randomBytes2(16).toString("base64url");
    this.state.pendingNonces[nonce] = { deviceId, publicKeyJwk, expiresAt: Date.now() + ttlMs };
    this.persist();
    return nonce;
  }
  takeNonce(nonce) {
    const entry = this.state.pendingNonces[nonce];
    if (!entry || entry.expiresAt < Date.now()) return null;
    delete this.state.pendingNonces[nonce];
    this.persist();
    return entry;
  }
  issueToken(deviceId, ttlMs = TOKEN_TTL_MS) {
    const token = randomBytes2(32).toString("base64url");
    const now = Date.now();
    this.state.devices.push({
      deviceId,
      publicKeyJwk: {},
      // bind 时由路由回填
      tokenDigest: digest(token),
      createdAt: now,
      expiresAt: now + ttlMs,
      lastUsedAt: now,
      revoked: false
    });
    this.persist();
    return token;
  }
  bindPublicKey(deviceId, jwk) {
    const dev = this.state.devices.find((d) => d.deviceId === deviceId && !d.revoked);
    if (dev) {
      dev.publicKeyJwk = jwk;
      this.persist();
    }
  }
  /** SEC-004：会话 token 校验——过期即失效，成功则滑动续期 */
  findDeviceByToken(token) {
    const d = digest(token);
    const dev = this.state.devices.find((x) => x.tokenDigest === d && !x.revoked);
    if (!dev) return void 0;
    const now = Date.now();
    if (dev.expiresAt <= now) return void 0;
    dev.lastUsedAt = now;
    dev.expiresAt = now + TOKEN_TTL_MS;
    this.persist();
    return dev;
  }
  /** 生成一次性/限时临时密码（REQ-003），默认 10 分钟 */
  issueTemporaryPassword(ttlMs = 10 * 6e4) {
    const password = generatePassword();
    this.state.tempPasswords = this.state.tempPasswords.filter((p) => p.expiresAt > Date.now());
    this.state.tempPasswords.push({ password, expiresAt: Date.now() + ttlMs });
    this.persist();
    return password;
  }
  /** 消费临时密码：一次性，用过即焚（REQ-003） */
  consumeTemporaryPassword(password) {
    const idx = this.state.tempPasswords.findIndex((p) => p.password === password && p.expiresAt > Date.now());
    if (idx < 0) return false;
    this.state.tempPasswords.splice(idx, 1);
    this.persist();
    return true;
  }
  /** 签发短 TTL 临时 token（临时密码绑定所得），默认 12 小时 */
  issueTemporaryToken(deviceId, ttlMs = 12 * 36e5) {
    const token = randomBytes2(32).toString("base64url");
    this.state.tempTokens = this.state.tempTokens.filter((t) => t.expiresAt > Date.now() && !t.used);
    this.state.tempTokens.push({ digest: digest(token), deviceId, expiresAt: Date.now() + ttlMs, used: false });
    this.persist();
    return token;
  }
  /** 查找临时 token（验证一次有效，不消费） */
  findTemporaryToken(token) {
    const d = digest(token);
    const t = this.state.tempTokens.find((x) => x.digest === d && !x.used && x.expiresAt > Date.now());
    return t ? { deviceId: t.deviceId } : void 0;
  }
  revokeDevice(deviceId) {
    const dev = this.state.devices.find((d) => d.deviceId === deviceId);
    if (dev) {
      dev.revoked = true;
      this.persist();
    }
  }
  audit(deviceId, method, ok2) {
    this.state.audit.push({ at: Date.now(), deviceId, method, ok: ok2 });
    if (this.state.audit.length > 1e3) this.state.audit = this.state.audit.slice(-1e3);
    this.persist();
  }
};

// src/verifier.ts
var MAX_FAILS = 5;
var LOCK_MS = 5 * 6e4;
var FailCounter = class {
  counts = /* @__PURE__ */ new Map();
  allowed(key) {
    const e = this.counts.get(key);
    if (e && e.lockedUntil > Date.now()) return false;
    return true;
  }
  recordFail(key) {
    const e = this.counts.get(key) ?? { fails: 0, lockedUntil: 0 };
    e.fails += 1;
    if (e.fails >= MAX_FAILS) {
      e.fails = 0;
      e.lockedUntil = Date.now() + LOCK_MS;
    }
    this.counts.set(key, e);
  }
  recordSuccess(key) {
    this.counts.delete(key);
  }
};
var PasswordVerifier = class {
  constructor(store) {
    this.store = store;
  }
  fails = new FailCounter();
  /** 绑定流程专用：验长期密码，成功返回 true */
  checkPassword(password, clientKey = "") {
    if (!this.fails.allowed(clientKey)) return false;
    if (password === this.store.longPassword) {
      this.fails.recordSuccess(clientKey);
      return true;
    }
    this.fails.recordFail(clientKey);
    return false;
  }
  /** 绑定流程专用：消费一次性/限时临时密码（REQ-003） */
  checkTemporaryPassword(password, clientKey = "") {
    if (!this.fails.allowed(clientKey)) return false;
    if (this.store.consumeTemporaryPassword(password)) {
      this.fails.recordSuccess(clientKey);
      return true;
    }
    this.fails.recordFail(clientKey);
    return false;
  }
  async verify(request) {
    const header = request.header ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length);
    const device = this.store.findDeviceByToken(token);
    if (device) return device.deviceId;
    const temp = this.store.findTemporaryToken(token);
    return temp ? temp.deviceId : null;
  }
};

// src/events.ts
var EventHub = class {
  constructor(keepLast = 200) {
    this.keepLast = keepLast;
    this.timer = setInterval(() => this.push("hello", { at: Date.now() }), 15e3);
    this.timer.unref();
  }
  seq = 0;
  subscribers = /* @__PURE__ */ new Set();
  history = [];
  timer;
  push(type, payload) {
    const frame = { v: 1, seq: ++this.seq, type, payload };
    this.history.push(frame);
    if (this.history.length > this.keepLast) this.history = this.history.slice(-this.keepLast);
    const data = `data: ${JSON.stringify(frame)}

`;
    for (const res of this.subscribers) res.write(data);
  }
  replay(since) {
    return this.history.filter((f) => f.seq > since);
  }
  subscribe(_req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    res.write("retry: 3000\n\n");
    for (const frame of this.history) res.write(`data: ${JSON.stringify(frame)}

`);
    this.subscribers.add(res);
    res.on("close", () => this.subscribers.delete(res));
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    for (const res of this.subscribers) res.end();
    this.subscribers.clear();
  }
};

// src/routes.ts
import { createServer } from "node:http";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
var PUBLIC_METHODS = /* @__PURE__ */ new Set(["device.handshake", "device.bind", "device.bindTemporary"]);
function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
function ok(res, rpcId, data) {
  json(res, 200, { v: PROTOCOL_VERSION, rpcId, ok: true, data });
}
function fail(res, rpcId, code, message) {
  json(res, 200, { v: PROTOCOL_VERSION, rpcId, ok: false, error: { code, message } });
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body-too-large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function verifyNonceSignature(jwk, nonce, signatureB64) {
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const data = Buffer.from(nonce, "utf8");
    const sig = Buffer.from(signatureB64, "base64");
    if (cryptoVerify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, sig)) return true;
    return cryptoVerify("sha256", data, key, sig);
  } catch {
    return false;
  }
}
async function passThrough(res, rpcId, run) {
  try {
    const r = await run();
    if (r.result.ok) return ok(res, rpcId, r.result.value);
    return fail(res, rpcId, r.result.error.code, r.result.error.message);
  } catch (err) {
    return fail(res, rpcId, ERROR_CODES.serverError, err instanceof Error ? err.message.slice(0, 200) : "internal error");
  }
}
function makeRouter(deps) {
  const { store, verifier, apiProxy, hub, adapters, caps } = deps;
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (path === "/healthz") return json(res, 200, { ok: true });
    if (path === "/api/v1/events") return hub.subscribe(req, res);
    if (path === "/api/v1/poll") return json(res, 200, { events: hub.replay(Number(url.searchParams.get("since") ?? 0)) });
    if (path !== "/api/v1") return json(res, 404, { error: "not-found" });
    const method = url.searchParams.get("method") ?? "";
    let envelope = { v: PROTOCOL_VERSION, rpcId: "", method, payload: {} };
    if (req.method === "POST") {
      try {
        envelope = JSON.parse(await readBody(req));
      } catch {
        return fail(res, "", ERROR_CODES.badRequest, "invalid body");
      }
    }
    const rpcId = envelope.rpcId ?? "";
    const payload = envelope.payload ?? {};
    if (envelope.v !== PROTOCOL_VERSION) {
      return fail(res, rpcId, ERROR_CODES.badRequest, `unsupported version ${envelope.v}`);
    }
    let deviceId = "";
    if (!PUBLIC_METHODS.has(method)) {
      deviceId = await verifier.verify({ header: req.headers.authorization, method }) ?? "";
      if (!deviceId) {
        store.audit("unknown", method, false);
        return fail(res, rpcId, ERROR_CODES.authFailed, "invalid or revoked device token");
      }
    }
    store.audit(deviceId || "anonymous", method, true);
    try {
      switch (method) {
        case "device.handshake": {
          const p = payload;
          if (!p.deviceId || !DEVICE_ID_PATTERN.test(p.deviceId) || !p.publicKeyJwk) {
            return fail(res, rpcId, ERROR_CODES.badRequest, "invalid deviceId or key");
          }
          const nonce = store.addNonce(p.deviceId, p.publicKeyJwk);
          return ok(res, rpcId, { nonce, caps });
        }
        case "device.bind": {
          const p = payload;
          if (!p.deviceId || !p.password || !p.nonce || !p.nonceSignature) {
            return fail(res, rpcId, ERROR_CODES.badRequest, "missing fields");
          }
          const taken = store.takeNonce(p.nonce);
          if (!taken || taken.deviceId !== p.deviceId) {
            return fail(res, rpcId, ERROR_CODES.authFailed, "nonce missing, expired or mismatched");
          }
          if (!verifyNonceSignature(taken.publicKeyJwk, p.nonce, p.nonceSignature)) {
            const dbg = {
              nonceLen: p.nonce.length,
              sigLen: Buffer.from(p.nonceSignature, "base64").length,
              x: String(taken.publicKeyJwk.x).slice(0, 16),
              y: String(taken.publicKeyJwk.y).slice(0, 16),
              sigHex: Buffer.from(p.nonceSignature, "base64").subarray(0, 8).toString("hex")
            };
            console.error("[whalemaid-debug] bind verify fail", JSON.stringify(dbg));
            return fail(res, rpcId, ERROR_CODES.authFailed, "bad signature");
          }
          if (!verifier.checkPassword(p.password)) {
            return fail(res, rpcId, ERROR_CODES.authFailed, "bad password");
          }
          const token = store.issueToken(p.deviceId);
          store.bindPublicKey(p.deviceId, taken.publicKeyJwk);
          return ok(res, rpcId, { deviceToken: token });
        }
        case "device.bindTemporary": {
          const p = payload;
          if (!p.deviceId || !p.password) return fail(res, rpcId, ERROR_CODES.badRequest, "missing fields");
          if (!verifier.checkTemporaryPassword(p.password)) {
            return fail(res, rpcId, ERROR_CODES.authFailed, "bad or expired temporary password");
          }
          const token = store.issueTemporaryToken(p.deviceId);
          return ok(res, rpcId, { deviceToken: token, expiresAt: Date.now() + 12 * 36e5 });
        }
        case "session.list":
          return passThrough(res, rpcId, () => apiProxy.sessions.list({ rpcId, payload }));
        case "session.history":
          return passThrough(
            res,
            rpcId,
            () => apiProxy.sessions.history({ rpcId, payload })
          );
        case "session.create":
          return passThrough(
            res,
            rpcId,
            () => apiProxy.sessions.create({ rpcId, payload })
          );
        case "session.prompt": {
          const p = payload;
          if (!p.sessionId || typeof p.text !== "string") {
            return fail(res, rpcId, ERROR_CODES.badRequest, "sessionId/text required");
          }
          const text = p.visionNote ? `${p.text}

[\u56FE\u7247\u63CF\u8FF0] ${p.visionNote}` : p.text;
          return passThrough(
            res,
            rpcId,
            () => apiProxy.sessions.prompt({ rpcId, payload: { sessionId: p.sessionId, mode: "queue", content: [{ type: "text", text }] } })
          );
        }
        case "session.stop":
          return passThrough(res, rpcId, () => apiProxy.sessions.stop({ rpcId, payload }));
        case "session.models":
          return passThrough(res, rpcId, () => apiProxy.sessions.models({ rpcId, payload }));
        case "session.selectModel":
          return passThrough(
            res,
            rpcId,
            () => apiProxy.sessions.selectModel({ rpcId, payload })
          );
        case "permission.get": {
          const p = payload;
          if (!p.sessionId) return fail(res, rpcId, ERROR_CODES.badRequest, "sessionId required");
          const r = await apiProxy.sessions.history({ rpcId, payload: { sessionId: p.sessionId, maxMessages: 1 } });
          if (!r.result.ok) return fail(res, rpcId, r.result.error.code, r.result.error.message);
          const projections = r.result.value?.projections;
          return ok(res, rpcId, { permissions: projections?.["permissions"] ?? null });
        }
        case "permission.set": {
          const p = payload;
          if (!p.sessionId || typeof p.value !== "string") return fail(res, rpcId, ERROR_CODES.badRequest, "sessionId/value required");
          return passThrough(
            res,
            rpcId,
            () => apiProxy.sessions.prompt({ rpcId, payload: { sessionId: p.sessionId, mode: "queue", content: [{ type: "text", text: `/permission ${p.value}` }] } })
          );
        }
        case "workspace.list":
          return passThrough(res, rpcId, () => apiProxy.workspace.list({ rpcId, payload: {} }));
        case "workspace.create":
          return passThrough(
            res,
            rpcId,
            () => apiProxy.workspace.create({ rpcId, payload })
          );
        case "host.listDirectory": {
          const p = payload;
          if (p?.scope === "full") {
            return fail(res, rpcId, ERROR_CODES.scopeDenied, "full scope requires confirmation");
          }
          return passThrough(
            res,
            rpcId,
            () => apiProxy.host.listDirectory({ rpcId, payload: { path: p?.path } }, new AbortController().signal)
          );
        }
        case "host.createDirectory":
          return passThrough(
            res,
            rpcId,
            () => apiProxy.host.createDirectory({ rpcId, payload })
          );
        case "approval.respond": {
          const p = payload;
          if (!p.rpcId || !p.sessionId || !p.approvalId || p.outcome !== "allowed-once" && p.outcome !== "rejected") {
            return fail(res, rpcId, ERROR_CODES.badRequest, "rpcId/sessionId/approvalId/outcome required");
          }
          const receipt = await apiProxy.respond({
            type: "client-response",
            rpcId: p.rpcId,
            result: { ok: true, value: { sessionId: p.sessionId, approvalId: p.approvalId, outcome: p.outcome } }
          });
          return ok(res, rpcId, receipt);
        }
        case "voice.transcribe": {
          if (!adapters?.voice) return fail(res, rpcId, ERROR_CODES.capUnsupported, "voice BYOK \u672A\u914D\u7F6E\uFF08\u5BBF\u4E3B\u672A\u8BBE\u7F6E voiceProvider/\u51ED\u636E\uFF09");
          const p = payload;
          if (!p.audioBase64) return fail(res, rpcId, ERROR_CODES.badRequest, "audioBase64 required");
          const text = await adapters.voice.transcribe(Buffer.from(p.audioBase64, "base64"), p.format ?? "wav");
          return ok(res, rpcId, { text });
        }
        case "voice.hotwords.update":
          return fail(res, rpcId, ERROR_CODES.capUnsupported, "hotwords plugin not installed");
        case "vision.describe": {
          if (!adapters?.vision) return fail(res, rpcId, ERROR_CODES.capUnsupported, "vision BYOK \u672A\u914D\u7F6E\uFF08\u5BBF\u4E3B\u672A\u8BBE\u7F6E visionProvider/\u51ED\u636E\uFF09");
          const p = payload;
          if (!p.imageBase64) return fail(res, rpcId, ERROR_CODES.badRequest, "imageBase64 required");
          const text = await adapters.vision.describe(p.imageBase64, p.mime ?? "image/png");
          return ok(res, rpcId, { text });
        }
        default:
          return fail(res, rpcId, ERROR_CODES.methodUnknown, `unknown method: ${method}`);
      }
    } catch (err) {
      store.audit(deviceId || "unknown", method, false);
      return fail(res, rpcId, ERROR_CODES.serverError, err instanceof Error ? err.message.slice(0, 200) : "internal error");
    }
  };
}
function createWhalemaidServer(deps) {
  return createServer(makeRouter(deps)).listen(deps.port, deps.host);
}

// src/providers/voice.ts
function voiceProviderVerified(provider) {
  return provider !== VOICE_PROVIDERS.dashscope;
}
function requireKey(key, provider) {
  if (!key) throw new Error(`\u7F3A\u5C11 ${provider} \u51ED\u636E\uFF1A\u8BF7\u5728\u5BBF\u4E3B dsh-credentials \u914D\u7F6E\u5BF9\u5E94 API key`);
  return key;
}
function openAiCompatible(baseUrl, model, label, resolveKey) {
  return {
    async transcribe(audio, format) {
      const key = requireKey(await resolveKey(), label);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)]), `audio.${format === "pcm" ? "wav" : format}`);
      form.append("model", model);
      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form
      });
      if (!res.ok) throw new Error(`${label} \u8F6C\u5199\u5931\u8D25: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return data.text ?? "";
    }
  };
}
function dashscopeAdapter(model, resolveKey) {
  return {
    async transcribe(_audio, _format) {
      throw new Error(`dashscope(${model}) \u5F55\u97F3\u6587\u4EF6\u8BC6\u522B\u5F85\u771F\u5B9E key \u5B9E\u6D4B\uFF08\u9700\u53EF\u8BBF\u95EE\u7684\u6587\u4EF6 URL\uFF09`);
    }
  };
}
function createVoiceAdapter(cfg, resolveKey) {
  switch (cfg.provider) {
    case VOICE_PROVIDERS.openai:
      return openAiCompatible(cfg.baseUrl ?? "https://api.openai.com/v1", cfg.model ?? "whisper-1", "openai", resolveKey);
    case VOICE_PROVIDERS.groq:
      return openAiCompatible(cfg.baseUrl ?? "https://api.groq.com/openai/v1", cfg.model ?? "whisper-large-v3", "groq", resolveKey);
    case VOICE_PROVIDERS.dashscope:
      return dashscopeAdapter(cfg.model ?? "paraformer-v2", resolveKey);
    case VOICE_PROVIDERS.iflytek:
    default:
      throw new Error(`\u8BED\u97F3\u5382\u5546\u672A\u5B9E\u73B0: ${cfg.provider}`);
  }
}

// src/providers/vision.ts
function requireKey2(key, provider) {
  if (!key) throw new Error(`\u7F3A\u5C11 ${provider} \u51ED\u636E\uFF1A\u8BF7\u5728\u5BBF\u4E3B dsh-credentials \u914D\u7F6E\u5BF9\u5E94 API key`);
  return key;
}
var OCR_PROMPT = "\u8BF7\u8BC6\u522B\u8FD9\u5F20\u56FE\u7247\uFF1A\u5148\u505A\u5B8C\u6574 OCR \u8F6C\u5199\uFF0C\u518D\u7528\u4E00\u4E24\u53E5\u8BDD\u63CF\u8FF0\u56FE\u7247\u5185\u5BB9\u3002\u53EA\u8F93\u51FA\u8BC6\u522B\u7ED3\u679C\uFF0C\u4E0D\u8981\u89E3\u91CA\u3002";
function openAiCompatibleVision(baseUrl, model, label, resolveKey) {
  return {
    async describe(imageBase64, mime) {
      const key = requireKey2(await resolveKey(), label);
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: OCR_PROMPT },
                { type: "image_url", image_url: { url: `data:${mime ?? "image/png"};base64,${imageBase64}` } }
              ]
            }
          ],
          max_tokens: 1024
        })
      });
      if (!res.ok) throw new Error(`${label} \u89C6\u89C9\u5931\u8D25: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === "string") return content;
      const parts = Array.isArray(content) ? content.map((p) => typeof p === "object" && p !== null && "text" in p ? p.text : "").filter(Boolean) : [];
      return parts.join("\n");
    }
  };
}
function geminiAdapter(model, resolveKey) {
  return {
    async describe(imageBase64, mime) {
      const key = requireKey2(await resolveKey(), "gemini");
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: OCR_PROMPT },
                { inline_data: { mime_type: mime ?? "image/png", data: imageBase64 } }
              ]
            }
          ]
        })
      });
      if (!res.ok) throw new Error(`gemini \u89C6\u89C9\u5931\u8D25: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
    }
  };
}
function createVisionAdapter(cfg, resolveKey) {
  switch (cfg.provider) {
    case VISION_PROVIDERS.deepseekOcr:
      return openAiCompatibleVision(cfg.baseUrl ?? "https://api.deepseek.com/v1", cfg.model ?? "deepseek-ocr", "deepseek-ocr", resolveKey);
    case VISION_PROVIDERS.qwenVl:
      return openAiCompatibleVision(cfg.baseUrl ?? "https://dashscope.aliyuncs.com/compatible-mode/v1", cfg.model ?? "qwen-vl-max", "qwen-vl", resolveKey);
    case VISION_PROVIDERS.openai:
      return openAiCompatibleVision(cfg.baseUrl ?? "https://api.openai.com/v1", cfg.model ?? "gpt-5.6", "openai", resolveKey);
    case VISION_PROVIDERS.grok:
      return openAiCompatibleVision(cfg.baseUrl ?? "https://api.x.ai/v1", cfg.model ?? "grok-2-vision", "grok", resolveKey);
    case VISION_PROVIDERS.gemini:
      return geminiAdapter(cfg.model ?? "gemini-2.5-flash", resolveKey);
    default:
      throw new Error(`\u89C6\u89C9\u5382\u5546\u672A\u5B9E\u73B0: ${cfg.provider}`);
  }
}

// src/relay.ts
import { spawn } from "node:child_process";
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { randomBytes as randomBytes3, scryptSync, createHash as createHash2 } from "node:crypto";
import https from "node:https";
function phcScrypt(password, salt = randomBytes3(16)) {
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const b64 = (b) => b.toString("base64").replace(/=+$/, "");
  return `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(hash)}`;
}
function pinnedRequest(url, options) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: options.method, headers: options.headers, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode ?? 0,
          json: async () => JSON.parse(text),
          text: async () => text
        });
      });
    });
    req.on("socket", (socket) => {
      socket.on("secureConnect", () => {
        const tlsSocket = socket;
        const cert = tlsSocket.getPeerCertificate(true);
        const fp = createHash2("sha256").update(cert.raw ?? Buffer.alloc(0)).digest("hex");
        if (options.fingerprint && fp !== options.fingerprint.replace(/[^0-9a-f]/gi, "")) {
          req.destroy(new Error(`\u8BC1\u4E66\u6307\u7EB9\u4E0D\u5339\u914D\uFF08\u9884\u671F ${options.fingerprint.slice(0, 16)}\u2026 \u5B9E\u9645 ${fp.slice(0, 16)}\u2026\uFF09\uFF0C\u62D2\u7EDD\u8FDE\u63A5\uFF08SEC-001 \u9632\u4E2D\u95F4\u4EBA\uFF09`));
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
var RelayClient = class {
  constructor(cfg, log) {
    this.cfg = cfg;
    this.log = log;
  }
  child = null;
  timer;
  async start() {
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    let credential = this.cfg.savedCredential;
    if (credential) {
      try {
        const binding2 = await this.establishTunnel(base, credential);
        this.startHeartbeat(base, credential);
        return binding2;
      } catch (e) {
        this.log(`[whalemaid] \u51ED\u636E\u5931\u6548\uFF08${e instanceof Error ? e.message.slice(0, 60) : String(e)}\uFF09\uFF0C\u91CD\u65B0\u6CE8\u518C`);
        this.cfg.onCredential("");
        credential = "";
      }
    }
    const res = await pinnedRequest(`${base}/_whalemaid/devices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-install-code": this.cfg.relayInstallCode
      },
      body: JSON.stringify({ deviceId: this.cfg.deviceId, passwordDigest: phcScrypt(this.cfg.longPassword) }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) throw new Error(`\u6CE8\u518C\u5931\u8D25: ${res.status} ${await res.text()}`);
    const reg = await res.json();
    credential = reg.credential;
    this.cfg.onCredential(credential);
    const binding = await this.establishTunnel(base, credential);
    this.startHeartbeat(base, credential);
    return binding;
  }
  startHeartbeat(base, credential) {
    this.timer = setInterval(() => {
      pinnedRequest(`${base}/_whalemaid/devices/${this.cfg.deviceId}/heartbeat`, {
        method: "POST",
        headers: { authorization: `Bearer ${credential}` },
        fingerprint: this.cfg.relayFingerprint
      }).catch(() => void 0);
    }, 2e4);
    this.timer.unref();
  }
  async establishTunnel(base, credential) {
    const res = await pinnedRequest(`${base}/_whalemaid/devices/${this.cfg.deviceId}/tunnel`, {
      method: "POST",
      headers: { authorization: `Bearer ${credential}` },
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) throw new Error(`\u96A7\u9053\u7B7E\u53D1\u5931\u8D25: ${res.status} ${await res.text()}`);
    const binding = await res.json();
    if (!binding.serverPublicKey) {
      throw new Error("\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE rathole noise \u516C\u94A5\uFF08serverPublicKey\uFF09\uFF0C\u62D2\u7EDD\u5EFA\u7ACB\u96A7\u9053\uFF08SEC-001/003\uFF09");
    }
    const host = new URL(base).hostname;
    const cfgText = [
      "[client]",
      `remote_addr = "${host}:${this.cfg.relayPort}"`,
      "",
      "[client.transport]",
      'type = "noise"',
      "[client.transport.noise]",
      // NK 模式：固定服务端公钥（与中继持久化静态密钥对配套，防中间人；rathole 默认 transport 是 TCP 明文，必须显式 noise）
      `remote_public_key = "${binding.serverPublicKey}"`,
      "",
      `[client.services.${binding.service}]`,
      `token = "${binding.tunnelToken}"`,
      `local_addr = "127.0.0.1:${this.cfg.pluginPort}"`,
      ""
    ].join("\n");
    const dir = join2(this.cfg.dataDir, "relay");
    mkdirSync2(dir, { recursive: true });
    const cfgFile = join2(dir, "rathole-client.toml");
    writeFileSync2(cfgFile, cfgText, { mode: 384 });
    let backoffMs = 1e3;
    const spawnClient = () => {
      this.child = spawn(this.cfg.ratholeBin, [cfgFile], { stdio: "ignore" });
      this.child.on("exit", (code) => {
        this.log(`[whalemaid] rathole \u5BA2\u6237\u7AEF\u9000\u51FA code=${code}\uFF0C${backoffMs}ms \u540E\u91CD\u8FDE\uFF08UX-012\uFF09`);
        if (!this.stopped) {
          setTimeout(spawnClient, backoffMs).unref();
          backoffMs = Math.min(backoffMs * 2, 3e4);
        }
      });
      setTimeout(() => {
        backoffMs = 1e3;
      }, 6e4).unref();
    };
    spawnClient();
    return binding;
  }
  stopped = false;
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.child?.kill();
    this.child = null;
  }
};

// src/config.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  host: Schema.string().default("127.0.0.1"),
  port: Schema.number().default(3180),
  dataDir: Schema.string().default(""),
  voiceProvider: Schema.string().default(""),
  voiceCredentialRef: Schema.string().default(""),
  voiceModel: Schema.string().default(""),
  visionProvider: Schema.string().default(""),
  visionCredentialRef: Schema.string().default(""),
  visionModel: Schema.string().default(""),
  relayUrl: Schema.string().default(""),
  relayInstallCode: Schema.string().default(""),
  relayFingerprint: Schema.string().default(""),
  ratholeBin: Schema.string().default("rathole"),
  relayPort: Schema.number().default(2333),
  allowPlainLan: Schema.boolean().default(false)
});

// src/index.ts
var name = "whalemaid";
var inject = ["apiProxy", "credentials", "webServer"];
var DEFAULTS = {
  host: "127.0.0.1",
  port: 3180,
  dataDir: "",
  voiceProvider: "",
  voiceCredentialRef: "",
  voiceModel: "",
  visionProvider: "",
  visionCredentialRef: "",
  visionModel: "",
  relayUrl: "",
  relayInstallCode: "",
  relayFingerprint: "",
  relayPort: 2333,
  ratholeBin: "rathole",
  allowPlainLan: false
};
function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...config };
  const store = new Store(resolved.dataDir);
  const verifier = new PasswordVerifier(store);
  const hub = new EventHub();
  const apiProxy = ctx.apiProxy;
  const credentials = ctx.credentials;
  const hostWeb = ctx.webServer;
  const keyResolver = async (ref) => {
    if (!ref) return void 0;
    const hit = await credentials.resolve(credentialRef(ref));
    return hit?.value;
  };
  const voiceCfg = resolved.voiceProvider ? { provider: resolved.voiceProvider, credentialRef: resolved.voiceCredentialRef, model: resolved.voiceModel || void 0 } : void 0;
  const visionCfg = resolved.visionProvider ? { provider: resolved.visionProvider, credentialRef: resolved.visionCredentialRef, model: resolved.visionModel || void 0 } : void 0;
  const adapters = {
    voice: voiceCfg ? createVoiceAdapter(voiceCfg, () => keyResolver(voiceCfg.credentialRef ?? "")) : void 0,
    vision: visionCfg ? createVisionAdapter(visionCfg, () => keyResolver(visionCfg.credentialRef ?? "")) : void 0
  };
  const caps = [
    CAPABILITIES.session,
    CAPABILITIES.workspaceCreate,
    CAPABILITIES.directoryBrowse,
    CAPABILITIES.direct,
    // audit#7：只有真实可用的 provider 才广播能力位（dashscope 未经真实 key 验收，不广播）
    ...adapters.voice && voiceProviderVerified(resolved.voiceProvider) ? [CAPABILITIES.voiceByok] : [],
    ...adapters.vision ? [CAPABILITIES.visionByok] : []
  ];
  const lanBlocked = resolved.host !== "127.0.0.1" && !resolved.allowPlainLan;
  if (lanBlocked) {
    ctx.logger.error(`[whalemaid] \u62D2\u7EDD\u4EE5\u660E\u6587\u7ED1\u5B9A ${resolved.host}:${resolved.port}\uFF08SEC-005\uFF09\uFF1A\u975E\u56DE\u73AF\u76D1\u542C\u9700\u663E\u5F0F allowPlainLan=true\uFF0C\u6216\u4F7F\u7528\u4E2D\u7EE7\uFF08relayUrl\uFF09`);
    return;
  }
  const server = createWhalemaidServer({ store, verifier, apiProxy, hub, adapters, caps, host: resolved.host, port: resolved.port });
  ctx.logger.info(
    `[whalemaid] \u76D1\u542C http://${resolved.host}:${resolved.port} \uFF08\u8BBE\u5907 ID \u4E0E\u957F\u671F\u5BC6\u7801\u89C1 ${store.file}\uFF1B\u8BED\u97F3=${voiceCfg?.provider ?? "\u672A\u542F\u7528"} \u89C6\u89C9=${visionCfg?.provider ?? "\u672A\u542F\u7528"}\uFF09`
  );
  const bridge = ctx;
  try {
    bridge.on("host/session-status", (sessionId, status) => {
      const s = typeof status === "object" && status !== null ? status : void 0;
      hub.push("turn-status", {
        sessionId: String(sessionId),
        status: s?.running ? "running" : "done"
      });
    });
  } catch {
    ctx.logger.warn("[whalemaid] SSE \u4E8B\u4EF6\u6865\u6682\u4E0D\u53EF\u7528\uFF08\u4E8B\u4EF6\u540D\u672A\u5728\u5BBF\u4E3B\u8F6C\u53D1\u5217\u8868\u4E2D\uFF09");
  }
  if (resolved.relayUrl && !resolved.relayFingerprint) {
    ctx.logger.error("[whalemaid] \u914D\u7F6E\u4E86 relayUrl \u4F46\u7F3A\u5C11 relayFingerprint\uFF1A\u62D2\u7EDD\u63A5\u5165\u4E2D\u7EE7\uFF08SEC-001\uFF0C\u9632\u4E2D\u95F4\u4EBA\uFF09\u2014\u2014\u6307\u7EB9\u89C1\u670D\u52A1\u7AEF\u542F\u52A8\u65E5\u5FD7");
  }
  const relay = resolved.relayUrl && resolved.relayFingerprint ? new RelayClient(
    {
      relayUrl: resolved.relayUrl,
      relayInstallCode: resolved.relayInstallCode,
      relayFingerprint: resolved.relayFingerprint,
      ratholeBin: resolved.ratholeBin,
      relayPort: resolved.relayPort,
      // 隧道目标 = 宿主原生 web 端口（官方 /api+WS+UI；127.0.0.1 默认安全姿态）；无宿主 web 时退回自建网关（过渡态）
      pluginPort: hostWeb?.port ?? resolved.port,
      dataDir: store.file.replace(/store\.json$/, ""),
      deviceId: store.deviceId,
      longPassword: store.longPassword,
      savedCredential: store.relayCredential,
      onCredential: (c) => store.setRelayCredential(c)
    },
    (msg) => ctx.logger.info(msg)
  ) : null;
  if (relay) {
    let attempt = 0;
    const tryStart = async () => {
      try {
        const b = await relay.start();
        ctx.logger.info(`[whalemaid] \u4E2D\u7EE7\u5DF2\u63A5\u5165 device=${store.deviceId} target=${hostWeb?.port ? `\u5BBF\u4E3B\u539F\u751Fweb:${hostWeb.port}` : `\u81EA\u5EFA\u7F51\u5173:${resolved.port}`}\uFF08\u4E3B\u63A7\u7AEF\u7528\u8BBE\u5907\u7F16\u53F7+\u5BC6\u7801\u8FDE\u63A5\uFF0C\u65E0\u9700 IP\uFF09`);
      } catch (e) {
        attempt += 1;
        const delay = Math.min(2e3 * 2 ** attempt, 6e4);
        ctx.logger.warn(`[whalemaid] \u4E2D\u7EE7\u63A5\u5165\u5931\u8D25\uFF08\u7B2C ${attempt} \u6B21\uFF09: ${e instanceof Error ? e.message : String(e)}\uFF1B${Math.round(delay / 1e3)}s \u540E\u91CD\u8BD5`);
        setTimeout(tryStart, delay).unref();
      }
    };
    void tryStart();
  }
  const muxCtl = new AbortController();
  void (async () => {
    try {
      const mux = apiProxy.events?.mux;
      if (!mux) {
        ctx.logger.warn("[whalemaid] mux \u4E0D\u53EF\u7528\uFF0C\u5BA1\u6279\u8F6C\u53D1\u505C\u7528");
        return;
      }
      for await (const frame of mux({ rpcId: "whalemaid-mux", payload: {} }, muxCtl.signal)) {
        const f = frame.payload;
        if (f.type === "approval/requested") {
          hub.push("permission-request", {
            sessionId: f.sessionId,
            rpcId: frame.rpcId,
            approvalId: f.approvalId,
            toolName: f.toolName,
            callId: f.callId,
            reason: f.reason
          });
        } else if (f.type === "approval/resolved") {
          hub.push("permission-resolved", { sessionId: f.sessionId, approvalId: f.approvalId, outcome: f.outcome });
        } else if (f.type === "session/event") {
          const ev = f.event;
          if (ev?.type === "turn/start") hub.push("turn-status", { sessionId: f.sessionId, status: "running" });
          else if (ev?.type === "turn/end") hub.push("turn-status", { sessionId: f.sessionId, status: "done" });
        }
      }
    } catch (e) {
      ctx.logger.warn(`[whalemaid] mux \u6D88\u8D39\u4E2D\u65AD: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
  ctx.effect(() => () => {
    muxCtl.abort();
    relay?.stop();
    hub.dispose();
    server.close();
  });
}
export {
  Config,
  apply,
  inject,
  name
};
