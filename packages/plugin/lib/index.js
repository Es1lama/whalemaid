// src/store.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes as randomBytes2 } from "node:crypto";
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
var Store = class {
  state;
  path;
  constructor(dataDir) {
    const base = dataDir || join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "whalemaid");
    this.path = join(base, "store.json");
    mkdirSync(base, { recursive: true });
    this.state = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : {
      longPassword: generatePassword(),
      deviceId: generateDeviceId(),
      relayCredential: "",
      adminToken: randomBytes2(16).toString("hex")
    };
    this.state.relayCredential ??= "";
    this.state.adminToken ??= randomBytes2(16).toString("hex");
    this.state.deviceId ??= generateDeviceId();
    this.state.longPassword ??= generatePassword();
    this.persist();
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
        const fp = createHash("sha256").update(cert.raw ?? Buffer.alloc(0)).digest("hex");
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
  /** 密码轮换（审计三轮#3）：凭据鉴权调 /password 端点原子替换 PHC——旧密码立即失效，凭据不丢、隧道不断；
   *  端点不可用（旧版中继）时退回：自吊销 + 重新注册（旧密码随之失效） */
  async rotatePassword(newPassword) {
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    if (!this.cfg.savedCredential) {
      this.log("[whalemaid] \u65E0\u4E2D\u7EE7\u51ED\u636E\uFF0C\u8DF3\u8FC7\u5728\u7EBF\u8F6E\u6362\uFF08\u4E0B\u6B21\u6CE8\u518C\u7528\u65B0\u5BC6\u7801\uFF09");
      return;
    }
    const res = await pinnedRequest(`${base}/_whalemaid/devices/${this.cfg.deviceId}/password`, {
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
    await pinnedRequest(`${base}/_whalemaid/devices/${this.cfg.deviceId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.cfg.savedCredential}` },
      fingerprint: this.cfg.relayFingerprint
    }).catch(() => void 0);
    this.cfg.onCredential("");
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
  dataDir: Schema.string().default(""),
  relayUrl: Schema.string().default(""),
  relayInstallCode: Schema.string().default(""),
  relayFingerprint: Schema.string().default(""),
  ratholeBin: Schema.string().default("rathole"),
  relayPort: Schema.number().default(2333)
});

// src/index.ts
var name = "whalemaid";
var inject = ["webServer"];
var DEFAULTS = {
  dataDir: "",
  relayUrl: "",
  relayInstallCode: "",
  relayFingerprint: "",
  ratholeBin: "rathole",
  relayPort: 2333
};
function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...config };
  const store = new Store(resolved.dataDir);
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
      onCredential: (c) => store.setRelayCredential(c)
    },
    (msg) => ctx.logger.info(msg)
  ) : null;
  if (!relay) {
    ctx.logger.warn("[whalemaid] \u672A\u914D\u7F6E relayUrl\uFF1A\u63D2\u4EF6\u4E0D\u751F\u6548\uFF08\u8FDC\u7A0B\u63A7\u5236\u53EA\u8D70\u4E2D\u7EE7\uFF0C\u7F16\u53F7+\u5BC6\u7801\u6A21\u578B\uFF09\u2014\u2014\u89C1 docs/deploy-server.md");
    return;
  }
  if (!hostWeb?.port) {
    ctx.logger.error("[whalemaid] \u5BBF\u4E3B\u65E0 web \u670D\u52A1\uFF08webServer.port \u7F3A\u5931\uFF09\uFF1A\u672C\u63D2\u4EF6\u4F9D\u8D56\u5B98\u65B9 web \u8F7D\u4F53\uFF0C\u4E0D\u505A\u4EFB\u4F55\u81EA\u5EFA\u76D1\u542C");
    return;
  }
  ctx.logger.info(`[whalemaid] \u8BBE\u5907\u7F16\u53F7 ${store.deviceId}\uFF08\u957F\u671F\u5BC6\u7801\u89C1 ${store.file}\uFF09\uFF1B\u96A7\u9053\u76EE\u6807 = \u5BBF\u4E3B\u539F\u751F web:${hostWeb.port}\uFF1B\u672C\u5730\u7BA1\u7406 token=${store.adminToken}`);
  let attempt = 0;
  const tryStart = async () => {
    try {
      await relay.start();
      ctx.logger.info(`[whalemaid] \u4E2D\u7EE7\u5DF2\u63A5\u5165 device=${store.deviceId} target=\u5BBF\u4E3B\u539F\u751Fweb:${hostWeb.port}\uFF08\u4E3B\u63A7\u7AEF\u7528\u8BBE\u5907\u7F16\u53F7+\u5BC6\u7801\u8FDE\u63A5\uFF0C\u65E0\u9700 IP\uFF09`);
    } catch (e) {
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
  ctx.effect(() => () => {
    relay.stop();
  });
}
export {
  Config,
  apply,
  inject,
  name
};
