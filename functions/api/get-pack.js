import { json, intakeKey, packKey } from "../_lib/util.js";

// GET /api/get-pack?token=<sessionToken>
// Polled by success.html after Stripe redirects the customer back. The
// token has 122 bits of randomness (crypto.randomUUID()) and functions as
// the customer's access credential for their own pack — nobody else can
// realistically guess it, which is the standard pattern for guest-checkout
// download links with no account/login system.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) return json({ status: "not_found" }, 400);

  const packRaw = await env.ROSTROO_KV.get(packKey(token));
  if (packRaw) {
    const pack = JSON.parse(packRaw);
    return json(pack);
  }

  // No pack yet — check whether the intake at least exists, so we can
  // distinguish "still waiting on the webhook" from "bad/unknown token".
  const intakeRaw = await env.ROSTROO_KV.get(intakeKey(token));
  if (intakeRaw) return json({ status: "processing" });

  return json({ status: "not_found" }, 404);
}
