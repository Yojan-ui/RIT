// Small client-side helpers layered on top of HTMX.
document.addEventListener("htmx:responseError", (evt) => {
  const target = document.getElementById("result");
  if (target) {
    target.innerHTML = `<div class="error">Request failed (${evt.detail.xhr.status}). Try again.</div>`;
  }
});
