import { json, intakeKey } from "../_lib/util.js";
import { stripeRequest } from "../_lib/stripe.js";

// POST /api/create-checkout
// Verifies the session token corresponds to a real saved intake, then
// creates a Stripe Checkout Session for the $199 one-time payment and
// returns the hosted checkout URL for the browser to redirect to.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const sessionToken = body.sessionToken;
  if (!sessionToken) return json({ error: "Missing sessionToken" }, 400);

  const stored = await env.ROSTROO_KV.get(intakeKey(sessionToken));
  if (!stored) return json({ error: "We couldn't find your answers — please start again." }, 404);

  const { intake } = JSON.parse(stored);
  const siteUrl = env.SITE_URL || "https://rostroo.com";

  try {
    const session = await stripeRequest(env.STRIPE_SECRET_KEY, "checkout/sessions", {
      mode: "payment",
      client_reference_id: sessionToken,
      customer_email: intake.contactEmail || undefined,
      success_url: `${siteUrl}/success.html?token=${encodeURIComponent(sessionToken)}`,
      cancel_url: `${siteUrl}/questionnaire.html`,
      metadata: { sessionToken },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: 19900,
            product_data: {
              name: "Rostroo Foundational AI Governance Pack",
              description: `AI Governance & Policy Pack for ${intake.companyName || "your company"}`,
            },
          },
        },
      ],
    });

    return json({ checkoutUrl: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: e.message || "Couldn't start checkout" }, 500);
  }
}
