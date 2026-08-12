import { json, intakeKey, sanitizeIntake } from "../_lib/util.js";

// POST /api/save-intake
// Stores the questionnaire answers in KV under a fresh random token and
// hands the token back. The token is later passed through Stripe Checkout
// (client_reference_id) so the webhook can find these answers again once
// payment succeeds.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.companyName || !body.contactEmail || body.contactEmail.indexOf("@") === -1) {
    return json({ error: "Company name and a valid email are required" }, 400);
  }

  const intake = sanitizeIntake(body);

  // Cheap size guard against abuse — real answers are nowhere near this.
  if (JSON.stringify(intake).length > 20000) {
    return json({ error: "Submission too large" }, 400);
  }

  const sessionToken = crypto.randomUUID();

  await env.ROSTROO_KV.put(
    intakeKey(sessionToken),
    JSON.stringify({ intake, createdAt: new Date().toISOString() }),
    { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
  );

  return json({ sessionToken });
}
