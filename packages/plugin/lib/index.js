// src/store.ts
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { randomBytes as randomBytes2 } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lockSync } from "proper-lockfile";

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
function generateTemporaryPassword() {
  const raw = base32(randomBytes(8), [4, 4]);
  return `WMT-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

// src/store.ts
var EMPTY_TEMPORARY_PASSWORD = {
  password: "",
  expiresAt: 0,
  generation: 0,
  state: "none"
};
function resolveDataDir(options) {
  if (options.dataDir) return options.dataDir;
  if (!options.profileBaseUrl) {
    throw new Error("WhaleMaid \u8EAB\u4EFD\u7F3A\u5C11 profileBaseUrl\uFF1A\u62D2\u7EDD\u56DE\u9000\u5230\u5171\u4EAB DSH_HOME\uFF1B\u8BF7\u7531 DSH loader \u63D0\u4F9B ctx.baseUrl \u6216\u663E\u5F0F\u914D\u7F6E dataDir");
  }
  const profileUrl = options.profileBaseUrl instanceof URL ? options.profileBaseUrl : new URL(options.profileBaseUrl);
  if (profileUrl.protocol !== "file:") {
    throw new Error(`WhaleMaid profileBaseUrl \u5FC5\u987B\u662F file: URL\uFF0C\u6536\u5230 ${profileUrl.protocol}`);
  }
  return join(fileURLToPath(profileUrl), "whalemaid");
}
var processLeases = /* @__PURE__ */ new Map();
var LOCK_STALE_MS = 3e4;
var LOCK_UPDATE_MS = 1e4;
function claimProfile(stateFile) {
  const active = processLeases.get(stateFile);
  if (active) {
    active.refs += 1;
  } else {
    let release;
    try {
      release = lockSync(stateFile, {
        realpath: false,
        stale: LOCK_STALE_MS,
        update: LOCK_UPDATE_MS,
        onCompromised: (cause) => {
          throw new Error(`WhaleMaid profile owner \u9501\u5DF2\u635F\u574F\uFF1A${stateFile}`, { cause });
        }
      });
    } catch (cause) {
      throw new Error(`WhaleMaid profile \u5DF2\u7531\u53E6\u4E00\u4E2A DSH \u8FDB\u7A0B\u63A7\u5236\uFF0C\u62D2\u7EDD\u8BA9\u540C\u4E00\u8BBE\u5907\u8EAB\u4EFD\u8DEF\u7531\u5230\u591A\u4E2A\u5BBF\u4E3B\uFF1A${stateFile}`, { cause });
    }
    processLeases.set(stateFile, { refs: 1, release });
  }
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const lease = processLeases.get(stateFile);
    if (!lease) return;
    lease.refs -= 1;
    if (lease.refs === 0) {
      processLeases.delete(stateFile);
      lease.release();
    }
  };
}
var Store = class {
  state;
  path;
  releaseProfile;
  constructor(options) {
    const requestedBase = resolveDataDir(options);
    mkdirSync(requestedBase, { recursive: true });
    const base = realpathSync(requestedBase);
    this.path = join(base, "store.json");
    this.releaseProfile = claimProfile(this.path);
    try {
      this.state = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : {
        longPassword: generatePassword(),
        deviceId: generateDeviceId(),
        relayCredential: "",
        adminToken: randomBytes2(16).toString("hex"),
        temporaryPassword: { ...EMPTY_TEMPORARY_PASSWORD }
      };
      this.state.relayCredential ??= "";
      this.state.adminToken ??= randomBytes2(16).toString("hex");
      this.state.deviceId ??= generateDeviceId();
      this.state.longPassword ??= generatePassword();
      this.state.temporaryPassword ??= { ...EMPTY_TEMPORARY_PASSWORD };
      this.persist();
    } catch (cause) {
      this.releaseProfile();
      throw cause;
    }
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
  /** UX-002：受控端设备编号（受控端 UI 展示；主控端凭此+密码连接） */
  get deviceId() {
    return this.state.deviceId;
  }
  get relayCredential() {
    return this.state.relayCredential;
  }
  get adminToken() {
    return this.state.adminToken;
  }
  setRelayCredential(value) {
    this.state.relayCredential = value;
    this.persist();
  }
  get temporaryPassword() {
    return { ...this.state.temporaryPassword };
  }
  setTemporaryPassword(value) {
    this.state.temporaryPassword = { ...value };
    this.persist();
  }
  /** 心跳可能晚于 refresh 返回；旧 generation 不得清除新密码。 */
  syncTemporaryPasswordStatus(status) {
    const current = this.state.temporaryPassword;
    if (status.generation < current.generation) return;
    const keepPassword = status.state === "active" && status.generation === current.generation;
    this.state.temporaryPassword = {
      password: keepPassword ? current.password : "",
      ...status
    };
    this.persist();
  }
  /** DSH plugin disposal：最后一个同进程 HMR owner 释放跨进程 profile 锁。 */
  close() {
    this.releaseProfile();
  }
  /** REQ-002：重新生成长期密码 = 清凭据触发重新注册（旧密码哈希随注册更新即失效） */
  rotatePassword() {
    this.state.longPassword = generatePassword();
    this.state.relayCredential = "";
    this.persist();
    return this.state.longPassword;
  }
};

// src/relay.ts
import { spawn } from "node:child_process";
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { randomBytes as randomBytes3, scryptSync, createHash } from "node:crypto";
import https from "node:https";
function phcScrypt(password, salt = randomBytes3(16)) {
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const b64 = (b) => b.toString("base64").replace(/=+$/, "");
  return `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(hash)}`;
}
var RelayHttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "RelayHttpError";
  }
};
var CREDENTIAL_REJECTED = [401, 403, 404];
function normalizeFingerprint(value) {
  return value.replace(/[^0-9a-f]/gi, "").toLowerCase();
}
function pinnedRequest(url, options) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0 });
    let verified = false;
    const req = https.request(url, {
      method: options.method,
      headers: options.headers,
      rejectUnauthorized: false,
      agent
    }, (res) => {
      if (!verified) {
        res.destroy();
        req.destroy(new Error("\u65E0\u6CD5\u9A8C\u8BC1\u4E2D\u7EE7\u8BC1\u4E66\uFF0C\u62D2\u7EDD\u8FDE\u63A5\uFF08SEC-001 \u9632\u4E2D\u95F4\u4EBA\uFF09"));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        agent.destroy();
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode ?? 0,
          json: async () => JSON.parse(text),
          text: async () => text
        });
      });
    });
    req.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        const tlsSocket = socket;
        const raw = tlsSocket.getPeerCertificate(true).raw;
        if (!raw?.length) {
          req.destroy(new Error("\u4E2D\u7EE7\u672A\u63D0\u4F9B\u53EF\u56FA\u5B9A\u7684\u5B8C\u6574\u8BC1\u4E66\uFF0C\u62D2\u7EDD\u8FDE\u63A5\uFF08SEC-001 \u9632\u4E2D\u95F4\u4EBA\uFF09"));
          return;
        }
        const actual = createHash("sha256").update(raw).digest("hex");
        const expected = normalizeFingerprint(options.fingerprint);
        if (!expected || actual !== expected) {
          req.destroy(new Error(`\u8BC1\u4E66\u6307\u7EB9\u4E0D\u5339\u914D\uFF08\u9884\u671F ${options.fingerprint.slice(0, 16)}\u2026 \u5B9E\u9645 ${actual.slice(0, 16)}\u2026\uFF09\uFF0C\u62D2\u7EDD\u8FDE\u63A5\uFF08SEC-001 \u9632\u4E2D\u95F4\u4EBA\uFF09`));
          return;
        }
        verified = true;
      });
    });
    req.on("error", (error) => {
      agent.destroy();
      reject(error);
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}
var RelayClient = class {
  constructor(cfg, log, req = pinnedRequest) {
    this.cfg = cfg;
    this.log = log;
    this.req = req;
  }
  child = null;
  timer;
  updateCredential(credential) {
    this.cfg.savedCredential = credential;
    this.cfg.onCredential(credential);
  }
  requireCredential() {
    if (!this.cfg.savedCredential) throw new Error("\u8BBE\u5907\u5C1A\u65E0\u4E2D\u7EE7\u51ED\u636E\uFF0C\u4E0D\u80FD\u7BA1\u7406\u4E34\u65F6\u5BC6\u7801\uFF1B\u8BF7\u7B49\u5F85\u9996\u6B21\u6CE8\u518C\u6210\u529F");
    return this.cfg.savedCredential;
  }
  async issueTemporaryPassword(password, ttlSec) {
    const credential = this.requireCredential();
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/temporary-password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
      body: JSON.stringify({ passwordDigest: phcScrypt(password), ttlSec }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) throw new RelayHttpError(res.status, `\u4E34\u65F6\u5BC6\u7801\u7B7E\u53D1\u5931\u8D25: ${res.status} ${await res.text()}`);
    return await res.json();
  }
  async revokeTemporaryPassword() {
    const credential = this.requireCredential();
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/temporary-password`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${credential}` },
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) throw new RelayHttpError(res.status, `\u4E34\u65F6\u5BC6\u7801\u64A4\u9500\u5931\u8D25: ${res.status} ${await res.text()}`);
  }
  /** 密码轮换（审计三轮#3）：凭据鉴权调 /password 端点原子替换 PHC——旧密码立即失效，凭据不丢、隧道不断；
   *  端点不可用（旧版中继）时退回：自吊销 + 重新注册（旧密码随之失效） */
  async rotatePassword(newPassword) {
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    if (!this.cfg.savedCredential) {
      this.log("[whalemaid] \u65E0\u4E2D\u7EE7\u51ED\u636E\uFF0C\u8DF3\u8FC7\u5728\u7EBF\u8F6E\u6362\uFF08\u4E0B\u6B21\u6CE8\u518C\u7528\u65B0\u5BC6\u7801\uFF09");
      return;
    }
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.savedCredential}` },
      body: JSON.stringify({ passwordDigest: phcScrypt(newPassword) }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status < 300) {
      this.log("[whalemaid] \u957F\u671F\u5BC6\u7801\u5DF2\u8F6E\u6362\uFF08\u670D\u52A1\u7AEF PHC \u539F\u5B50\u66FF\u6362\uFF0C\u65E7\u5BC6\u7801\u7ACB\u5373\u5931\u6548\uFF09");
      return;
    }
    this.log(`[whalemaid] /password \u7AEF\u70B9\u4E0D\u53EF\u7528\uFF08${res.status}\uFF09\uFF0C\u9000\u56DE\u81EA\u540A\u9500+\u91CD\u6CE8\u518C`);
    await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.cfg.savedCredential}` },
      fingerprint: this.cfg.relayFingerprint
    }).catch(() => void 0);
    this.updateCredential("");
  }
  async start() {
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    let credential = this.cfg.savedCredential;
    if (credential) {
      try {
        const binding2 = await this.establishTunnel(base, credential);
        this.startHeartbeat(base, credential);
        return binding2;
      } catch (e) {
        if (e instanceof RelayHttpError && CREDENTIAL_REJECTED.includes(e.status)) {
          this.log(`[whalemaid] \u51ED\u636E\u5931\u6548\uFF08${e.message}\uFF09\uFF0C\u91CD\u65B0\u6CE8\u518C`);
          this.updateCredential("");
          credential = "";
        } else {
          this.log(`[whalemaid] \u96A7\u9053\u5EFA\u7ACB\u6682\u5931\u8D25\uFF08${e instanceof Error ? e.message.slice(0, 80) : String(e)}\uFF09\uFF0C\u4FDD\u7559\u51ED\u636E\u9000\u907F\u91CD\u8BD5`);
          throw e;
        }
      }
    }
    const res = await this.req(`${base}/_whalemaid/devices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-install-code": this.cfg.relayInstallCode
      },
      body: JSON.stringify({
        deviceId: this.cfg.deviceId,
        passwordDigest: phcScrypt(this.cfg.longPassword),
        hostAuthority: `127.0.0.1:${this.cfg.pluginPort}`
      }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) {
      const text = await res.text();
      if (res.status === 409 && text.includes("device-already-registered")) {
        throw new Error(`\u6CE8\u518C\u88AB\u62D2 409 device-already-registered\uFF1A\u8BE5\u8BBE\u5907\u7F16\u53F7\u5DF2\u5728\u4E2D\u7EE7\u767B\u8BB0\uFF0C\u4F46\u672C\u673A\u5DF2\u4FDD\u5B58\u51ED\u636E\u4E22\u5931\u2014\u2014\u9700\u670D\u52A1\u7AEF\u7BA1\u7406\u5458\u540A\u9500\u65E7\u8BBE\u5907\u8BB0\u5F55\uFF08DELETE /_whalemaid/devices/${this.cfg.deviceId} + Bearer \u7BA1\u7406\u5458\u4EE4\u724C\uFF09\u540E\u672C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u91CD\u8BD5\u6210\u529F\uFF0C\u65E0\u9700\u91CD\u542F\u5BBF\u4E3B\uFF08docs/deploy-server.md\uFF09`);
      }
      if (res.status === 401) {
        throw new Error("\u6CE8\u518C\u5931\u8D25 401\uFF1A\u5B89\u88C5\u7801\u65E0\u6548\u6216\u5DF2\u88AB\u6D88\u8017\uFF08\u5355\u6B21\u4EE4\u724C\uFF09\u2014\u2014\u9700\u7BA1\u7406\u5458\u91CD\u53D1\u5B89\u88C5\u7801\u5E76\u66F4\u65B0\u5BBF\u4E3B\u914D\u7F6E relayInstallCode \u540E\u91CD\u542F\u5BBF\u4E3B\uFF08docs/deploy-server.md\uFF09");
      }
      throw new RelayHttpError(res.status, `\u6CE8\u518C\u5931\u8D25: ${res.status} ${text}`);
    }
    const reg = await res.json();
    credential = reg.credential;
    this.updateCredential(credential);
    const binding = await this.establishTunnel(base, credential);
    this.startHeartbeat(base, credential);
    return binding;
  }
  startHeartbeat(base, credential) {
    this.timer = setInterval(() => {
      this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/heartbeat`, {
        method: "POST",
        headers: { authorization: `Bearer ${credential}` },
        fingerprint: this.cfg.relayFingerprint
      }).then(async (res) => {
        if (res.status === 200) {
          try {
            const body = await res.json();
            if (body.connectEvents && body.connectEvents > 0) {
              this.log(`[whalemaid] \u4E3B\u63A7\u7AEF\u5DF2\u8FDE\u63A5\uFF08\u6700\u8FD1 20s \u5185 ${body.connectEvents} \u6B21\u6388\u6743\uFF09\u2014\u2014\u6709\u4EBA\u6B63\u5728\u8FDC\u7A0B\u63A7\u5236\u672C\u673A`);
            }
            if (body.temporaryPassword) this.cfg.onTemporaryStatus(body.temporaryPassword);
          } catch {
          }
        }
      }).catch(() => void 0);
    }, 2e4);
    this.timer.unref();
  }
  async establishTunnel(base, credential) {
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/tunnel`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
      body: JSON.stringify({ hostAuthority: `127.0.0.1:${this.cfg.pluginPort}` }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) throw new RelayHttpError(res.status, `\u96A7\u9053\u7B7E\u53D1\u5931\u8D25: ${res.status} ${await res.text()}`);
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

// src/temporary.ts
var TemporaryPasswordManager = class {
  constructor(store, relay) {
    this.store = store;
    this.relay = relay;
  }
  snapshot(now = Math.floor(Date.now() / 1e3)) {
    const current = this.store.temporaryPassword;
    if (current.state === "active" && now > current.expiresAt) {
      this.store.syncTemporaryPasswordStatus({
        state: "expired",
        expiresAt: current.expiresAt,
        generation: current.generation
      });
    }
    return this.store.temporaryPassword;
  }
  async issue(ttlSec) {
    if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > 86400) {
      throw new Error("ttlSec \u5FC5\u987B\u662F 60 \u5230 86400 \u4E4B\u95F4\u7684\u6574\u6570");
    }
    const password = generateTemporaryPassword();
    const issued = await this.relay.issueTemporaryPassword(password, ttlSec);
    if (issued.state !== "active") throw new Error(`\u4E2D\u7EE7\u8FD4\u56DE\u4E86\u65E0\u6548\u4E34\u65F6\u5BC6\u7801\u72B6\u6001: ${issued.state}`);
    const record = { password, ...issued };
    this.store.setTemporaryPassword(record);
    return record;
  }
  async revoke() {
    await this.relay.revokeTemporaryPassword();
    const current = this.store.temporaryPassword;
    this.store.syncTemporaryPasswordStatus({
      state: "revoked",
      expiresAt: current.expiresAt,
      generation: current.generation
    });
  }
};

// src/temporary-routes.ts
var CLIENT_HEADER = "x-whalemaid-client";
var TRANSPORT_ROLE_HEADER = "x-whalemaid-transport-role";
var CONTROLLER_ROLE = "controller";
var BadRequestError = class extends Error {
};
function respond(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}
function isControllerTransport(req) {
  const value = req.headers[TRANSPORT_ROLE_HEADER];
  const roles = Array.isArray(value) ? value : [value];
  return roles.some((role) => typeof role === "string" && role.trim().toLowerCase() === CONTROLLER_ROLE);
}
function authorized(req) {
  return req.headers[CLIENT_HEADER] === "1" && !isControllerTransport(req);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"];
    if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) {
      reject(new BadRequestError("content-type \u5FC5\u987B\u662F application/json"));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on?.("data", (chunk) => {
      const value = Buffer.from(chunk);
      size += value.length;
      if (size <= 4096) chunks.push(value);
    });
    req.on?.("end", () => {
      if (size > 4096) {
        reject(new BadRequestError("\u8BF7\u6C42\u4F53\u8FC7\u5927"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new BadRequestError("JSON \u65E0\u6548"));
      }
    });
    req.on?.("error", reject);
  });
}
function registerTemporaryPasswordRoutes(server, manager, deviceId) {
  const disposeDevice = server.register({
    kind: "exact",
    path: "/api/whalemaid/device",
    handler: (req, res) => {
      if (!authorized(req)) {
        respond(res, 403, { error: "forbidden" });
        return;
      }
      if (req.method !== "GET") {
        respond(res, 405, { error: "method not allowed" });
        return;
      }
      respond(res, 200, { deviceId, temporaryPassword: manager.snapshot() });
    }
  });
  const disposeTemporary = server.register({
    kind: "exact",
    path: "/api/whalemaid/temporary-password",
    handler: (req, res) => {
      if (!authorized(req)) {
        respond(res, 403, { error: "forbidden" });
        return;
      }
      if (req.method === "DELETE") {
        void manager.revoke().then(() => {
          respond(res, 200, { deviceId, temporaryPassword: manager.snapshot() });
        }).catch((error) => {
          respond(res, 502, { error: error instanceof Error ? error.message : String(error) });
        });
        return;
      }
      if (req.method !== "POST") {
        respond(res, 405, { error: "method not allowed" });
        return;
      }
      void readJson(req).then((body) => {
        const ttlSec = Number(body.ttlSec);
        if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > 86400) {
          throw new BadRequestError("ttlSec \u5FC5\u987B\u662F 60 \u5230 86400 \u4E4B\u95F4\u7684\u6574\u6570");
        }
        return manager.issue(ttlSec);
      }).then((temporaryPassword) => {
        respond(res, 200, { deviceId, temporaryPassword });
      }).catch((error) => {
        const status = error instanceof BadRequestError ? 400 : 502;
        respond(res, status, { error: error instanceof Error ? error.message : String(error) });
      });
    }
  });
  return () => {
    disposeTemporary();
    disposeDevice();
  };
}

