import { json } from "../_lib/util.js";
import { verifyStripeSignature } from "../_lib/stripe.js";
import { generateAndStorePack } from "../_lib/generate.js";

// POST /api/webhook
// Stripe calls this directly (not the browser) when a payment event
// happens. We verify the signature to make sure the request genuinely
// came from Stripe, then — only on a successful payment — kick off pack
// generation as a best-effort background attempt via waitUntil() and
// acknowledge immediately, since Stripe expects a fast response.
//
// This is now a BACKUP path, not the primary one: Cloudflare only gives
// waitUntil()'d background work a short grace period (roughly 30 seconds)
// after the response has been sent, which isn't reliably enough time for a
// multi-document Claude generation call — it gets silently killed with no
// error. The primary generation trigger is now the browser itself, calling
// POST /api/generate-pack from success.html and awaiting it in the
// foreground, which doesn't have that same limit. Both call the same
// idempotent generateAndStorePack(), so whichever finishes first wins and
// the other becomes a no-op.
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
      console.log("Scheduling pack generation via waitUntil (backup path)", { sessionToken });
      context.waitUntil(generateAndStorePack(env, sessionToken, "webhook"));
    } else {
      console.error("checkout.session.completed with no sessionToken — cannot generate pack");
    }
  }

  // Acknowledge quickly regardless of generation outcome — Stripe only
  // needs to know we received the event.
  return json({ received: true });
}
