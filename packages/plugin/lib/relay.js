// packages/plugin/src/relay.ts
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, createHash } from "node:crypto";
import https from "node:https";
function phcScrypt(password, salt = randomBytes(16)) {
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
    const dir = join(this.cfg.dataDir, "relay");
    mkdirSync(dir, { recursive: true });
    const cfgFile = join(dir, "rathole-client.toml");
    writeFileSync(cfgFile, cfgText, { mode: 384 });
    let backoffMs = 1e3;
    const spawnClient = () => {
      this.child = spawn(this.cfg.ratholeBin, ["--client", cfgFile], { stdio: "ignore" });
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
export {
  RelayClient,
  RelayHttpError,
  normalizeFingerprint,
  phcScrypt
};
