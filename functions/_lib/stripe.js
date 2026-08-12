// Minimal Stripe REST API helper for Cloudflare Pages Functions.
//
// We deliberately don't use the official Stripe npm SDK here: Pages
// Functions run on the Workers runtime (not Node.js), and pulling in the
// SDK would require an npm build step. Stripe's API is plain REST + form
// encoding, so a small fetch-based helper keeps this repo dependency-free
// and deployable exactly like the rest of the site — push and go.

/**
 * Flattens a nested JS object into Stripe's bracket-notation form encoding,
 * e.g. { line_items: [{ price_data: { currency: "usd" } }] } becomes
 * "line_items[0][price_data][currency]=usd".
 */
function flattenForStripe(obj, prefix, out) {
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => flattenForStripe(item, `${prefix}[${i}]`, out));
  } else if (obj !== null && typeof obj === "object") {
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      const nextPrefix = prefix ? `${prefix}[${key}]` : key;
      flattenForStripe(value, nextPrefix, out);
    });
  } else if (obj !== undefined && obj !== null) {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(obj)}`);
  }
}

function toFormBody(obj) {
  const out = [];
  flattenForStripe(obj, "", out);
  return out.join("&");
}

export async function stripeRequest(secretKey, path, params) {
  const resp = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: toFormBody(params),
  });
  const data = await resp.json();
  if (!resp.ok) {
    const message = (data && data.error && data.error.message) || "Stripe API error";
    throw new Error(message);
  }
  return data;
}

/**
 * Verifies a Stripe webhook signature without the Stripe SDK, using the
 * Web Crypto API (available natively in Cloudflare Workers).
 * Throws if the signature is missing, malformed, or doesn't match.
 */
export async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader) throw new Error("Missing Stripe-Signature header");

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((pair) => {
      const [k, v] = pair.split("=");
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error("Malformed Stripe-Signature header");

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const macBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(macBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signature.length) throw new Error("Stripe signature mismatch");
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (mismatch !== 0) throw new Error("Stripe signature mismatch");

  // Reject events older than 5 minutes to reduce replay risk.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > 300) throw new Error("Stripe webhook timestamp too old");
}
