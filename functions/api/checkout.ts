// functions/api/checkout.ts

type Plan = "pro" | "full_program";

type Env = {
  STRIPE_SECRET_KEY: string;
  STRIPE_PRICE_PRO: string;
  STRIPE_PRICE_FULL_PROGRAM: string;
};

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
    throw new Error(`Stripe API error (${res.status}): ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  // CORS preflight
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const plan = body?.plan as Plan | undefined;
  if (plan !== "pro" && plan !== "full_program") {
    return json({ error: `Invalid plan. Use "pro" | "full_program".` }, 400);
  }

  const secretKey = env.STRIPE_SECRET_KEY;
  const proPrice = env.STRIPE_PRICE_PRO;
  const fullPrice = env.STRIPE_PRICE_FULL_PROGRAM;

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

  // Stripe Checkout mode
  const mode = isPro ? "subscription" : "payment";

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

    const session = await stripePost(secretKey, "/v1/checkout/sessions", params);
    const redirectUrl: string | undefined = session?.url;
    if (!redirectUrl) return json({ error: "No checkout URL returned" }, 500);
    return json({ url: redirectUrl }, 200);
  } catch (err: any) {
    return json({ error: err?.message ?? "Stripe error" }, 500);
  }
};
