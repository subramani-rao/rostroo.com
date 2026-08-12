# Rostroo — AI Governance & Policy Pack Builder

A self-serve product: a visitor answers a guided questionnaire, pays $199
via Stripe, and instantly receives an AI-generated first-draft "AI
Governance & Policy Pack" (Acceptable Use Policy, System Inventory,
Third-Party Vendor Risk Checklist, EU AI Act Article 50 Transparency
Statement, Incident Response Playbook Addendum). No login, no
subscription, no human in the loop per sale.

```
rostroo/
├── index.html              # landing page + free "AI Risk Classification Check"
├── questionnaire.html       # paid guided intake wizard
├── success.html             # post-payment page: polls for and shows the pack
├── css/styles.css
├── js/
│   ├── quiz.js               # free risk-classifier logic (no API calls, no cost)
│   ├── questionnaire.js      # wizard steps + calls save-intake / create-checkout
│   └── success.js            # polls get-pack, renders markdown, print/export
├── functions/
│   ├── _lib/
│   │   ├── stripe.js          # Stripe REST calls + webhook signature verification
│   │   ├── anthropic.js       # server-side Claude call + the governance-pack prompt
│   │   └── util.js            # KV helpers, response helpers, input sanitising
│   └── api/
│       ├── save-intake.js      # POST: stores questionnaire answers in KV
│       ├── create-checkout.js  # POST: creates a Stripe Checkout Session
│       ├── webhook.js          # POST: Stripe calls this on successful payment
│       └── get-pack.js         # GET: polled by success.html
├── assets/favicon.svg
└── README.md                  # this file
```

This is **not** a plain static site like the previous Whalper Resilience
build — the `functions/` folder needs a real backend host (Cloudflare
Pages), not GitHub Pages, because it needs to keep your Stripe and
Anthropic secret keys hidden and needs a small amount of server-side
storage (Cloudflare KV) to bridge "someone filled in a form" and "someone
paid" a few seconds apart.

## How a sale actually flows, end to end

1. Visitor fills in the questionnaire on `questionnaire.html`.
2. Browser calls `POST /api/save-intake` → answers are stored in
   Cloudflare KV under a random token; the token comes back to the
   browser.
3. Browser calls `POST /api/create-checkout` with that token → this
   creates a Stripe Checkout Session for $199 and returns Stripe's
   hosted checkout URL. The browser redirects there.
4. Customer pays on Stripe's own page (you never see or touch card
   details — Stripe handles that entirely).
5. Stripe redirects the customer back to `success.html?token=...` **and**,
   separately and more importantly, calls `POST /api/webhook` directly
   server-to-server to tell you the payment succeeded.
6. The webhook function verifies the request genuinely came from Stripe
   (via signature verification), then kicks off pack generation in the
   background: it looks up the saved answers, calls the Anthropic API
   with your key (kept secret, server-side only), and stores the
   generated pack back in KV.
7. Meanwhile, `success.html` polls `GET /api/get-pack` every few seconds
   until the pack is ready, then renders it and offers download/print.

Step 5 happening via **both** a browser redirect and a separate webhook
call is deliberate, not redundant: the browser redirect is what the
*customer* sees, but it isn't reliable on its own (they might close the
tab before it loads). The webhook is what actually triggers generation,
because Stripe guarantees it'll call that endpoint when payment succeeds,
regardless of what the customer's browser does afterward.

## 1. Push this to GitHub

```bash
cd rostroo
git init
git add .
git commit -m "Initial Rostroo AI Governance Pack Builder"
git branch -M main
git remote add origin https://github.com/<your-username>/rostroo.git
git push -u origin main
```

## 2. Create the Cloudflare Pages project

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages
   → Connect to Git**, and pick the `rostroo` repo.
2. Build settings: **Framework preset: None**, **Build command: (leave
   blank)**, **Build output directory: `/`** (the repo root — there's no
   build step, it's all plain files).
3. Deploy. Cloudflare will give you a working URL immediately, something
   like `rostroo.pages.dev` — everything below can be tested there before
   you touch DNS or the real domain.

## 3. Create the KV namespace and bind it

KV is Cloudflare's small key-value store — this is where questionnaire
answers and generated packs live temporarily (7 and 30 days respectively,
then they auto-expire).

1. In the dashboard: **Workers & Pages → KV → Create namespace**, name it
   `rostroo-kv` (any name is fine).
2. Go to your Pages project → **Settings → Functions → KV namespace
   bindings → Add binding**.
3. Variable name: `ROSTROO_KV` (must match exactly — this is the name
   used throughout the code). Namespace: the one you just created.
4. Save, and redeploy if prompted.

## 4. Add your secrets

Still in your Pages project: **Settings → Environment variables**. Add
these as **Secret** (not plain text) for the **Production** environment:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic key (`sk-ant-...`) |
| `STRIPE_SECRET_KEY` | Your Stripe **secret** key — starts `sk_test_...` while testing, `sk_live_...` when live |
| `STRIPE_WEBHOOK_SECRET` | See step 6 below — you'll come back and add this after creating the webhook |
| `SITE_URL` | `https://<your-project>.pages.dev` for now; change to `https://rostroo.com` once the domain is live |

None of these are ever sent to your browser or visible to a customer —
they only exist inside the Cloudflare Functions that run on Cloudflare's
servers.

## 5. Get your Stripe keys (test mode first)

In the Stripe dashboard, make sure you're in **Test mode** (toggle, top
right) while you're getting this working — test mode uses fake card
numbers and charges no real money.

