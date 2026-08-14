// src/store.ts
import { createHash, randomBytes as randomBytes2 } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// src/device.ts
import { randomBytes } from "node:crypto";
function generatePassword() {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

// src/store.ts
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
      pendingNonces: {},
      devices: [],
      tempTokens: [],
      tempPasswords: [],
      audit: []
    };
    this.state.tempPasswords ??= [];
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
  issueToken(deviceId) {
    const token = randomBytes2(32).toString("base64url");
    this.state.devices.push({
      deviceId,
      publicKeyJwk: {},
      // bind 时由路由回填
      tokenDigest: digest(token),
      createdAt: Date.now(),
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
  findDeviceByToken(token) {
    const d = digest(token);
    return this.state.devices.find((x) => x.tokenDigest === d && !x.revoked);
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

// src/routes.ts
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
    return cryptoVerify(
      "sha256",
      Buffer.from(nonce, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signatureB64, "base64")
    );
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
  const { store, verifier, apiProxy, hub } = deps;
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (path === "/healthz") return json(res, 200, { ok: true });
    if (path === "/api/v1/events") return hub.subscribe(req, res);
    if (path === "/api/v1/poll") return json(res, 200, { events: hub.replay(Number(url.searchParams.get("since") ?? 0)) });
    if (path === "/m") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end('<!doctype html><meta charset="utf-8"><title>WhaleMaid</title><h1>WhaleMaid \u79FB\u52A8\u7AEF\u6784\u5EFA\u4E2D</h1>');
    }
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
    if (!PUBLIC_METHODS.has(method)) {
      const deviceId = await verifier.verify({ header: req.headers.authorization, method });
      if (!deviceId) {
        store.audit("unknown", method, false);
        return fail(res, rpcId, ERROR_CODES.authFailed, "invalid or revoked device token");
      }
    }
    store.audit("n/a", method, true);
    try {
      switch (method) {
        case "device.handshake": {
          const p = payload;
          if (!p.deviceId || !DEVICE_ID_PATTERN.test(p.deviceId) || !p.publicKeyJwk) {
            return fail(res, rpcId, ERROR_CODES.badRequest, "invalid deviceId or key");
          }
          const nonce = store.addNonce(p.deviceId, p.publicKeyJwk);
          return ok(res, rpcId, {
            nonce,
            caps: [CAPABILITIES.session, CAPABILITIES.workspaceCreate, CAPABILITIES.directoryBrowse, CAPABILITIES.direct]
          });
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
        case "voice.transcribe":
        case "voice.hotwords.update":
        case "vision.describe":
          return fail(res, rpcId, ERROR_CODES.capUnsupported, "not implemented yet");
        default:
          return fail(res, rpcId, ERROR_CODES.methodUnknown, `unknown method: ${method}`);
      }
    } catch (err) {
      store.audit("n/a", method, false);
      return fail(res, rpcId, ERROR_CODES.serverError, err instanceof Error ? err.message.slice(0, 200) : "internal error");
    }
  };
}
function createWhalemaidServer(deps) {
  return createServer(makeRouter(deps)).listen(deps.port, deps.host);
}

// src/config.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  host: Schema.string().default("127.0.0.1"),
  port: Schema.number().default(3180),
  dataDir: Schema.string().default("")
});

// src/index.ts
var name = "whalemaid";
var inject = ["apiProxy"];
var DEFAULTS = { host: "127.0.0.1", port: 3180, dataDir: "" };
function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...config };
  const store = new Store(resolved.dataDir);
  const verifier = new PasswordVerifier(store);
  const hub = new EventHub();
  const apiProxy = ctx.apiProxy;
  const server = createWhalemaidServer({ store, verifier, apiProxy, hub, host: resolved.host, port: resolved.port });
  ctx.logger.info(
    `[whalemaid] \u76D1\u542C http://${resolved.host}:${resolved.port} \uFF08\u8BBE\u5907 ID \u4E0E\u957F\u671F\u5BC6\u7801\u89C1 ${store.file}\uFF09`
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
  ctx.effect(() => () => {
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
