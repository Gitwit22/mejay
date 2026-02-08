// functions/api/checkout.ts

type Plan = "pro" | "full_program";

type CheckoutRequestBody = {
  plan?: Plan;
  /** Opaque client-generated token to help bind session verification to the initiating browser. */
  checkoutToken?: string;
};

type Env = {
  STRIPE_SECRET_KEY: string;
  STRIPE_PRICE_PRO: string;
  STRIPE_PRICE_FULL_PROGRAM: string;
  DB: any;
  SESSION_PEPPER?: string;
};

async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseCookies(req: Request) {
  const raw = req.headers.get('cookie') || '';
  const out: Record<string, string> = {};
  raw.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(v.join('=') || '');
  });
  return out;
}

async function getSessionUserId(req: Request, env: Pick<Env, 'DB' | 'SESSION_PEPPER'>) {
  const cookies = parseCookies(req);
  const token = cookies['mejay_session'];
  if (!token) return null;
  const pepper = env.SESSION_PEPPER || 'dev-session-pepper';
  const sessionHash = await sha256Hex(`session:${token}:${pepper}`);
  const row = (await env.DB
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?1')
    .bind(sessionHash)
    .first()) as {user_id: string; expires_at: string} | null;
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) return null;
  return row.user_id;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

async function stripePost(secretKey: string, path: string, body: URLSearchParams): Promise<any> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text) as any;
      const parsedMessage = parsed?.error?.message;
      if (typeof parsedMessage === "string" && parsedMessage.trim()) {
        message = parsedMessage;
      }
    } catch {
      // ignore
    }

    throw new Error(message);
  }
  return JSON.parse(text);
}

export const onRequest = async (ctx: {request: Request; env: Env}) => {
  const { request, env } = ctx;

  // CORS preflight
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = (await request.json()) as CheckoutRequestBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const plan = body?.plan as Plan | undefined;
  if (plan !== "pro" && plan !== "full_program") {
    return json({ error: `Invalid plan. Use "pro" | "full_program".` }, 400);
  }

  const checkoutToken = typeof body?.checkoutToken === 'string' ? body.checkoutToken.trim() : '';

  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const proPrice = env.STRIPE_PRICE_PRO?.trim();
  const fullPrice = env.STRIPE_PRICE_FULL_PROGRAM?.trim();

  if (!secretKey || !proPrice || !fullPrice) {
    return json({
      error:
        "Missing env vars. Required: STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_FULL_PROGRAM",
    }, 500);
  }

  // Build absolute origin from request
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  const isPro = plan === "pro";
  const priceId = isPro ? proPrice : fullPrice;

  if (!priceId.startsWith("price_")) {
    return json(
      {
        error:
          "Invalid Stripe price id. STRIPE_PRICE_PRO / STRIPE_PRICE_FULL_PROGRAM must be a Price ID that starts with 'price_'.",
      },
      500,
    );
  }

  // Stripe Checkout mode
  const mode = isPro ? "subscription" : "payment";

  // Critical: bind checkout to logged-in user.
  const userId = await getSessionUserId(request, env);
  if (!userId) {
    return json({ error: 'Login required' }, 401);
  }

  try {
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    // Include the session id so the app can verify purchase and unlock features.
    // Stripe will replace {CHECKOUT_SESSION_ID} with the real ID.
    params.set("success_url", `${origin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${origin}/pricing?checkout=cancel`);
    params.set("metadata[plan]", plan);
    params.set('client_reference_id', userId);
    params.set('metadata[userId]', userId);
    if (checkoutToken) {
      params.set('metadata[checkoutToken]', checkoutToken);
    }

    const session = await stripePost(secretKey, "/v1/checkout/sessions", params);
    const redirectUrl: string | undefined = session?.url;
    if (!redirectUrl) return json({ error: "No checkout URL returned" }, 500);
    return json({ url: redirectUrl }, 200);
  } catch (err: any) {
    return json({ error: err?.message ?? "Stripe error" }, 500);
  }
};