**Developers → API keys** gives you your test secret key
(`sk_test_...`) — put that in `STRIPE_SECRET_KEY` from step 4.

## 6. Create the Stripe webhook

This has to happen *after* your Cloudflare Pages URL exists, because
Stripe needs a real URL to call.

1. In Stripe (still in Test mode): **Developers → Webhooks → Add
   endpoint**.
2. Endpoint URL: `https://<your-project>.pages.dev/api/webhook`
3. Events to send: select **`checkout.session.completed`** (just that
   one is enough for this build).
4. Save. Stripe will show you a **Signing secret** (`whsec_...`) — copy
   it and add it as `STRIPE_WEBHOOK_SECRET` in Cloudflare (step 4),
   then redeploy.

## 7. Test the whole flow in Stripe test mode

1. Visit your `*.pages.dev` URL, click through to the questionnaire, fill
   it in, and click **Pay $199 & generate my pack**.
2. On Stripe's checkout page, use a test card: `4242 4242 4242 4242`, any
   future expiry date, any 3-digit CVC, any postcode.
3. You should land on `success.html`, see the spinner, and within
   15–30 seconds see your generated pack. Check the `[NEEDS INPUT]` flags
   look right, and that the content is actually tailored to what you
   typed in — not generic.
4. In the Stripe dashboard, **Developers → Webhooks → your endpoint**,
   confirm the event shows as delivered successfully (not failed/retried).
5. Try **Download .md** and **Print / Save PDF**.

If generation fails, check **Workers & Pages → your project → Functions
→ Real-time Logs** in Cloudflare — that's where any error from the
webhook or Anthropic call will show up.

## 8. Go live

1. Switch Stripe to **Live mode**, get your live secret key
   (`sk_live_...`), and update `STRIPE_SECRET_KEY` in Cloudflare.
2. Repeat step 6 (create webhook) in Live mode — test-mode and live-mode
   webhooks are separate, you need both if you want to keep testing later.
   Update `STRIPE_WEBHOOK_SECRET` with the live signing secret.
3. Point `rostroo.com` at Cloudflare Pages: in your Pages project,
   **Custom domains → Set up a custom domain**, enter `rostroo.com`, and
   follow Cloudflare's instructions (since you're already on Cloudflare,
   this is usually just a couple of clicks if the domain's nameservers
   point at Cloudflare — Cloudflare will tell you if any DNS records need
   adding).
4. Update `SITE_URL` to `https://rostroo.com` and redeploy.
5. Run one real test purchase yourself before announcing this anywhere.

## Cost reality check

Every generated pack costs you one Anthropic API call (a few cents) plus
Stripe's processing fee (roughly 2.9% + $0.30 per US transaction — check
your Stripe dashboard for exact current rates). Cloudflare Pages,
Functions, and KV are all free at this volume. The free risk-classifier
quiz on the homepage costs nothing to run at any volume since it's pure
JavaScript, no API call.

## Known v1 limitations — deliberate, not oversights

- **No editable Word/DOCX export**, only Markdown and browser
  print-to-PDF. Reuses the exact pattern already proven in the Whalper
  Resilience Studio tool. Native DOCX generation is a reasonable
  fast-follow if customers ask for it.
- **No email delivery of the pack** — Stripe automatically emails a
  payment receipt, but the pack itself is only available on the success
  page and via download. Fine for now since generation is fast and the
  page persists; worth adding transactional email (e.g. Resend) later if
  customers lose the tab before downloading.
- **No watermarked preview before payment.** The original research
  suggested showing a teaser before the paywall — deliberately skipped
  for v1 to avoid spending API cost on visitors who never buy, and to
  avoid the added complexity. Pay-first, generate-after is simpler and
  lower-risk to ship correctly.
- **No user accounts.** Every purchase is a one-off guest checkout, by
  design — matches the "no subscriptions, no login" positioning on the
  homepage.

## Legal note

The footer and FAQ both state plainly that this is not legal advice and
not a certification. Worth having your own terms of service and privacy
policy reviewed before taking real payments — this repo ships marketing
copy, not a substitute for that.
