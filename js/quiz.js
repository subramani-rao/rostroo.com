// Rostroo — free "AI Risk Classification Check"
// Deliberately deterministic (no API call): a simple rules-based lookup,
// not an AI call, so this free tool costs nothing to run at any volume.

(function () {
  "use strict";

  var HIGH_RISK_USE_CASES = ["hiring", "credit", "biometric"];

  function classify(useCase, autonomy, policyStatus) {
    var tier = "minimal";
    var reasons = [];

    if (HIGH_RISK_USE_CASES.indexOf(useCase) !== -1) {
      tier = "high";
      reasons.push(
        "Your use case (" + labelFor(useCase) + ") falls into a category the EU AI Act treats as higher-risk (Annex III), which brings extra obligations around risk management, human oversight and documentation."
      );
    } else if (autonomy === "yes") {
      tier = "high";
      reasons.push(
        "Making decisions that significantly affect people without human review is a major risk factor under the EU AI Act, regardless of use case."
      );
    } else if (autonomy === "partial" || useCase === "support" || useCase === "content") {
      tier = "limited";
      reasons.push(
        "Systems that interact directly with people or generate content typically fall under the EU AI Act's transparency obligations (Article 50), even when risk is otherwise low."
      );
    } else {
      tier = "minimal";
      reasons.push(
        "Based on what you've told us, this use case looks lower-risk — but internal AI governance documentation is still expected by most enterprise buyers and auditors."
      );
    }

    var missing = [];
    if (policyStatus !== "yes") {
      missing.push("A current, written AI Acceptable Use Policy");
    }
    missing.push("An AI System Inventory Register covering this use case");
    if (tier === "high") {
      missing.push("A documented human oversight / review process");
      missing.push("A risk assessment mapped to EU AI Act Annex III obligations");
    }
    if (useCase === "support" || useCase === "content") {
      missing.push("An Article 50 transparency disclosure for AI-generated content or AI interaction");
    }
    missing.push("A Third-Party AI Vendor Risk Checklist for the tools you rely on");

    return { tier: tier, reasons: reasons, missing: missing };
  }

  function labelFor(value) {
    var labels = {
      support: "customer support / chatbot",
      content: "content or marketing generation",
      hiring: "hiring / HR decisions",
      credit: "credit, lending or insurance decisions",
      biometric: "biometric identification or emotion recognition",
      internal: "internal analytics / developer tools",
      other: "your stated use case",
    };
    return labels[value] || "your stated use case";
  }

  var TIER_LABELS = {
    minimal: { text: "Likely minimal / low risk", cls: "tier-minimal" },
    limited: { text: "Likely limited risk — transparency obligations may apply", cls: "tier-limited" },
    high: { text: "Likely higher risk — extra obligations likely apply", cls: "tier-high" },
  };

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("btnClassify");
    if (!btn) return;

    btn.addEventListener("click", function () {
      var useCase = document.getElementById("q1").value;
      var autonomy = document.getElementById("q2").value;
      var policyStatus = document.getElementById("q3").value;

      var result = classify(useCase, autonomy, policyStatus);
      var tierInfo = TIER_LABELS[result.tier];

      var badge = document.getElementById("tierBadge");
      badge.textContent = tierInfo.text;
      badge.className = "tier " + tierInfo.cls;

      document.getElementById("tierSummary").textContent = result.reasons.join(" ");

      var list = document.getElementById("tierMissing");
      list.innerHTML = "";
      var heading = document.createElement("li");
      heading.innerHTML = "<strong>You're likely missing:</strong>";
      heading.style.listStyle = "none";
      heading.style.marginLeft = "-18px";
      list.appendChild(heading);
      result.missing.forEach(function (item) {
        var li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      });

      var resultEl = document.getElementById("toolResult");
      resultEl.classList.add("visible");
      resultEl.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
})();
