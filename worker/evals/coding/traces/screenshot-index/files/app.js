const btn = document.getElementById("ping");
const out = document.getElementById("out");
if (btn && out) {
  btn.addEventListener("click", () => {
    out.textContent = "Ready.";
  });
}