// src/v1/providers.ts
function audioFilename(mimeType) {
  const mime = mimeType.toLowerCase();
  if (mime.includes("mp4") || mime.includes("m4a")) return "audio.m4a";
  if (mime.includes("mpeg")) return "audio.mp3";
  if (mime.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}
function voiceCall(req) {
  const boundary = `----whalemaid-${Math.random().toString(36).slice(2)}`;
  const filename = audioFilename(req.mimeType);
  switch (req.provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/audio/transcriptions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody([
          ["model", "whisper-1"],
          ["file", req.audio, req.mimeType, filename]
        ], boundary)
      };
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody([
          ["model", "whisper-large-v3"],
          ["file", req.audio, req.mimeType, filename]
        ], boundary)
      };
    case "dashscope":
      throw new Error("dashscope \u8BED\u97F3\u6587\u4EF6\u8BC6\u522B\u672A\u7ECF\u771F\u5B9E key \u5B9E\u6D4B\uFF0C\u7981\u6B62\u4F7F\u7528\uFF08audit#7\uFF09");
  }
}
function parseVoiceResponse(provider, raw) {
  const data = JSON.parse(raw);
  if (provider === "dashscope") {
    throw new Error("dashscope \u8BED\u97F3\u672A\u7ECF\u5B9E\u6D4B\uFF0C\u7981\u6B62\u4F7F\u7528\uFF08audit#7\uFF09");
  }
  const text = typeof data.text === "string" ? data.text : "";
  if (!text) throw new Error(`\u8BED\u97F3\u8F6C\u5F55\u54CD\u5E94\u7F3A\u5C11 text \u5B57\u6BB5`);
  return { text };
}
function visionCall(req) {
  const base64 = req.image.toString("base64");
  const dataUrl = `data:${req.mimeType};base64,${base64}`;
  switch (req.provider) {
    case "deepseek-ocr":
      return {
        url: "https://api.deepseek.com/chat/completions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: [
            { type: "text", text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { type: "image_url", image_url: { url: dataUrl } }
          ] }],
          max_tokens: 300
        }))
      };
    case "qwen-vl":
      return {
        url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          model: "qwen-vl-max",
          messages: [{ role: "user", content: [
            { type: "text", text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { type: "image_url", image_url: { url: dataUrl } }
          ] }],
          max_tokens: 300
        }))
      };
    case "openai-vision":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: [
            { type: "text", text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { type: "image_url", image_url: { url: dataUrl } }
          ] }],
          max_tokens: 300
        }))
      };
    case "grok-vision":
      return {
        url: "https://api.x.ai/v1/chat/completions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          model: "grok-2-vision-latest",
          messages: [{ role: "user", content: [
            { type: "text", text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { type: "image_url", image_url: { url: dataUrl } }
          ] }],
          max_tokens: 300
        }))
      };
    case "gemini":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(req.apiKey)}`,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          contents: [{ parts: [
            { text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { inline_data: { mime_type: req.mimeType, data: base64 } }
          ] }]
        }))
      };
  }
}
function parseVisionResponse(provider, raw) {
  const data = JSON.parse(raw);
  if (provider === "gemini") {
    const text2 = extractFirstText(data.candidates);
    if (!text2) throw new Error("\u89C6\u89C9\u54CD\u5E94\u7F3A\u5C11\u6587\u672C");
    return { description: text2 };
  }
  const choices = data.choices;
  const content = choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : content?.find((p) => p.type === "text")?.text ?? "";
  if (!text) throw new Error("\u89C6\u89C9\u54CD\u5E94\u7F3A\u5C11\u6587\u672C");
  return { description: text };
}
function extractFirstText(value) {
  if (Array.isArray(value)) {
    for (const cand of value) {
      const parts = cand?.content?.parts ?? [];
      for (const p of parts) if (typeof p.text === "string" && p.text) return p.text;
    }
  }
  return "";
}
function multipartBody(fields, boundary) {
  const parts = [];
  for (const f of fields) {
    if (typeof f[1] === "string") {
      parts.push(Buffer.from(`--${boundary}\r
