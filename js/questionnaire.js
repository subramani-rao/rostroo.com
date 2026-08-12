// Rostroo — guided questionnaire wizard + handoff to Stripe Checkout

(function () {
  "use strict";

  var TOTAL_STEPS = 5;
  var currentStep = 1;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  function showStep(n) {
    $$(".wizard-step").forEach(function (el) {
      el.classList.toggle("hidden", parseInt(el.getAttribute("data-step"), 10) !== n);
    });
    $$("[data-step-dot]").forEach(function (dot) {
      dot.classList.toggle("done", parseInt(dot.getAttribute("data-step-dot"), 10) <= n);
    });
    $("#btnBack").disabled = n === 1;
    $("#btnNext").classList.toggle("hidden", n === TOTAL_STEPS);
    $("#btnPay").classList.toggle("hidden", n !== TOTAL_STEPS);
    $("#wizardError").textContent = "";
    if (n === TOTAL_STEPS) renderReview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateStep(n) {
    if (n === 1) {
      var name = $("#companyName").value.trim();
      var email = $("#contactEmail").value.trim();
      if (!name) return "Add your company name.";
      if (!email || email.indexOf("@") === -1) return "Add a valid work email — this is where receipts and a backup copy go.";
    }
    if (n === 2) {
      var useCases = $$(".usecase:checked");
      var notes = $("#useCaseNotes").value.trim();
      if (!useCases.length && !notes) return "Select at least one use case, or describe it below.";
    }
    return null;
  }

  function collectIntake() {
    var useCases = $$(".usecase:checked").map(function (cb) { return cb.value; });
    return {
      companyName: $("#companyName").value.trim(),
      contactEmail: $("#contactEmail").value.trim(),
      sector: $("#sector").value,
      companySize: $("#companySize").value,
      useCases: useCases,
      useCaseNotes: $("#useCaseNotes").value.trim(),
      trainData: (document.querySelector('input[name="trainData"]:checked') || {}).value,
      humanReview: (document.querySelector('input[name="humanReview"]:checked') || {}).value,
      syntheticContent: (document.querySelector('input[name="syntheticContent"]:checked') || {}).value,
      vendors: $("#vendors").value.trim(),
      policyStatus: (document.querySelector('input[name="policyStatus"]:checked') || {}).value,
      extraNotes: $("#extraNotes").value.trim(),
    };
  }

  function renderReview() {
    var d = collectIntake();
    var lines = [
      "<strong>" + escapeHtml(d.companyName) + "</strong> (" + escapeHtml(d.contactEmail) + ")",
      "Sector: " + escapeHtml(d.sector) + " · Size: " + escapeHtml(d.companySize),
      "Use cases: " + (d.useCases.length ? escapeHtml(d.useCases.join(", ")) : "(described in notes)"),
      "Human review: " + escapeHtml(d.humanReview) + " · Trains on personal data: " + escapeHtml(d.trainData),
      "Existing AI policy: " + escapeHtml(d.policyStatus),
    ];
    $("#reviewSummary").innerHTML = lines.map(function (l) { return "<div style='margin-bottom:6px;'>" + l + "</div>"; }).join("");
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    showStep(currentStep);

    $("#btnNext").addEventListener("click", function () {
      var err = validateStep(currentStep);
      if (err) {
        $("#wizardError").textContent = err;
        return;
      }
      currentStep = Math.min(TOTAL_STEPS, currentStep + 1);
      showStep(currentStep);
    });

    $("#btnBack").addEventListener("click", function () {
      currentStep = Math.max(1, currentStep - 1);
      showStep(currentStep);
    });

    $("#btnPay").addEventListener("click", async function () {
      var btn = $("#btnPay");
      btn.disabled = true;
      btn.textContent = "Setting up secure checkout…";
      $("#wizardError").textContent = "";

      try {
        var intake = collectIntake();

        // 1. Save intake, get a session token back.
        var saveResp = await fetch("/api/save-intake", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(intake),
        });
        if (!saveResp.ok) throw new Error("Couldn't save your answers. Please try again.");
        var saveData = await saveResp.json();

        // 2. Create a Stripe Checkout session for that token and redirect.
        var checkoutResp = await fetch("/api/create-checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionToken: saveData.sessionToken }),
        });
        if (!checkoutResp.ok) throw new Error("Couldn't start checkout. Please try again.");
        var checkoutData = await checkoutResp.json();

        window.location.href = checkoutData.checkoutUrl;
      } catch (e) {
        console.error(e);
        $("#wizardError").textContent = e.message || "Something went wrong. Please try again.";
        btn.disabled = false;
        btn.textContent = "Pay $199 & generate my pack";
      }
    });
  });
})();
