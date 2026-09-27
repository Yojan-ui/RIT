// Small client-side helpers layered on top of HTMX.
document.addEventListener("htmx:responseError", (evt) => {
  const target = document.getElementById("result");
  if (target) {
    target.innerHTML = `<div class="error rounded-xl border border-exposed/40 bg-surface px-5 py-4" role="alert">
      <p class="font-semibold text-exposed">The scan didn't finish</p>
      <p class="mt-1 text-muted">The server returned ${evt.detail.xhr.status}. Run the scan again.</p></div>`;
  }
});

// Copy buttons: <button data-copy="element-id">
document.addEventListener("click", async (evt) => {
  const button = evt.target.closest("[data-copy]");
  if (!button) return;
  const source = document.getElementById(button.dataset.copy);
  if (!source) return;
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(source.textContent.trim());
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select and copy";
  }
  setTimeout(() => { button.textContent = label; }, 1600);
});

// Deep links such as /?domain=example.com#attack-matrix: the anchor only exists once the scan
// result has been swapped in, so scroll to it then.
document.addEventListener("htmx:afterSettle", (evt) => {
  if (evt.detail.target.id !== "result" || !location.hash) return;
  const anchor = document.getElementById(location.hash.slice(1));
  if (anchor) anchor.scrollIntoView({ block: "start" });
});
