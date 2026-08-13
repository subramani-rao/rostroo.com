import { json } from "../_lib/util.js";

// Temporary diagnostic endpoint. Reveals only whether each secret/binding
// is present and (for the API key) how long it is — never the actual
// values. Safe to leave briefly, but delete this file once the deployment
// issue currently being debugged is resolved; there's no reason to keep
// an environment-inspection endpoint live long-term.
export async function onRequestGet(context) {
  const { env } = context;
  return json({
    hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
    anthropicKeyLength: env.ANTHROPIC_API_KEY ? env.ANTHROPIC_API_KEY.length : 0,
    anthropicKeyStartsCorrectly: env.ANTHROPIC_API_KEY
      ? env.ANTHROPIC_API_KEY.startsWith("sk-ant-")
      : false,
    hasStripeSecretKey: !!env.STRIPE_SECRET_KEY,
    hasStripeWebhookSecret: !!env.STRIPE_WEBHOOK_SECRET,
    siteUrlValue: env.SITE_URL || null,
    hasKvBinding: !!env.ROSTROO_KV,
  });
}
