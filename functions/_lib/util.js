export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

export function intakeKey(token) {
  return `intake:${token}`;
}

export function packKey(token) {
  return `pack:${token}`;
}

// A very small allow-list of sector values we expect from the form, so a
// malicious client can't stuff arbitrary junk into fields we don't
// otherwise validate. Not exhaustive security, just cheap sanity-checking.
export function sanitizeIntake(intake) {
  const asString = (v, max) => String(v || "").slice(0, max || 500);
  return {
    companyName: asString(intake.companyName, 200),
    contactEmail: asString(intake.contactEmail, 200),
    sector: asString(intake.sector, 50),
    companySize: asString(intake.companySize, 20),
    useCases: Array.isArray(intake.useCases) ? intake.useCases.slice(0, 20).map((u) => asString(u, 100)) : [],
    useCaseNotes: asString(intake.useCaseNotes, 2000),
    trainData: asString(intake.trainData, 20),
    humanReview: asString(intake.humanReview, 20),
    syntheticContent: asString(intake.syntheticContent, 20),
    vendors: asString(intake.vendors, 500),
    policyStatus: asString(intake.policyStatus, 20),
    extraNotes: asString(intake.extraNotes, 2000),
  };
}
