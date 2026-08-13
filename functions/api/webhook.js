import { json, intakeKey, packKey } from "../_lib/util.js";
import { verifyStripeSignature } from "../_lib/stripe.js";
import { generateGovernancePack } from "../_lib/anthropic.js";

// POST /api/webhook
// Stripe calls this directly (not the browser) when a payment event
// happens. We verify the signature to make sure the request genuinely
// came from Stripe, then — only on a successful payment — kick off pack
// generation in the background and acknowledge immediately. Generation
// takes 10-30 seconds; Stripe expects a fast response, so we use
// waitUntil() to keep working after responding rather than making Stripe
// wait (and potentially retry) on a slow synchronous response.
export async function onRequestPost(context) {
  const { request, env } = context;

  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  try {
    await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Webhook signature verification failed:", e.message);
    return json({ error: "Invalid signature" }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return json({ error: "Invalid payload" }, 400);
  }

  console.log("Webhook received event", { type: event.type });

  if (event.type === "checkout.session.completed") {
    const session = event.data && event.data.object;
    const sessionToken =
      (session && session.client_reference_id) ||
      (session && session.metadata && session.metadata.sessionToken);

    if (sessionToken) {
      console.log("Scheduling pack generation via waitUntil", { sessionToken });
      context.waitUntil(generateAndStorePack(env, sessionToken));
    } else {
      console.error("checkout.session.completed with no sessionToken — cannot generate pack");
    }
  }

  // Acknowledge quickly regardless of generation outcome — Stripe only
  // needs to know we received the event.
  return json({ received: true });
}

// Cloudflare's own log dashboard has been unreliable to depend on for this
// (Pages projects don't expose an observability toggle in the dashboard UI
// at all). So instead of relying solely on console.log, we also write a
// running trail of what happened directly into KV — the one piece of this
// stack we've already proven works end to end. GET /api/debug-pack?token=
// reads it back. Safe to remove once the flow is fully working.
function debugKey(token) {
  return `debug:${token}`;
}

async function trace(env, sessionToken, step, extra) {
  try {
    const key = debugKey(sessionToken);
    const existingRaw = await env.ROSTROO_KV.get(key);
    const entries = existingRaw ? JSON.parse(existingRaw) : [];
    entries.push({ t: new Date().toISOString(), step, ...extra });
    await env.ROSTROO_KV.put(key, JSON.stringify(entries), { expirationTtl: 60 * 60 * 24 });
  } catch (e) {
    // Never let tracing itself break the real flow.
    console.error("trace() failed:", e.message);
  }
  console.log(step, extra || {});
}

async function generateAndStorePack(env, sessionToken) {
  await trace(env, sessionToken, "starting");
  try {
    // Idempotency: if we've already generated (or started) a pack for this
    // token — e.g. Stripe re-sent the webhook — don't do it twice.
    const existing = await env.ROSTROO_KV.get(packKey(sessionToken));
    if (existing) {
      await trace(env, sessionToken, "pack already exists, skipping", { existing });
      return;
    }

    await env.ROSTROO_KV.put(
      packKey(sessionToken),
      JSON.stringify({ status: "processing" }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
    await trace(env, sessionToken, "wrote processing status, fetching intake");

    const stored = await env.ROSTROO_KV.get(intakeKey(sessionToken));
    if (!stored) throw new Error("No saved intake found for this session token");
    const { intake } = JSON.parse(stored);
    await trace(env, sessionToken, "intake loaded, calling Anthropic", {
      companyName: intake.companyName,
    });

    const markdown = await generateGovernancePack(env.ANTHROPIC_API_KEY, intake, (step, extra) =>
      trace(env, sessionToken, step, extra)
    );
    await trace(env, sessionToken, "Anthropic call succeeded", {
      markdownLength: markdown.length,
    });

    await env.ROSTROO_KV.put(
      packKey(sessionToken),
      JSON.stringify({
        status: "ready",
        markdown,
        companyName: intake.companyName,
        generatedAt: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 30 } // 30 days
    );
    await trace(env, sessionToken, "wrote ready status");
  } catch (e) {
    await trace(env, sessionToken, "FAILED", { message: e.message, stack: e.stack });
    await env.ROSTROO_KV.put(
      packKey(sessionToken),
      JSON.stringify({ status: "error", error: e.message }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
  }
}
