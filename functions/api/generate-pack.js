import { json, intakeKey } from "../_lib/util.js";
import { generateAndStorePack } from "../_lib/generate.js";

// POST /api/generate-pack
// Called by success.html right after Stripe redirects the customer back,
// and awaited there — this is the PRIMARY generation trigger (see the
// comment in webhook.js for why the webhook's background attempt alone
// isn't reliable). Runs as a normal foreground request, so it isn't
// subject to the short post-response grace period that was silently
// killing generation when it only ran via context.waitUntil().
//
// Safe to call more than once for the same token (idempotent — see
// generateAndStorePack), and safe to call for a token that hasn't been
// paid for yet, since it will simply find no saved intake and return an
// error rather than generating anything.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ status: "error", error: "Invalid request body" }, 400);
  }

  const token = body && body.token;
  if (!token) return json({ status: "error", error: "Missing token" }, 400);

  // Only proceed if we actually have a saved intake for this token — this
  // means someone filled in the questionnaire and got as far as save-intake,
  // not that they necessarily paid. The real payment gate is that Stripe
  // only ever redirects to success.html?token=... after a completed
  // Checkout Session, and the webhook is what we treat as the source of
  // truth for "did they actually pay." This endpoint's job is only to make
  // sure generation actually runs and finishes in a reasonable time.
  const stored = await env.ROSTROO_KV.get(intakeKey(token));
  if (!stored) {
    return json({ status: "not_found" }, 404);
  }

  const result = await generateAndStorePack(env, token);
  return json(result);
}