content-disposition: form-data; name="${f[0]}"\r
\r
${f[1]}\r
`));
    } else {
      const [, content, mime, filename] = f;
      parts.push(Buffer.from(`--${boundary}\r
content-disposition: form-data; name="${f[0]}"; filename="${filename}"\r
content-type: ${mime}\r
\r
`));
      parts.push(content);
      parts.push(Buffer.from("\r\n"));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r
`));
  return Buffer.concat(parts);
}
var VOICE_PROVIDERS = ["openai", "groq", "dashscope"];
var VISION_PROVIDERS = ["deepseek-ocr", "qwen-vl", "openai-vision", "grok-vision", "gemini"];

// src/v1/routes.ts
async function resolveKey(ref, deps) {
  if (!deps.credentials) throw new Error("\u5BBF\u4E3B\u65E0 credentials \u670D\u52A1");
  const hit = await deps.credentials.resolve(ref);
  const value = hit?.value;
  if (!value || value.length === 0) throw new Error(`\u51ED\u636E\u5F15\u7528 ${ref} \u672A\u8BBE\u7F6E\uFF08\u5BBF\u4E3B dsh-credentials\uFF09`);
  return value;
}
async function transcribe(body, deps) {
  const provider = deps.cfg.voiceProvider;
  if (!VOICE_PROVIDERS.includes(provider)) throw new Error(`voiceProvider \u672A\u914D\u7F6E\u6216\u672A\u77E5: ${deps.cfg.voiceProvider}`);
  const payload = JSON.parse(body.toString("utf8"));
  if (!payload.audio) throw new Error("audio(base64) \u5FC5\u586B");
  const call = voiceCall({
    provider,
    apiKey: await resolveKey(deps.cfg.voiceCredentialRef, deps),
    audio: Buffer.from(payload.audio, "base64"),
    mimeType: payload.mimeType ?? "audio/webm"
  });
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(call.url, { method: "POST", headers: call.headers, body: call.body });
  const raw = await res.text();
  if (!res.ok) throw new Error(`\u8BED\u97F3\u8F6C\u5F55\u4E0A\u6E38\u5931\u8D25 ${res.status}: ${raw.slice(0, 200)}`);
  return parseVoiceResponse(provider, raw);
}
async function describeImage(body, deps) {
  const provider = deps.cfg.visionProvider;
  if (!VISION_PROVIDERS.includes(provider)) throw new Error(`visionProvider \u672A\u914D\u7F6E\u6216\u672A\u77E5: ${deps.cfg.visionProvider}`);
  const payload = JSON.parse(body.toString("utf8"));
  if (!payload.image) throw new Error("image(base64) \u5FC5\u586B");
  const call = visionCall({
    provider,
    apiKey: await resolveKey(deps.cfg.visionCredentialRef, deps),
    image: Buffer.from(payload.image, "base64"),
    mimeType: payload.mimeType ?? "image/png"
  });
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(call.url, { method: "POST", headers: call.headers, body: call.body });
  const raw = await res.text();
  if (!res.ok) throw new Error(`\u89C6\u89C9\u63CF\u8FF0\u4E0A\u6E38\u5931\u8D25 ${res.status}: ${raw.slice(0, 200)}`);
  return parseVisionResponse(provider, raw);
}

