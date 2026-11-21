// Frontend_Shared/config.js — loaded before app.js.
// Sets window.API_BASE so ONE frontend works behind every variant:
//   * served by a variant (http://localhost:5001|5011|5021/) -> same origin "/api"
//   * opened from disk (file:)                                -> event-driven backend
//   * ?api=http://localhost:5011/api                          -> explicit override
(function () {
  var override = new URLSearchParams(window.location.search).get("api");
  if (override) {
    window.API_BASE = override;
    return;
  }
  if (window.location.protocol === "file:") {
    window.API_BASE = "http://localhost:5001/api";
    return;
  }
  window.API_BASE = window.API_BASE || "/api";
})();
