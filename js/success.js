// Rostroo — success/download page: polls for the generated pack and
// renders it once ready.

(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };

  function showOnly(id) {
    ["statusProcessing", "statusError", "statusNotFound", "statusReady"].forEach(function (elId) {
      $("#" + elId).classList.toggle("hidden", elId !== id);
    });
  }

  function renderMarkdown(markdown) {
    var html = window.marked ? window.marked.parse(markdown) : markdown;
    var clean = window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
    var highlighted = clean.replace(/\[NEEDS INPUT:?([^\]]*)\]/gi, "<mark>[NEEDS INPUT:$1]</mark>");
    $("#packContent").innerHTML = highlighted;
  }

  async function poll(token, attempt) {
    attempt = attempt || 0;
    var MAX_ATTEMPTS = 40; // ~2 minutes at 3s intervals

    let resp, data;
    try {
      resp = await fetch("/api/get-pack?token=" + encodeURIComponent(token));
      data = await resp.json();
    } catch (e) {
      data = { status: "error", error: "Network error" };
    }

    if (data.status === "ready") {
      $("#printCompanyName").textContent = data.companyName || "—";
      $("#printDate").textContent = new Date().toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      });
      renderMarkdown(data.markdown);
      showOnly("statusReady");
      window.__rostrooMarkdown = data.markdown;
      return;
    }

    if (data.status === "error") {
      $("#errorToken").textContent = token;
      showOnly("statusError");
      return;
    }

    if (data.status === "not_found") {
      showOnly("statusNotFound");
      return;
    }

    // status === "processing" (or unknown) — keep polling.
    if (attempt >= MAX_ATTEMPTS) {
      $("#errorToken").textContent = token;
      showOnly("statusError");
      return;
    }
    setTimeout(function () { poll(token, attempt + 1); }, 3000);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var params = new URLSearchParams(window.location.search);
    var token = params.get("token");

    if (!token) {
      showOnly("statusNotFound");
      return;
    }

    showOnly("statusProcessing");
    poll(token, 0);

    $("#btnDownloadMd").addEventListener("click", function () {
      var text = window.__rostrooMarkdown || "";
      if (!text) return;
      var blob = new Blob([text], { type: "text/markdown" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "rostroo-ai-governance-pack.md";
      a.click();
      URL.revokeObjectURL(url);
    });

    $("#btnPrint").addEventListener("click", function () {
      window.print();
    });
  });
})();