// src/config.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  dataDir: Schema.string().default(""),
  relayUrl: Schema.string().default(""),
  relayInstallCode: Schema.string().default(""),
  relayFingerprint: Schema.string().default(""),
  ratholeBin: Schema.string().default("rathole"),
  relayPort: Schema.number().default(2333),
  voiceProvider: Schema.string().default(""),
  voiceCredentialRef: Schema.string().default(""),
  visionProvider: Schema.string().default(""),
  visionCredentialRef: Schema.string().default("")
});

// src/index.ts
var name = "whalemaid";
var inject = ["webServer"];
function createTemporaryRouteServer(hostWeb) {
  return { register: hostWeb.register.bind(hostWeb) };
}
var DEFAULTS = {
  dataDir: "",
  relayUrl: "",
  relayInstallCode: "",
  relayFingerprint: "",
  ratholeBin: "rathole",
  relayPort: 2333,
  voiceProvider: "",
  voiceCredentialRef: "",
  visionProvider: "",
  visionCredentialRef: ""
};
function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...config };
  const profileBaseUrl = ctx.baseUrl;
  const store = new Store({ dataDir: resolved.dataDir, profileBaseUrl });
  const hostWeb = ctx.webServer;
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
      // 隧道目标 = 宿主原生 web 端口（官方 /api+WS+UI；官方默认 127.0.0.1 安全姿态）
      pluginPort: hostWeb?.port ?? 0,
      dataDir: store.file.replace(/store\.json$/, ""),
      deviceId: store.deviceId,
      longPassword: store.longPassword,
      savedCredential: store.relayCredential,
      onCredential: (c) => store.setRelayCredential(c),
      onTemporaryStatus: (status) => store.syncTemporaryPasswordStatus(status)
    },
    (msg) => ctx.logger.info(msg)
  ) : null;
  let disposed = false;
  ctx.effect(() => () => {
    disposed = true;
    relay?.stop();
    store.close();
  });
  if (!relay) {
    ctx.logger.warn("[whalemaid] \u672A\u914D\u7F6E relayUrl\uFF1A\u63D2\u4EF6\u4E0D\u751F\u6548\uFF08\u8FDC\u7A0B\u63A7\u5236\u53EA\u8D70\u4E2D\u7EE7\uFF0C\u7F16\u53F7+\u5BC6\u7801\u6A21\u578B\uFF09\u2014\u2014\u89C1 docs/deploy-server.md");
    return;
  }
  if (!hostWeb?.port) {
    ctx.logger.error("[whalemaid] \u5BBF\u4E3B\u65E0 web \u670D\u52A1\uFF08webServer.port \u7F3A\u5931\uFF09\uFF1A\u672C\u63D2\u4EF6\u4F9D\u8D56\u5B98\u65B9 web \u8F7D\u4F53\uFF0C\u63D2\u4EF6\u96F6\u76D1\u542C");
    return;
  }
  if (!hostWeb.register) {
    ctx.logger.error("[whalemaid] \u5BBF\u4E3B webServer.register \u7F3A\u5931\uFF1A\u65E0\u6CD5\u6302\u8F7D\u4E34\u65F6\u5BC6\u7801\u7BA1\u7406\u9762\uFF0C\u62D2\u7EDD\u90E8\u5206\u542F\u7528");
    return;
  }
  const temporaryPasswords = new TemporaryPasswordManager(store, relay);
  const temporaryRouteServer = createTemporaryRouteServer(hostWeb);
  ctx.effect(
    () => registerTemporaryPasswordRoutes(temporaryRouteServer, temporaryPasswords, store.deviceId),
    "whalemaid: temporary password routes"
  );
  ctx.logger.info(`[whalemaid] \u8BBE\u5907\u7F16\u53F7 ${store.deviceId}\uFF08\u957F\u671F\u5BC6\u7801\u89C1 ${store.file}\uFF09\uFF1B\u96A7\u9053\u76EE\u6807 = \u5BBF\u4E3B\u539F\u751F web:${hostWeb.port}\uFF1B\u672C\u5730\u7BA1\u7406 token=${store.adminToken}`);
  ctx.logger.info(`[whalemaid] ==== WhaleMaid \u53D7\u63A7\u7AEF\u8BF4\u660E ====
  \xB7 \u8BBE\u5907\u7F16\u53F7: ${store.deviceId}\uFF08\u4E3B\u63A7\u7AEF\u7528\u300C\u7F16\u53F7+\u957F\u671F\u5BC6\u7801\u300D\u8FDE\u63A5\uFF0C\u5168\u7A0B\u65E0 IP\uFF09
  \xB7 \u957F\u671F\u5BC6\u7801: \u89C1 ${store.file} \u7684 longPassword\uFF1B\u8F6E\u6362: POST /whalemaid/rotate-password + x-whalemaid-token: ${store.adminToken}
  \xB7 \u5B89\u5168: \u6709\u4EBA\u8FDE\u63A5\u672C\u673A = \u5B8C\u6574\u8FDC\u7A0B\u63A7\u5236\uFF0C\u7B49\u540C\u5176\u5750\u5728\u672C\u673A\u524D\uFF1B\u8BF7\u52FF\u6CC4\u9732\u5BC6\u7801\uFF0C\u5931\u7A83\u5373\u8F6E\u6362
  \xB7 \u88AB\u8FDE\u63A5\u63D0\u793A: \u4E3B\u63A7\u7AEF\u8FDE\u63A5\u6210\u529F/\u65AD\u5F00\u4F1A\u6253\u5370\u5728\u4E0B\u65B9\u65E5\u5FD7\uFF08[whalemaid] \u4E3B\u63A7\u7AEF\u5DF2\u8FDE\u63A5/\u5DF2\u65AD\u5F00\uFF09
  ========================================`);
  let attempt = 0;
  const tryStart = async () => {
    if (disposed) return;
    try {
      await relay.start();
      if (disposed) {
        relay.stop();
        return;
      }
      ctx.logger.info(`[whalemaid] \u4E2D\u7EE7\u5DF2\u63A5\u5165 device=${store.deviceId} target=\u5BBF\u4E3B\u539F\u751Fweb:${hostWeb.port}\uFF08\u4E3B\u63A7\u7AEF\u7528\u8BBE\u5907\u7F16\u53F7+\u5BC6\u7801\u8FDE\u63A5\uFF0C\u65E0\u9700 IP\uFF09`);
    } catch (e) {
      if (disposed) return;
      attempt += 1;
      const delay = Math.min(2e3 * 2 ** attempt, 6e4);
      ctx.logger.warn(`[whalemaid] \u4E2D\u7EE7\u63A5\u5165\u5931\u8D25\uFF08\u7B2C ${attempt} \u6B21\uFF09: ${e instanceof Error ? e.message : String(e)}\uFF1B${Math.round(delay / 1e3)}s \u540E\u91CD\u8BD5`);
      setTimeout(tryStart, delay).unref();
    }
  };
  void tryStart();
  try {
    const web = ctx;
    web.webServer?.register?.({
      kind: "exact",
      path: "/whalemaid/rotate-password",
      handler: (_req, res) => {
        const req = _req;
        const token = req.headers["x-whalemaid-token"];
        if (req.method !== "POST" || token !== store.adminToken) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        const next = store.rotatePassword();
        void relay.rotatePassword(next).catch((e) => ctx.logger.warn(`[whalemaid] \u5BC6\u7801\u8F6E\u6362\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`));
        ctx.logger.info(`[whalemaid] \u957F\u671F\u5BC6\u7801\u5DF2\u91CD\u751F\u6210\uFF08\u65B0\u5BC6\u7801\u89C1 ${store.file}\uFF09`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, deviceId: store.deviceId }));
      }
    });
  } catch {
    ctx.logger.warn("[whalemaid] \u5BBF\u4E3B web \u8DEF\u7531\u4E0D\u53EF\u7528\uFF0C\u5BC6\u7801\u8F6E\u6362\u5165\u53E3\u8DF3\u8FC7");
  }
  try {
    const v1Cfg = {
      voiceProvider: resolved.voiceProvider,
      voiceCredentialRef: resolved.voiceCredentialRef,
      visionProvider: resolved.visionProvider,
      visionCredentialRef: resolved.visionCredentialRef
    };
    if (v1Cfg.voiceProvider || v1Cfg.visionProvider) {
      const web = ctx;
      const credentials = web.get?.("credentials");
      const deps = {
        cfg: v1Cfg,
        credentials,
        log: (m) => ctx.logger.info(m)
      };
      const readBody = (req) => new Promise((resolve, reject) => {
        const chunks = [];
        req.on?.("data", (c) => chunks.push(Buffer.from(c)));
        req.on?.("end", () => resolve(Buffer.concat(chunks)));
        req.on?.("error", reject);
      });
      const jsonRoute = (path, run) => {
        web.webServer?.register?.({
          kind: "exact",
          path,
          handler: (req, res) => {
            if (req.method !== "POST") {
              res.writeHead(405);
              res.end("method not allowed");
              return;
            }
            void readBody(req).then(async (body) => {
              try {
                const result = await run(body);
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify(result));
              } catch (e) {
                res.writeHead(400, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
              }
            }).catch((e) => {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
            });
          }
        });
      };
      if (v1Cfg.voiceProvider) jsonRoute("/api/whalemaid/voice.transcribe", (body) => transcribe(body, deps));
      if (v1Cfg.visionProvider) jsonRoute("/api/whalemaid/vision.describe", (body) => describeImage(body, deps));
      ctx.logger.info(`[whalemaid] V1 \u589E\u5F3A\u9762\u5DF2\u6302\u8F7D: voice=${v1Cfg.voiceProvider || "-"} vision=${v1Cfg.visionProvider || "-"}\uFF08BYOK\uFF0Ckey \u53EA\u5B58\u5BBF\u4E3B\uFF09`);
    }
  } catch (e) {
    ctx.logger.warn(`[whalemaid] V1 \u8DEF\u7531\u6302\u8F7D\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`);
  }
}
export {
  Config,
  apply,
  createTemporaryRouteServer,
  inject,
  name
};
