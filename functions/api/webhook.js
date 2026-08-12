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

  if (event.type === "checkout.session.completed") {
    const session = event.data && event.data.object;
    const sessionToken =
      (session && session.client_reference_id) ||
      (session && session.metadata && session.metadata.sessionToken);

    if (sessionToken) {
      context.waitUntil(generateAndStorePack(env, sessionToken));
    } else {
      console.error("checkout.session.completed with no sessionToken — cannot generate pack");
    }
  }

  // Acknowledge quickly regardless of generation outcome — Stripe only
  // needs to know we received the event.
  return json({ received: true });
}

async function generateAndStorePack(env, sessionToken) {
  try {
    // Idempotency: if we've already generated (or started) a pack for this
    // token — e.g. Stripe re-sent the webhook — don't do it twice.
    const existing = await env.ROSTROO_KV.get(packKey(sessionToken));
    if (existing) return;

    await env.ROSTROO_KV.put(
      packKey(sessionToken),
      JSON.stringify({ status: "processing" }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );

    const stored = await env.ROSTROO_KV.get(intakeKey(sessionToken));
    if (!stored) throw new Error("No saved intake found for this session token");
    const { intake } = JSON.parse(stored);

    const markdown = await generateGovernancePack(env.ANTHROPIC_API_KEY, intake);

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
  } catch (e) {
    console.error("Pack generation failed:", e.message);
    await env.ROSTROO_KV.put(
      packKey(sessionToken),
      JSON.stringify({ status: "error", error: e.message }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
  }
}
