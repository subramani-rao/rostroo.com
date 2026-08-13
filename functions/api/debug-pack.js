import { json, packKey } from "../_lib/util.js";

// GET /api/debug-pack?token=<sessionToken>
// Temporary diagnostic endpoint: returns both the pack's current KV status
// AND a step-by-step trail of what the background generation job actually
// did, written directly to KV as it runs (see webhook.js's trace()).
// This exists because Cloudflare Pages projects don't expose a dashboard
// toggle for Observability/logs, so we're using KV itself as the log.
// Safe to delete once the generation flow is confirmed working.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) return json({ error: "missing token" }, 400);

  const packRaw = await env.ROSTROO_KV.get(packKey(token));
  const debugRaw = await env.ROSTROO_KV.get(`debug:${token}`);

  return json({
    pack: packRaw ? JSON.parse(packRaw) : null,
    trail: debugRaw ? JSON.parse(debugRaw) : null,
  });
}
