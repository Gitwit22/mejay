type D1Database = any;

export interface Env {
  DB: D1Database;
  // Optional safety switch: allow dev-only routes outside localhost.
  ALLOW_DEV_ENDPOINTS?: string;

  // Auth peppers (set these in Cloudflare for production)
  AUTH_CODE_PEPPER?: string;
  SESSION_PEPPER?: string;

  // Email (Resend) for login codes
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

type AccessType = "free" | "pro" | "full_program";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-user-id",
} as const;

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      expires: "0",
      ...corsHeaders,
      ...(init?.headers ?? {}),
    },
  });
}

function normalizeAccessType(raw: unknown): AccessType {
  if (raw === "pro") return "pro";
  if (raw === "full") return "full_program";
  if (raw === "full_program") return "full_program";
  return "free";
}

function toDbAccessType(accessType: unknown): "free" | "pro" | "full" {
  if (accessType === "pro") return "pro";
  if (accessType === "full") return "full";
  if (accessType === "full_program") return "full";
  return "free";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function random6DigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function nowIso() {
  return new Date().toISOString();
}

function addMsIso(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

function parseCookies(req: Request) {
  const raw = req.headers.get("cookie") || "";
  const out: Record<string, string> = {};
  raw.split(";").forEach(part => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}

function isLocalHost(req: Request) {
  const host = new URL(req.url).hostname;
  return host === "127.0.0.1" || host === "localhost";
}

async function sendLoginCodeEmail(args: { env: Env; to: string; code: string; origin: string }) {
  const { env, to, code, origin } = args;

  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  const from = (env.RESEND_FROM ?? "").trim();
  if (!apiKey || !from) return { sent: false as const, reason: "resend_not_configured" as const };

  const subject = "Your MEJay sign-in code";
  const text = `Your MEJay sign-in code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn’t request this, you can ignore this email.\n\n${origin}`;
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5; color: #111">
      <h2 style="margin:0 0 12px 0;">MEJay sign-in</h2>
      <p style="margin:0 0 12px 0;">Your 6-digit code:</p>
      <div style="display:inline-block; padding:12px 16px; border-radius:12px; background:#111; color:#fff; font-size:22px; letter-spacing:6px; font-weight:800;">${code}</div>
      <p style="margin:12px 0 0 0; font-size:12px; color:#555;">Expires in 10 minutes. If you didn’t request this, you can ignore this email.</p>
      <p style="margin:12px 0 0 0; font-size:12px; color:#555;">${origin}</p>
    </div>
  `.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Resend sendLoginCodeEmail failed", res.status, body.slice(0, 500));
      return { sent: false as const, reason: "resend_failed" as const };
    }
    return { sent: true as const };
  } catch (err) {
    console.error("Resend sendLoginCodeEmail threw", err);
    return { sent: false as const, reason: "resend_failed" as const };
  }
}

async function readJson(req: Request) {
  return req.json().catch(() => ({}));
}

function cookieHeaderForLogout(isSecure: boolean): string {
  return [
    `mejay_session=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    isSecure ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

async function getSessionUserId(req: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(req);
  const token = cookies["mejay_session"];
  if (!token) return null;

  const pepper = env.SESSION_PEPPER || "dev-session-pepper";
  const sessionHash = await sha256Hex(`session:${token}:${pepper}`);
  const row = (await env.DB
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(sessionHash)
    .first()) as { user_id: string; expires_at: string } | null;

  if (!row) return null;
  if (row.expires_at < nowIso()) return null;
  return row.user_id;
}

async function deleteSession(req: Request, env: Env): Promise<void> {
  const cookies = parseCookies(req);
  const token = cookies["mejay_session"];
  if (!token) return;
  const pepper = env.SESSION_PEPPER || "dev-session-pepper";
  const sessionHash = await sha256Hex(`session:${token}:${pepper}`);
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(sessionHash).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...corsHeaders } });
    }

    // GET /api/checkout-status
    // Returns { accessType, hasFullAccess } from D1.
    if (url.pathname === "/api/checkout-status" && request.method === "GET") {
      const userId = await getSessionUserId(request, env);
      if (!userId) {
        return json({ accessType: "free", hasFullAccess: false });
      }

      const row = (await env.DB
        .prepare("SELECT access_type, has_full_access FROM entitlements WHERE user_id = ? LIMIT 1")
        .bind(userId)
        .first()) as { access_type: string; has_full_access: number } | null;

      if (!row) {
        return json({ accessType: "free", hasFullAccess: false });
      }

      return json({
        accessType: normalizeAccessType(row.access_type),
        hasFullAccess: Boolean(row.has_full_access),
      });
    }

    // POST /api/auth/start
    if (url.pathname === "/api/auth/start" && request.method === "POST") {
      if (!env.DB) {
        console.error("/api/auth/start missing DB binding");
        return json({ ok: false, error: "db_not_configured" }, { status: 500 });
      }

      try {
        const body = await readJson(request);
        const emailRaw = String((body as any).email || "");
        const email = normalizeEmail(emailRaw);

        if (!email || !email.includes("@")) {
          return json({ ok: false, error: "invalid_email" }, { status: 400 });
        }

        const existing = (await env.DB
          .prepare("SELECT locked_until FROM auth_codes WHERE email = ?")
          .bind(email)
          .first()) as { locked_until: string | null } | null;

        if (existing?.locked_until && existing.locked_until > nowIso()) {
          return json({ ok: false, error: "locked" }, { status: 429 });
        }

        const code = random6DigitCode();
        const pepper = env.AUTH_CODE_PEPPER || "dev-pepper-change-me";
        const codeHash = await sha256Hex(`${email}:${code}:${pepper}`);

        await env.DB
          .prepare(
            [
              "INSERT INTO auth_codes (email, code_hash, expires_at, attempts, locked_until)",
              "VALUES (?, ?, ?, 0, NULL)",
              "ON CONFLICT(email) DO UPDATE SET",
              "code_hash = excluded.code_hash,",
              "expires_at = excluded.expires_at,",
              "attempts = 0,",
              "locked_until = NULL",
            ].join("\n"),
          )
          .bind(email, codeHash, addMsIso(CODE_TTL_MS))
          .run();

        const allowDevReturn = isLocalHost(request) || env.ALLOW_DEV_ENDPOINTS === "true";

        // Send email in production when configured.
        const origin = url.origin;
        const sent = await sendLoginCodeEmail({ env, to: email, code, origin });
        if (!sent.sent && !allowDevReturn) {
          // Don't leak the code if we couldn't email it.
          return json({ ok: false, error: sent.reason ?? "email_failed" }, { status: 500 });
        }

        return json({ ok: true, ...(allowDevReturn ? { devCode: code } : {}) });
      } catch (err) {
        console.error("/api/auth/start failed", err);
        return json({ ok: false, error: "server_error" }, { status: 500 });
      }
    }

    // POST /api/auth/verify
    if (url.pathname === "/api/auth/verify" && request.method === "POST") {
      const body = await readJson(request);
      const email = normalizeEmail(String((body as any).email || ""));
      const code = String((body as any).code || "").trim();

      if (!email || !code) {
        return json({ ok: false, error: "missing" }, { status: 400 });
      }

      const row = (await env.DB
        .prepare("SELECT code_hash, expires_at, attempts, locked_until FROM auth_codes WHERE email = ?")
        .bind(email)
        .first()) as
        | { code_hash: string; expires_at: string; attempts: number; locked_until: string | null }
        | null;

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
        await env.DB
          .prepare("UPDATE auth_codes SET attempts = ?, locked_until = ? WHERE email = ?")
          .bind(newAttempts, lockedUntil, email)
          .run();
        return json({ ok: false, error: "bad_code" }, { status: 400 });
      }

      // Find or create user
      let user = (await env.DB
        .prepare("SELECT id, email FROM users WHERE email = ?")
        .bind(email)
        .first()) as { id: string; email: string } | null;

      if (!user) {
        const userId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO users (id, email) VALUES (?, ?)").bind(userId, email).run();
        user = { id: userId, email };
      }

      // Create session
      const sessionToken = crypto.randomUUID() + crypto.randomUUID();
      const sessionPepper = env.SESSION_PEPPER || "dev-session-pepper";
      const sessionHash = await sha256Hex(`session:${sessionToken}:${sessionPepper}`);
      const expiresAt = addMsIso(SESSION_TTL_MS);

      await env.DB
        .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(sessionHash, user.id, expiresAt)
        .run();

      // Delete code so it can't be reused
      await env.DB.prepare("DELETE FROM auth_codes WHERE email = ?").bind(email).run();

      const secure = new URL(request.url).protocol === "https:";
      const cookie = [
        `mejay_session=${encodeURIComponent(sessionToken)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        secure ? "Secure" : "",
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      ]
        .filter(Boolean)
        .join("; ");

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders,
          "Set-Cookie": cookie,
        },
      });
    }

    // GET /api/account/me
    if (url.pathname === "/api/account/me" && request.method === "GET") {
      const userId = await getSessionUserId(request, env);
      if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

      const user = await env.DB
        .prepare("SELECT id, email, created_at FROM users WHERE id = ?")
        .bind(userId)
        .first();

      const ent = (await env.DB
        .prepare("SELECT access_type, has_full_access FROM entitlements WHERE user_id = ?")
        .bind(userId)
        .first()) as { access_type: string; has_full_access: number } | null;

      return json({
        ok: true,
        user,
        entitlements: ent
          ? { accessType: normalizeAccessType(ent.access_type), hasFullAccess: Boolean(ent.has_full_access) }
          : { accessType: "free", hasFullAccess: false },
      });
    }

    // POST /api/auth/logout
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      await deleteSession(request, env);
      const secure = new URL(request.url).protocol === "https:";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders,
          "Set-Cookie": cookieHeaderForLogout(secure),
        },
      });
    }

    // POST /api/dev/set-entitlement (dev only)
    if (url.pathname === "/api/dev/set-entitlement" && request.method === "POST") {
      const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      const allowDev = isLocalhost || env.ALLOW_DEV_ENDPOINTS === "true";
      if (!allowDev) {
        return json({ error: "Not found" }, { status: 404 });
      }

      const body = await request.json().catch(() => ({} as any));
      const userId = (body?.userId ?? "demo") as string;
      const accessTypeInput = body?.accessType ?? "pro";
      const dbAccessType = toDbAccessType(accessTypeInput);
      const accessType = normalizeAccessType(dbAccessType);
      const hasFullAccessInt = body?.hasFullAccess ? 1 : 0;

      await env.DB
        .prepare(
          [
            "INSERT INTO entitlements (user_id, access_type, has_full_access)",
            "VALUES (?, ?, ?)",
            "ON CONFLICT(user_id) DO UPDATE SET",
            "access_type = excluded.access_type,",
            "has_full_access = excluded.has_full_access,",
            "updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          ].join("\n"),
        )
        .bind(userId, dbAccessType, hasFullAccessInt)
        .run();

      return json({ ok: true, userId, accessType, hasFullAccess: Boolean(hasFullAccessInt) });
    }

    // Simple health check
    if (url.pathname === "/api/health") {
      const row = await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: row?.ok === 1 });
    }

    // List tables (debug)
    if (url.pathname === "/api/db/tables") {
      const { results } = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
        .all();
      return json({ tables: results.map((r: any) => r.name) });
    }

    return new Response("Not found", { status: 404 });
  },
};
