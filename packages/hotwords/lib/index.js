// src/index.ts
import Schema from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

// src/extract.ts
var STOPWORDS = /* @__PURE__ */ new Set(["API", "HTTP", "HTTPS", "JSON", "URL", "OK", "THE", "AND", "FOR", "YOU", "CAN", "NOT", "BUT", "ALL", "NEW", "NOW", "TODO"]);
function quotedTerms(text) {
  const out = [];
  for (const m of text.matchAll(/[`'"]{1}([A-Za-z0-9_./:+-]{2,40})[`'"]{1}/g)) out.push(m[1]);
  return out;
}
function caseTerms(text) {
  const out = [];
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*\b|\b[A-Z][a-zA-Z0-9]*[a-z][a-zA-Z0-9]*\b/g)) out.push(m[0]);
  return out;
}
function snakeTerms(text) {
  const out = [];
  for (const m of text.matchAll(/\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b|\b[a-z][a-z0-9]+(?:-[a-z0-9]+)+\b/g)) out.push(m[0]);
  return out;
}
function acronymTerms(text) {
  const out = [];
  for (const m of text.matchAll(/\b[A-Z]{2,8}\b/g)) {
    if (!STOPWORDS.has(m[0])) out.push(m[0]);
  }
  return out;
}
function mixedTerms(text) {
  const out = [];
  for (const m of text.matchAll(/[\u4e00-\u9fff]{1,6}[A-Za-z][A-Za-z0-9]{1,24}|[A-Za-z][A-Za-z0-9]{1,24}[\u4e00-\u9fff]{1,6}/g)) out.push(m[0]);
  return out;
}
function extractKeywords(text, limit = 30) {
  const count = /* @__PURE__ */ new Map();
  const bump = (t, weight = 1) => count.set(t, (count.get(t) ?? 0) + weight);
  for (const t of quotedTerms(text)) bump(t, 2);
  for (const t of caseTerms(text)) bump(t, 1);
  for (const t of snakeTerms(text)) bump(t, 1);
  for (const t of acronymTerms(text)) bump(t, 1);
  for (const t of mixedTerms(text)) bump(t, 1);
  return [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([t]) => t);
}
function diffKeywords(prev, next) {
  const p = new Set(prev);
  const n = new Set(next);
  return { add: next.filter((t) => !p.has(t)), remove: prev.filter((t) => !n.has(t)) };
}

// src/store.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var HotwordStore = class {
  file;
  state;
  constructor(dataDir) {
    const base = dataDir || join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "whalemaid-hotwords");
    this.file = join(base, "state.json");
    mkdirSync(base, { recursive: true });
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : { words: [] };
  }
  get words() {
    return this.state.words;
  }
  get vocabularyId() {
    return this.state.vocabularyId;
  }
  save(words, vocabularyId) {
    this.state = { words, ...vocabularyId ? { vocabularyId } : {} };
    writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 384 });
  }
};

// src/upload.ts
function httpUploader(endpoint, resolveToken) {
  return {
    async apply(diff) {
      const token = await resolveToken?.();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...token ? { authorization: `Bearer ${token}` } : {} },
        body: JSON.stringify(diff)
      });
      if (!res.ok) throw new Error(`\u70ED\u8BCD\u7AEF\u70B9\u5931\u8D25: ${res.status} ${await res.text()}`);
    }
  };
}
function dashscopeUploader(resolveKey, getVocabularyId, saveVocabularyId) {
  return {
    async apply(_diff) {
      throw new Error("dashscope \u5B9A\u5236\u70ED\u8BCD API \u5F85\u771F\u5B9E key \u5B9E\u6D4B\uFF08NEEDED-BY-OWNER\uFF09");
    }
  };
}
function createUploader(cfg, resolveKey, store) {
  if (cfg.mode === "http") {
    if (!cfg.endpoint) throw new Error("http \u6A21\u5F0F\u9700\u8981 endpoint");
    return httpUploader(cfg.endpoint, cfg.credentialRef ? () => resolveKey(cfg.credentialRef ?? "") : void 0);
  }
  return dashscopeUploader(resolveKey, store.getVocabularyId, store.saveVocabularyId);
}

// src/index.ts
var name = "whalemaid-hotwords";
var inject = ["apiProxy", "credentials"];
var Config = Schema.object({
  mode: Schema.union(["http", "dashscope"]).default("http"),
  endpoint: Schema.string().default(""),
  credentialRef: Schema.string().default(""),
  limit: Schema.number().default(30)
});
function apply(ctx, config) {
  const cfg = { mode: "http", endpoint: "", credentialRef: "", limit: 30, ...config };
  const store = new HotwordStore();
  const apiProxy = ctx.apiProxy;
  const credentials = ctx.credentials;
  const resolveKey = async (ref) => ref ? (await credentials.resolve(credentialRef(ref)))?.value : void 0;
  const uploader = createUploader(
    { mode: cfg.mode, endpoint: cfg.endpoint || void 0, credentialRef: cfg.credentialRef || void 0 },
    resolveKey,
    { getVocabularyId: () => store.vocabularyId, saveVocabularyId: (id) => store.save(store.words, id) }
  );
  const onTurnEnd = async (sessionId) => {
    try {
      const r = await apiProxy.sessions.history({ rpcId: "hotwords", payload: { sessionId: String(sessionId), maxMessages: 2 } });
      if (!r.result.ok) return;
      const events = r.result.value?.events ?? [];
      const last = [...events].reverse().find((e) => e?.role === "assistant");
      if (!last) return;
      const text = JSON.stringify(last).slice(0, 8e3);
      const next = extractKeywords(text, cfg.limit);
      const diff = diffKeywords(store.words, next);
      if (diff.add.length === 0 && diff.remove.length === 0) return;
      await uploader.apply(diff);
      store.save(next, store.vocabularyId);
      ctx.logger.info(`[whalemaid-hotwords] \u8BCD\u8868\u66F4\u65B0 +${diff.add.length} -${diff.remove.length}`);
    } catch (err) {
      ctx.logger.warn(`[whalemaid-hotwords] ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const bridge = ctx;
  try {
    bridge.on("host/session-status", (sessionId, status) => {
      const s = typeof status === "object" && status !== null ? status : void 0;
      if (s?.running === false) void onTurnEnd(sessionId);
    });
  } catch {
    ctx.logger.warn("[whalemaid-hotwords] \u65E0\u6CD5\u8BA2\u9605\u4F1A\u8BDD\u4E8B\u4EF6\uFF08\u4E8B\u4EF6\u540D\u672A\u8F6C\u53D1\uFF09");
  }
}
export {
  Config,
  apply,
  inject,
  name
};
