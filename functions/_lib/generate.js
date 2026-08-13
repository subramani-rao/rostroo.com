import { intakeKey, packKey } from "./util.js";
import { generateGovernancePack } from "./anthropic.js";

// Shared pack-generation logic, called from two places:
//  1. webhook.js, via context.waitUntil() — fired the moment Stripe confirms
//     payment, as a best-effort background attempt. Cloudflare gives
//     waitUntil()'d background work only a short grace period after a
//     response has already been sent, which has been silently killing
//     generation mid-flight for these longer, multi-document Claude calls —
//     no exception is ever thrown, the isolate is just torn down.
//  2. api/generate-pack.js, called directly (and awaited) by the browser on
//     success.html — the PRIMARY, more reliable path, since it's a normal
//     foreground request rather than backgrounded work.
//
// Both call this with a `source` tag so the debug trail (GET
// /api/debug-pack) shows which one actually did the work. Whichever gets
// there is guarded by an idempotency check below — but that check now
// treats a "processing" status as stale (and safe to retry) if it's older
// than STALE_AFTER_MS, so a webhook attempt that died silently doesn't
// permanently block the browser's retry from ever running.

const STALE_AFTER_MS = 25 * 1000;

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

export async function generateAndStorePack(env, sessionToken, source) {
  await trace(env, sessionToken, "starting", { source });
  try {
    const existingRaw = await env.ROSTROO_KV.get(packKey(sessionToken));
    if (existingRaw) {
      const existing = JSON.parse(existingRaw);

      // Ready or error are terminal — never redo finished work.
      if (existing.status === "ready" || existing.status === "error") {
        await trace(env, sessionToken, "pack already finished, returning it", { source, status: existing.status });
        return existing;
      }

      // "processing" is only a reason to skip if it's recent — otherwise
      // it's almost certainly a webhook attempt that got silently killed,
      // and we should retry rather than defer to it forever.
      const age = existing.startedAt ? Date.now() - new Date(existing.startedAt).getTime() : Infinity;
      if (existing.status === "processing" && age < STALE_AFTER_MS) {
        await trace(env, sessionToken, "another attempt is actively in progress, skipping", { source, ageMs: age });
        return existing;
      }
      await trace(env, sessionToken, "found stale processing status, retrying anyway", { source, ageMs: age });
    }

    await env.ROSTROO_KV.put(
      packKey(sessionToken),
      JSON.stringify({ status: "processing", startedAt: new Date().toISOString() }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
    await trace(env, sessionToken, "wrote processing status, fetching intake", { source });

    const stored = await env.ROSTROO_KV.get(intakeKey(sessionToken));
    if (!stored) throw new Error("No saved intake found for this session token");
    const { intake } = JSON.parse(stored);
    await trace(env, sessionToken, "intake loaded, calling Anthropic", {
      source,
      companyName: intake.companyName,
    });

    const markdown = await generateGovernancePack(env.ANTHROPIC_API_KEY, intake, (step, extra) =>
      trace(env, sessionToken, step, { source, ...extra })
    );
    await trace(env, sessionToken, "Anthropic call succeeded", {
      source,
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
    await trace(env, sessionToken, "wrote ready status", { source });
    return result;
  } catch (e) {
    await trace(env, sessionToken, "FAILED", { source, message: e.message, stack: e.stack });
    const result = { status: "error", error: e.message };
    await env.ROSTROO_KV.put(packKey(sessionToken), JSON.stringify(result), {
      expirationTtl: 60 * 60 * 24 * 7,
    });
    return result;
  }
}
