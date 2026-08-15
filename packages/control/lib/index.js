// src/index.ts
import Schema from "@deepseek-ai/schemastery";
import "@deepseek-ai/dsh-tools";

// src/client.ts
var WhaleNodeClient = class {
  token = null;
  base = "";
  constructor(base) {
    this.base = base.replace(/\/$/, "");
  }
  /** 工具调用映射：whalemaid_<action> → 协议方法 */
  async callTool(action, args, cfg) {
    const base = args.base || cfg.base;
    if (!base) throw new Error("\u672A\u914D\u7F6E\u88AB\u63A7\u7AEF\u5730\u5740\uFF08base\uFF09");
    if (base !== this.base) this.base = base.replace(/\/$/, "");
    if (!this.token) {
      const deviceId = args.deviceId || cfg.deviceId;
      const password = args.password || cfg.password;
      if (!deviceId || !password) throw new Error("\u672A\u914D\u7F6E deviceId/password");
      await this.connect(deviceId, password);
    }
    switch (action) {
      case "connect":
        return JSON.stringify({ connected: true, base: this.base });
      case "session_list":
        return JSON.stringify(await this.call("session.list", {}));
      case "session_create":
        return JSON.stringify(await this.call("session.create", args.workspaceId ? { workspaceId: args.workspaceId } : {}));
      case "prompt":
        return JSON.stringify(await this.call("session.prompt", { sessionId: args.sessionId, text: args.text }));
      case "history":
        return JSON.stringify(await this.call("session.history", { sessionId: args.sessionId, maxMessages: 30 }));
      case "stop":
        return JSON.stringify(await this.call("session.stop", { sessionId: args.sessionId }));
      case "pending_approvals":
        return JSON.stringify(await this.pendingApprovals(args.sessionId));
      case "approval_respond":
        return JSON.stringify(await this.call("approval.respond", {
          rpcId: args.rpcId,
          sessionId: args.sessionId,
          approvalId: args.approvalId,
          outcome: args.outcome
        }));
      case "workspace_list":
        return JSON.stringify(await this.call("workspace.list", {}));
      case "workspace_create":
        return JSON.stringify(await this.call("workspace.create", { path: args.path }));
      case "list_directory":
        return JSON.stringify(await this.call("host.listDirectory", args.path ? { path: args.path } : {}));
      case "permission_set":
        return JSON.stringify(await this.call("permission.set", { sessionId: args.sessionId, value: args.value }));
      default:
        throw new Error(`\u672A\u77E5\u63A7\u5236\u52A8\u4F5C: ${action}`);
    }
  }
  async connect(deviceId, password) {
    const { generateKeyPairSync, sign } = await import("node:crypto");
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const hs = await this.call("device.handshake", { deviceId, publicKeyJwk: jwk });
    const sig = sign("sha256", Buffer.from(hs.nonce, "utf8"), privateKey).toString("base64");
    const bind = await this.call("device.bind", { deviceId, nonce: hs.nonce, password, nonceSignature: sig });
    this.token = bind.deviceToken;
  }
  async call(method, payload) {
    const res = await fetch(`${this.base}/api/v1?method=${encodeURIComponent(method)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.token ? { authorization: `Bearer ${this.token}` } : {}
      },
      body: JSON.stringify({ v: 1, rpcId: crypto.randomUUID(), method, payload })
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`${body.error?.code}: ${body.error?.message}`);
    return body.data;
  }
  /** 轮询待审批（SSE 历史回放通道，PROTO-004） */
  async pendingApprovals(sessionId) {
    const res = await fetch(`${this.base}/api/v1/poll?since=0`, {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {}
    });
    const body = await res.json();
    const pending = (body.events ?? []).filter((e) => e.type === "permission-request" && String(e.payload.sessionId) === sessionId).map((e) => e.payload);
    return { pending };
  }
};

// src/index.ts
var name = "whalemaid-control";
var inject = ["tools"];
var Config = Schema.object({
  base: Schema.string().default(""),
  deviceId: Schema.string().default(""),
  password: Schema.string().default("")
});
function j(required, extra = {}) {
  return {
    type: "object",
    properties: Object.fromEntries(required.map((k) => [k, { type: "string" }])),
    required,
    additionalProperties: false,
    ...extra
  };
}
var textOut = {
  schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  render: (_args, value) => [{ type: "text", text: value.text }]
};
var TOOLS = [
  {
    name: "whalemaid_connect",
    description: "\u8FDE\u63A5\u4E00\u53F0\u8FD0\u884C whalemaid \u63D2\u4EF6\u7684\u7535\u8111\uFF08base/deviceId/password \u7F3A\u7701\u7528\u914D\u7F6E\uFF09\u3002\u8FD4\u56DE\u80FD\u529B\u4F4D\u3002",
    params: j(["base", "deviceId", "password"])
  },
  {
    name: "whalemaid_session_list",
    description: "\u5217\u51FA\u88AB\u63A7\u7AEF\u7535\u8111\u4E0A DSH \u7684\u539F\u751F\u4F1A\u8BDD",
    params: j([])
  },
  {
    name: "whalemaid_session_create",
    description: "\u5728\u88AB\u63A7\u7AEF\u65B0\u5EFA\u4E00\u4E2A DSH \u539F\u751F\u4F1A\u8BDD\uFF08\u53EF\u6307\u5B9A workspaceId\uFF09",
    params: j(["workspaceId"])
  },
  {
    name: "whalemaid_prompt",
    description: "\u5411\u88AB\u63A7\u7AEF\u7684\u539F\u751F\u4F1A\u8BDD\u5E03\u7F6E\u4EFB\u52A1\uFF08\u771F\u5B9E\u8FD0\u884C\u5728\u5BF9\u65B9\u7535\u8111\u4E0A\uFF09",
    params: j(["sessionId", "text"])
  },
  {
    name: "whalemaid_history",
    description: "\u8BFB\u53D6\u88AB\u63A7\u7AEF\u4F1A\u8BDD\u7684\u5BF9\u8BDD\u4E0E\u8F68\u8FF9\uFF08\u4E8B\u4EF6\u5386\u53F2\uFF09",
    params: j(["sessionId"])
  },
  {
    name: "whalemaid_stop",
    description: "\u505C\u6B62\u88AB\u63A7\u7AEF\u6B63\u5728\u8FD0\u884C\u7684\u4EFB\u52A1",
    params: j(["sessionId"])
  },
  {
    name: "whalemaid_pending_approvals",
    description: "\u67E5\u8BE2\u88AB\u63A7\u7AEF\u5F85\u5BA1\u6279\u7684\u6743\u9650\u8BF7\u6C42\uFF08\u542B\u53EF\u56DE\u5E94\u7684 rpcId/approvalId\uFF09",
    params: j(["sessionId"])
  },
  {
    name: "whalemaid_approval_respond",
    description: "\u56DE\u5E94\u88AB\u63A7\u7AEF\u7684\u6743\u9650\u5BA1\u6279\uFF08outcome: allowed-once | rejected\uFF09",
    params: j(["sessionId", "rpcId", "approvalId", "outcome"])
  },
  {
    name: "whalemaid_workspace_list",
    description: "\u5217\u51FA\u88AB\u63A7\u7AEF\u7684\u5DE5\u4F5C\u533A",
    params: j([])
  },
  {
    name: "whalemaid_workspace_create",
    description: "\u5728\u88AB\u63A7\u7AEF\u9009\u62E9\u76EE\u5F55\u521B\u5EFA\u5DE5\u4F5C\u533A\uFF08\u8FDC\u7A0B\u76EE\u5F55\u6D4F\u89C8\uFF09",
    params: j(["path"])
  },
  {
    name: "whalemaid_list_directory",
    description: "\u6D4F\u89C8\u88AB\u63A7\u7AEF\u4E3B\u673A\u76EE\u5F55",
    params: j(["path"])
  },
  {
    name: "whalemaid_permission_set",
    description: "\u8C03\u6574\u88AB\u63A7\u7AEF\u4F1A\u8BDD\u7684\u6743\u9650\u9884\u8BBE\uFF08/permission \u8BED\u4E49\uFF09",
    params: j(["sessionId", "value"])
  }
];
function apply(ctx, config) {
  const cfg = { base: "", deviceId: "", password: "", ...config };
  const client = new WhaleNodeClient(cfg.base);
  for (const t of TOOLS) {
    ctx.tools.register({
      name: t.name,
      description: t.description,
      parameters: t.params,
      output: textOut,
      timeoutMs: 6e4,
      execute: async (args) => {
        const a = args ?? {};
        try {
          const text = await client.callTool(t.name.replace(/^whalemaid_/, ""), a, cfg);
          return { text };
        } catch (e) {
          return { text: `whalemaid \u8FDC\u7A0B\u63A7\u5236\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
    });
  }
}
export {
  Config,
  apply,
  inject,
  name
};
