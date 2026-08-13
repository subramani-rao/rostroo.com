import { json } from "../_lib/util.js";
import { verifyStripeSignature } from "../_lib/stripe.js";

// POST /api/webhook
// Stripe calls this directly (not the browser) when a payment event
// happens. We verify the signature to make sure the request genuinely
// came from Stripe, then acknowledge — Stripe expects a fast response and
// will retry (marking the delivery "failed") if we don't answer quickly.
//
// This endpoint deliberately does NOT trigger pack generation anymore.
// It used to, via context.waitUntil(), as a "backup" alongside the
// browser's own foreground call to POST /api/generate-pack — but real
// testing (see the trail in GET /api/debug-pack) proved that backup path
// actively harmful: Cloudflare only gives waitUntil()'d background work a
// short grace period after the response is sent, so the webhook's attempt
// reliably got silently killed mid-call to Anthropic (no exception, the
// isolate is just torn down) — but because it fired first and grabbed the
// "in progress" lock in KV, it blocked the browser's reliable attempt from
// ever running too. The browser calling POST /api/generate-pack directly
// from success.html, in the foreground, is now the only generation
// trigger, and it works reliably because it isn't subject to that limit.
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

  // Nothing else to do here — generation is triggered by the browser
  // (see api/generate-pack.js). We just need to acknowledge receipt.
  return json({ received: true });
}
