// Server-side call to the Anthropic API. Runs inside a Cloudflare Pages
// Function, never in the browser — the API key stays in Cloudflare's
// secret store and is never exposed to a customer.

export async function generateGovernancePack(apiKey, intake, onTrace) {
  const trace = onTrace || (() => {});

  const systemPrompt = `You are a senior AI governance and compliance consultant drafting a first-DRAFT "AI Governance & Policy Pack" for a company, based on their self-reported answers to a guided questionnaire. A qualified human at the purchasing company (or their own legal/compliance counsel) will review this before it is adopted or shown to anyone else — you are not providing legal advice, and you should write with that framing in mind.

Because this is a first draft generated from self-reported answers with no human consultant reviewing it before delivery:
- Where the answers don't give you enough to state something specific (a named policy owner, an exact retention period, a specific incident contact), write "[NEEDS INPUT: <what's missing>]" inline rather than inventing it.
- Do not invent specific legal citations (article/clause numbers) you are not confident about. Where useful, reference frameworks generally (e.g. "NIST AI RMF's Govern function", "ISO 42001's AI system inventory requirements", "EU AI Act Article 50 transparency obligations") rather than fabricating precise clause numbers you can't verify.
- Be direct and concrete. No filler, no hedging paragraphs, no generic AI-ethics platitudes.
- Tailor every section specifically to the company's stated use cases, sector, and answers — do not produce generic boilerplate that ignores what they told you.

Structure your output as Markdown with EXACTLY these H2 sections, in this order:

## Overview
2-4 sentences: what this pack covers, the company's primary AI use case(s), and a one-line risk-tier read (minimal / limited / high) based on their answers, explained simply.

## AI Acceptable Use Policy
A usable internal policy (numbered sections) covering: permitted and prohibited AI use cases, data handling rules (especially given their answer on training data), human oversight requirements, and vendor/tool approval process. Reference NIST AI RMF's Govern and Map functions where relevant.

## AI System Inventory Register
A markdown table: AI System/Use Case | Purpose | Data Involved | Third-Party Vendor | Human Oversight Level | Risk Tier
Populate rows from their stated use cases and vendors. This is the foundational artifact ISO 42001 and EU AI Act compliance both start from.

## Third-Party AI Vendor Risk Checklist
A markdown table: Vendor | Use Case Supported | Data Shared | Contractual Safeguards Confirmed? | Concentration Risk Notes
Populate from their stated vendors; flag [NEEDS INPUT] for contractual details they weren't asked about.

## EU AI Act Article 50 Transparency Statement
A ready-to-adapt draft disclosure statement, appropriate to their use cases, addressing: AI interaction disclosure, synthetic/generated content labelling (only if relevant per their answers), and where this should be published (e.g. website, product UI). If their answers suggest Article 50 obligations likely don't apply to a given use case, say so plainly rather than padding the section.

## AI Incident Response Playbook Addendum
A short addendum (not a full IR plan) covering: what counts as an AI-related incident (harmful output, data leakage via a model, biased/discriminatory decision, model manipulation), initial response steps, and escalation. Numbered list.

## What This Pack Does Not Cover
2-3 sentences, direct and honest: this is a first draft from self-reported answers, not a certification, not legal advice, and not a substitute for review by qualified counsel — especially given any [NEEDS INPUT] flags above.

Use the company's actual name and sector throughout rather than generic placeholders like "[Company]".`;

  const userPrompt = buildUserPrompt(intake);

  await trace("generateGovernancePack: calling Anthropic API", {
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey ? apiKey.length : 0,
  });

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (e) {
    await trace("generateGovernancePack: fetch itself threw", { message: e.message, stack: e.stack });
    throw new Error(`Network error calling Anthropic: ${e.message}`);
  }

  await trace("generateGovernancePack: got response", { status: resp.status, ok: resp.ok });

  if (!resp.ok) {
    let detail = "";
    try {
      const errJson = await resp.json();
      detail = errJson && errJson.error ? errJson.error.message : JSON.stringify(errJson);
    } catch (e) {
      detail = await resp.text();
    }
    await trace("generateGovernancePack: Anthropic returned an error", { status: resp.status, detail });
    throw new Error(`Anthropic API error (${resp.status}): ${detail}`);
  }

  const data = await resp.json();
  await trace("generateGovernancePack: parsed response body", {
    stopReason: data.stop_reason,
    contentBlocks: (data.content || []).length,
  });
  return (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function buildUserPrompt(intake) {
  let out = `Company: ${intake.companyName || "(not given)"}\n`;
  out += `Sector: ${intake.sector || "(not given)"}\n`;
  out += `Company size: ${intake.companySize || "(not given)"}\n\n`;

  out += `AI use cases selected: ${(intake.useCases || []).join(", ") || "(none selected)"}\n`;
  if (intake.useCaseNotes) out += `Use case, in their own words: ${intake.useCaseNotes}\n`;
  out += "\n";

  out += `Uses customer/personal data to train or fine-tune models: ${intake.trainData || "(not given)"}\n`;
  out += `Human review before AI decisions affecting a person: ${intake.humanReview || "(not given)"}\n`;
  out += `Generates synthetic content that could be mistaken for human-created/real: ${intake.syntheticContent || "(not given)"}\n\n`;

  out += `Third-party AI vendors/tools used: ${intake.vendors || "(none given)"}\n`;
  out += `Existing AI policy documentation status: ${intake.policyStatus || "(not given)"}\n`;
  if (intake.extraNotes) out += `Additional notes from the company: ${intake.extraNotes}\n`;

  return out;
}
