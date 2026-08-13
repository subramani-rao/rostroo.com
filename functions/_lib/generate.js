import { intakeKey, packKey } from "./util.js";
import { generateGovernancePack } from "./anthropic.js";

// Shared pack-generation logic, called from two places:
//  1. webhook.js, via context.waitUntil() — fired the moment Stripe confirms
//     payment, as a best-effort background attempt.
//  2. api/generate-pack.js, called directly (and awaited) by the browser on
//     success.html — this is now the PRIMARY path. Cloudflare gives
//     waitUntil()'d background work only a short grace period (roughly 30
//     seconds) after a response has already been sent, which was silently
//     killing generation mid-flight for these longer, multi-document Claude
//     calls with no error ever being thrown — the isolate is torn down, not
//     an exception. A normal foreground request (the browser actively
//     waiting on this endpoint) doesn't have that same post-response grace
//     period limit, so it reliably has enough time to finish.
// Both calls are idempotent (guarded by the "does a pack already exist"
// check below), so it's safe for both to fire for the same purchase.

function debugKey(token) {
  return `debug:${token}`;
}

// Cloudflare Pages projects don't expose an observability/logs toggle in
// the dashboard, so alongside console.log we also write a step-by-step
// trail directly into KV — readable via GET /api/debug-pack?token=...
// without depending on Cloudflare's own logging UI at all.
async function trace(env, sessionToken, step, extra) {
  try {
    const key = debugKey(sessionToken);
    const existingRaw = await env.ROSTROO_KV.get(key);
    const entries = existingRaw ? JSON.parse(existingRaw) : [];
    entries.push({ t: new Date().toISOString(), step, ...extra });
    await env.ROSTROO_KV.put(key, JSON.stringify(entries), { expirationTtl: 60 * 60 * 24 });
  } catch (e) {
    console.error("trace() failed:", e.message);
  }
  console.log(step, extra || {});
}

export async function generateAndStorePack(env, sessionToken) {
  await trace(env, sessionToken, "starting");
  try {
    // Idempotency: if we've already generated (or started) a pack for this
    // token — e.g. both the webhook and the browser trigger this, or Stripe
    // re-sends the webhook — don't do it twice.
    const existing = await env.ROSTROO_KV.get(packKey(sessionToken));
    if (existing) {
      await trace(env, sessionToken, "pack already exists, skipping", { existing });
      return JSON.parse(existing);
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

    const result = {
      status: "ready",
      markdown,
      companyName: intake.companyName,
      generatedAt: new Date().toISOString(),
    };

    await env.ROSTROO_KV.put(packKey(sessionToken), JSON.stringify(result), {
      expirationTtl: 60 * 60 * 24 * 30, // 30 days
    });
    await trace(env, sessionToken, "wrote ready status");
    return result;
  } catch (e) {
    await trace(env, sessionToken, "FAILED", { message: e.message, stack: e.stack });
    const result = { status: "error", error: e.message };
    await env.ROSTROO_KV.put(packKey(sessionToken), JSON.stringify(result), {
      expirationTtl: 60 * 60 * 24 * 7,
    });
    return result;
  }
}
