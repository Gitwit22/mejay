var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.ts
var CODE_TTL_MS = 10 * 60 * 1e3;
var MAX_ATTEMPTS = 5;
var LOCKOUT_MS = 15 * 60 * 1e3;
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-user-id"
};
function json(body, init) {
  return Response.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      expires: "0",
      ...corsHeaders,
      ...init?.headers ?? {}
    }
  });
}
__name(json, "json");
function normalizeAccessType(raw) {
  if (raw === "pro") return "pro";
  if (raw === "full") return "full_program";
  if (raw === "full_program") return "full_program";
  return "free";
}
__name(normalizeAccessType, "normalizeAccessType");
function toDbAccessType(accessType) {
  if (accessType === "pro") return "pro";
  if (accessType === "full") return "full";
  if (accessType === "full_program") return "full";
  return "free";
}
__name(toDbAccessType, "toDbAccessType");
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function random6DigitCode() {
  return String(Math.floor(1e5 + Math.random() * 9e5));
}
__name(random6DigitCode, "random6DigitCode");
async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function addMsIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}
__name(addMsIso, "addMsIso");
function parseCookies(req) {
  const raw = req.headers.get("cookie") || "";
  const out = {};
  raw.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}
__name(parseCookies, "parseCookies");
function isLocalHost(req) {
  const host = new URL(req.url).hostname;
  return host === "127.0.0.1" || host === "localhost";
}
__name(isLocalHost, "isLocalHost");
async function readJson(req) {
  return req.json().catch(() => ({}));
}
__name(readJson, "readJson");
function cookieHeaderForLogout(isSecure) {
  return [
    `mejay_session=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    isSecure ? "Secure" : "",
    "Max-Age=0"
  ].filter(Boolean).join("; ");
}
__name(cookieHeaderForLogout, "cookieHeaderForLogout");
async function getSessionUserId(req, env) {
  const cookies = parseCookies(req);
  const token = cookies["mejay_session"];
  if (!token) return null;
  const pepper = env.SESSION_PEPPER || "dev-session-pepper";
  const sessionHash = await sha256Hex(`session:${token}:${pepper}`);
  const row = await env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").bind(sessionHash).first();
  if (!row) return null;
  if (row.expires_at < nowIso()) return null;
  return row.user_id;
}
__name(getSessionUserId, "getSessionUserId");
async function deleteSession(req, env) {
  const cookies = parseCookies(req);
  const token = cookies["mejay_session"];
  if (!token) return;
  const pepper = env.SESSION_PEPPER || "dev-session-pepper";
  const sessionHash = await sha256Hex(`session:${token}:${pepper}`);
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(sessionHash).run();
}
__name(deleteSession, "deleteSession");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...corsHeaders } });
    }
    if (url.pathname === "/api/checkout-status" && request.method === "GET") {
      const userId = await getSessionUserId(request, env);
      if (!userId) {
        return json({ accessType: "free", hasFullAccess: false });
      }
      const row = await env.DB.prepare("SELECT access_type, has_full_access FROM entitlements WHERE user_id = ? LIMIT 1").bind(userId).first();
      if (!row) {
        return json({ accessType: "free", hasFullAccess: false });
      }
      return json({
        accessType: normalizeAccessType(row.access_type),
        hasFullAccess: Boolean(row.has_full_access)
      });
    }
    if (url.pathname === "/api/auth/start" && request.method === "POST") {
      const body = await readJson(request);
      const emailRaw = String(body.email || "");
      const email = normalizeEmail(emailRaw);
      if (!email || !email.includes("@")) {
        return json({ ok: false, error: "invalid_email" }, { status: 400 });
      }
      const existing = await env.DB.prepare("SELECT locked_until FROM auth_codes WHERE email = ?").bind(email).first();
      if (existing?.locked_until && existing.locked_until > nowIso()) {
        return json({ ok: false, error: "locked" }, { status: 429 });
      }
      const code = random6DigitCode();
      const pepper = env.AUTH_CODE_PEPPER || "dev-pepper-change-me";
      const codeHash = await sha256Hex(`${email}:${code}:${pepper}`);
      await env.DB.prepare(
        [
          "INSERT INTO auth_codes (email, code_hash, expires_at, attempts, locked_until)",
          "VALUES (?, ?, ?, 0, NULL)",
          "ON CONFLICT(email) DO UPDATE SET",
          "code_hash = excluded.code_hash,",
          "expires_at = excluded.expires_at,",
          "attempts = 0,",
          "locked_until = NULL"
        ].join("\n")
      ).bind(email, codeHash, addMsIso(CODE_TTL_MS)).run();
      const allowDevReturn = isLocalHost(request) || env.ALLOW_DEV_ENDPOINTS === "true";
      return json({ ok: true, ...allowDevReturn ? { devCode: code } : {} });
    }
    if (url.pathname === "/api/auth/verify" && request.method === "POST") {
      const body = await readJson(request);
      const email = normalizeEmail(String(body.email || ""));
      const code = String(body.code || "").trim();
      if (!email || !code) {
        return json({ ok: false, error: "missing" }, { status: 400 });
      }
      const row = await env.DB.prepare("SELECT code_hash, expires_at, attempts, locked_until FROM auth_codes WHERE email = ?").bind(email).first();
      if (!row) return json({ ok: false, error: "no_code" }, { status: 400 });
      if (row.locked_until && row.locked_until > nowIso()) {
        return json({ ok: false, error: "locked" }, { status: 429 });
      }
      if (row.expires_at < nowIso()) {
        return json({ ok: false, error: "expired" }, { status: 400 });
      }
      const pepper = env.AUTH_CODE_PEPPER || "dev-pepper-change-me";
      const attemptHash = await sha256Hex(`${email}:${code}:${pepper}`);
      if (attemptHash !== row.code_hash) {
        const newAttempts = (row.attempts ?? 0) + 1;
        const lockedUntil = newAttempts >= MAX_ATTEMPTS ? addMsIso(LOCKOUT_MS) : null;
        await env.DB.prepare("UPDATE auth_codes SET attempts = ?, locked_until = ? WHERE email = ?").bind(newAttempts, lockedUntil, email).run();
        return json({ ok: false, error: "bad_code" }, { status: 400 });
      }
      let user = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first();
      if (!user) {
        const userId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO users (id, email) VALUES (?, ?)").bind(userId, email).run();
        user = { id: userId, email };
      }
      const sessionToken = crypto.randomUUID() + crypto.randomUUID();
      const sessionPepper = env.SESSION_PEPPER || "dev-session-pepper";
      const sessionHash = await sha256Hex(`session:${sessionToken}:${sessionPepper}`);
      const expiresAt = addMsIso(SESSION_TTL_MS);
      await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(sessionHash, user.id, expiresAt).run();
      await env.DB.prepare("DELETE FROM auth_codes WHERE email = ?").bind(email).run();
      const secure = new URL(request.url).protocol === "https:";
      const cookie = [
        `mejay_session=${encodeURIComponent(sessionToken)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        secure ? "Secure" : "",
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1e3)}`
      ].filter(Boolean).join("; ");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders,
          "Set-Cookie": cookie
        }
      });
    }
    if (url.pathname === "/api/account/me" && request.method === "GET") {
      const userId = await getSessionUserId(request, env);
      if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
      const user = await env.DB.prepare("SELECT id, email, created_at FROM users WHERE id = ?").bind(userId).first();
      const ent = await env.DB.prepare("SELECT access_type, has_full_access FROM entitlements WHERE user_id = ?").bind(userId).first();
      return json({
        ok: true,
        user,
        entitlements: ent ? { accessType: normalizeAccessType(ent.access_type), hasFullAccess: Boolean(ent.has_full_access) } : { accessType: "free", hasFullAccess: false }
      });
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      await deleteSession(request, env);
      const secure = new URL(request.url).protocol === "https:";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders,
          "Set-Cookie": cookieHeaderForLogout(secure)
        }
      });
    }
    if (url.pathname === "/api/dev/set-entitlement" && request.method === "POST") {
      const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      const allowDev = isLocalhost || env.ALLOW_DEV_ENDPOINTS === "true";
      if (!allowDev) {
        return json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json().catch(() => ({}));
      const userId = body?.userId ?? "demo";
      const accessTypeInput = body?.accessType ?? "pro";
      const dbAccessType = toDbAccessType(accessTypeInput);
      const accessType = normalizeAccessType(dbAccessType);
      const hasFullAccessInt = body?.hasFullAccess ? 1 : 0;
      await env.DB.prepare(
        [
          "INSERT INTO entitlements (user_id, access_type, has_full_access)",
          "VALUES (?, ?, ?)",
          "ON CONFLICT(user_id) DO UPDATE SET",
          "access_type = excluded.access_type,",
          "has_full_access = excluded.has_full_access,",
          "updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
        ].join("\n")
      ).bind(userId, dbAccessType, hasFullAccessInt).run();
      return json({ ok: true, userId, accessType, hasFullAccess: Boolean(hasFullAccessInt) });
    }
    if (url.pathname === "/api/health") {
      const row = await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: row?.ok === 1 });
    }
    if (url.pathname === "/api/db/tables") {
      const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all();
      return json({ tables: results.map((r) => r.name) });
    }
    return new Response("Not found", { status: 404 });
  }
};

// ../../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-avKh3R/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-avKh3R/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
