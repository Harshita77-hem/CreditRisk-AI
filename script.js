"use strict";

/* ---------- API base URL ----------
   Priority: window.CREDITAI_API_BASE (set it in index.html if you host the
   frontend separately) > local dev on another port > same origin (FastAPI serves the page). */
const API_BASE_URL = (() => {
  if (typeof window.CREDITAI_API_BASE === "string") return window.CREDITAI_API_BASE.replace(/\/$/, "");
  const local = ["localhost", "127.0.0.1", ""].includes(location.hostname);
  if (local && location.port !== "8000") return "http://127.0.0.1:8000";
  return ""; // same origin (e.g. https://your-app.onrender.com)
})();

/* Exact backend field names. [id, type] */
const FIELDS = [
  ["person_age", "int"], ["person_income", "float"], ["person_home_ownership", "str"],
  ["person_emp_length", "float"], ["loan_intent", "str"], ["loan_grade", "str"],
  ["loan_amnt", "float"], ["loan_int_rate", "float"], ["loan_percent_income", "float"],
  ["cb_person_default_on_file", "str"], ["cb_person_cred_hist_length", "int"],
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const pct = (n) => `${Number(n).toFixed(2)}%`;
const pp = (n) => (Math.abs(n) < 0.005 ? "≈ 0.00 pp" : `${n > 0 ? "+" : ""}${Number(n).toFixed(2)} pp`);
const LTI_WARN_AT = 1; // loan larger than one year of income; edit to taste
const LTI_WARNING = "Loan amount is unusually high relative to annual income. Results may be less reliable because this profile may be outside typical training patterns.";
const INTENT_LABELS = { PERSONAL: "Personal", EDUCATION: "Education", MEDICAL: "Medical", VENTURE: "Venture", HOMEIMPROVEMENT: "Home improvement", DEBTCONSOLIDATION: "Debt consolidation" };
const intentLabel = (v) => INTENT_LABELS[v] || String(v).replace(/_/g, " ");
const nice = (s) => String(s).replace(/_/g, " ").toLowerCase();
const num = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const dir = (n) => (n > 0.005 ? "up" : n < -0.005 ? "down" : "flat");
const arrow = { up: "▲", down: "▼", flat: "●" };

function riskColor(level = "") {
  const l = level.toLowerCase();
  if (l.includes("very")) return "var(--vh)";
  if (l.includes("high")) return "var(--high)";
  if (l.includes("moderate")) return "var(--mod)";
  return "var(--low)";
}

/* ---------- loan-to-income (read-only, automatic) ----------
   loan_percent_income = loan_amnt / person_income. Display helper only;
   the backend recalculates it again before every prediction. */
function calcRatio() {
  const amount = parseFloat($("loan_amnt").value);
  const income = parseFloat($("person_income").value);
  return amount >= 0 && income > 0 ? amount / income : null;
}

function syncRatio() {
  const r = calcRatio();
  $("loan_percent_income").value = r === null ? "" : `${r.toFixed(2)}×`; // display only; payload uses the exact calcRatio()
  const warn = $("ltiWarn");
  warn.hidden = !(r !== null && r > LTI_WARN_AT);
  warn.textContent = warn.hidden ? "" : LTI_WARNING;
}

/* ---------- form ---------- */
function readForm() {
  const payload = {};
  let valid = true;
  FIELDS.forEach(([id, type]) => {
    if (id === "loan_percent_income") return; // derived below, never typed
    const el = $(id);
    const wrap = el.closest(".f");
    wrap.querySelector(".ferr")?.remove();
    const ok = el.value.trim() !== "" && el.checkValidity();
    el.setAttribute("aria-invalid", String(!ok));
    if (!ok) {
      valid = false;
      const m = document.createElement("span");
      m.className = "ferr";
      m.textContent = el.value.trim() === "" ? "This field is required." : (el.validationMessage || "Enter a valid value.");
      wrap.appendChild(m);
    }
    payload[id] = type === "str" ? el.value : type === "int" ? parseInt(el.value, 10) : parseFloat(el.value);
  });
  payload.loan_percent_income = calcRatio();
  return valid && payload.loan_percent_income !== null ? payload : null;
}

function setLoading(on) {
  const b = $("submit");
  b.disabled = on;
  b.classList.toggle("loading", on);
  $("submitText").textContent = on ? "Analysing…" : "Predict Default Risk";
}

function showError(msg) {
  const e = $("error");
  e.textContent = msg || "";
  e.hidden = !msg;
}

/* ---------- API ---------- */
async function fetchAnalysis(payload) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/risk-analysis`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Unable to reach the risk engine. Please make sure the FastAPI server is running and try again.");
  }
  if (res.status === 422) throw new Error("The server rejected one or more inputs. Check the values and category spelling, then try again.");
  if (!res.ok) throw new Error(`The risk engine returned an error (status ${res.status}). Please try again.`);
  let data;
  try { data = await res.json(); } catch { data = null; }
  const ok = data && data.prediction && typeof data.prediction.probability === "number" &&
    Array.isArray(data.counterfactual?.scenarios) && Array.isArray(data.stress_testing?.scenarios) &&
    data.stress_testing.combined_stress && data.decision_summary;
  if (!ok) throw new Error("The risk engine sent a response this page could not read. Please try again.");
  return data;
}

/* ---------- animation helpers ---------- */
function countUp(el, to, ms = 1400) {
  if (reduced) { el.textContent = pct(to); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = pct(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* Bars start at 0 and grow to data-w on the next frames */
function growBars(root) {
  requestAnimationFrame(() => requestAnimationFrame(() =>
    root.querySelectorAll("[data-w]").forEach((el) => { el.style.width = `${Math.max(0, Math.min(100, el.dataset.w))}%`; })));
}

/* ---------- renderers ---------- */
function renderCurrent(p, input) {
  const color = riskColor(p.risk_level);
  $("result").style.setProperty("--rc", color);
  const C = 2 * Math.PI * 80;
  $("gFill").style.strokeDashoffset = C;
  requestAnimationFrame(() => requestAnimationFrame(() => { $("gFill").style.strokeDashoffset = C * (1 - Math.min(100, p.probability) / 100); }));
  $("gTick").setAttribute("transform", `translate(100 100) rotate(${p.threshold * 3.6})`);
  $("gaugeSvg").setAttribute("aria-label", `Default probability ${pct(p.probability)}, threshold ${pct(p.threshold)}`);
  countUp($("gNum"), p.probability);
  $("badge").textContent = p.risk_level;
  $("pFill").style.width = "0";
  requestAnimationFrame(() => requestAnimationFrame(() => { $("pFill").style.width = `${Math.min(100, p.probability)}%`; }));
  $("pMark").style.left = `${p.threshold}%`;
  $("thr").textContent = pct(p.threshold);
  $("cls").textContent = p.prediction === 1 ? "Predicted Default" : "Predicted Non-Default";

  const ic = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const items = [
    ["Annual income", num(input.person_income), "M3 12h18M12 3v18"],
    ["Loan amount", num(input.loan_amnt), "M4 7h16v10H4zM12 10v4"],
    ["Interest rate", `${num(input.loan_int_rate)}%`, "M6 18 18 6M7 7h.01M17 17h.01"],
    ["Loan-to-income", `${Number(input.loan_percent_income).toFixed(2)}×`, "M4 20V8M10 20V4M16 20v-8M22 20H2"],
    ["Loan grade", input.loan_grade, "M12 3l2.6 5.6 6 .7-4.5 4.1 1.200 6L12 16.500 6.700 19.400l1.200-6L3.400 9.300l6-.7z"],
    ["Loan intent", intentLabel(input.loan_intent), "M5 12h14M12 5l7 7-7 7"],
    ["Employment length", `${num(input.person_emp_length)} yrs`, "M4 8h16v11H4zM9 8V5h6v3"],
    ["Credit history", `${num(input.cb_person_cred_hist_length)} yrs`, "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18"],
    ["Previous default", input.cb_person_default_on_file === "Y" ? "Yes" : "No", "M12 9v4M12 17h.01M10.300 3.900 2 18h20L13.700 3.900a2 2 0 0 0-3.400 0z"],
  ];
  const lti = Number(input.loan_percent_income);
  $("ltiNote").hidden = !(lti > LTI_WARN_AT);
  $("ltiNote").textContent = $("ltiNote").hidden ? "" : LTI_WARNING;
  $("summary").innerHTML = items.map(([k, v, d]) => `<div><dt>${ic(d)}${k}</dt><dd>${esc(v)}</dd></div>`).join("");
}

function scenarioRow(s, threshold, warnAt) {
  const d = dir(s.risk_change);
  const warn = warnAt != null && s.risk_change >= warnAt ? " warn" : "";
  return `<div class="row${warn}"><span class="nm">${esc(s.scenario)}</span>
    <div class="bar" role="img" aria-label="${esc(s.scenario)} risk ${pct(s.risk)}"><i data-w="${s.risk}" style="--c:${riskColor(s.risk >= 60 ? "very" : s.risk >= 30 ? "high" : s.risk >= 10 ? "moderate" : "low")}"></i>${threshold != null ? `<u style="left:${threshold}%"></u>` : ""}</div>
    <span class="val">${pct(s.risk)}</span><span class="chg ${d}">${arrow[d]} ${pp(s.risk_change)}</span></div>`;
}

function highlight(label, s, color) {
  if (!s) return "";
  return `<article class="glass hl" style="--c:${color}"><small>${label}</small><strong>${esc(s.scenario)}</strong>
    <span>${pp(s.risk_change)} · scenario risk ${pct(s.risk)}</span></article>`;
}

function renderWhatIf(cf, threshold) {
  $("cfHighlights").innerHTML = highlight("Highest risk increase", cf.highest_risk_increase, "var(--vh)") +
    highlight("Largest risk reduction", cf.largest_risk_reduction, "var(--low)");
  $("cfRows").innerHTML = cf.scenarios.length
    ? cf.scenarios.map((s) => scenarioRow(s, threshold)).join("")
    : '<p class="empty">No what-if scenarios were returned.</p>';
  growBars($("cfRows"));
}

function renderStress(st, threshold) {
  $("stRows").innerHTML = st.scenarios.length
    ? st.scenarios.map((s) => scenarioRow(s, threshold, 10)).join("")
    : '<p class="empty">No stress scenarios were returned.</p>';
  growBars($("stRows"));
  const c = st.combined_stress;
  $("combined").innerHTML = `<h3>Combined Stress Scenario</h3>
    <div><small>Combined stress risk</small><strong>${pct(c.risk)}</strong></div>
    <div><small>Combined risk change</small><strong>${pp(c.risk_change)}</strong></div>
    <p>Under the combined hypothetical stress scenario, the model estimates a default risk of ${pct(c.risk)}. This is a model-based what-if, not a prediction that income loss causes default.</p>`;
}

function renderDecision(d, p) {
  const color = riskColor(d.risk_level);
  $("tiers").innerHTML = `
  <article class="glass tier" style="--rc:${color}"><h3>Current decision</h3>
    <div><div class="big">${p.prediction === 1 ? "Predicted Default" : "Predicted Non-Default"}</div><p class="meta"><span class="badge band">${esc(d.risk_level)}</span>probability <b>${pct(d.current_risk)}</b> · threshold <b>${pct(p.threshold)}</b></p></div></article>
  <article class="glass tier"><h3>What drives the risk</h3>
    <div class="cols">
      <div><small>Highest risk-increasing scenario</small><b>${esc(d.highest_risk_increasing_scenario)}</b><span style="color:var(--vh)">${pp(d.highest_risk_increase)}</span></div>
      <div><small>Largest risk-reducing scenario</small><b>${esc(d.largest_risk_reducing_scenario)}</b></div></div></article>
  <article class="glass tier"><h3>Stress exposure</h3>
    <div class="cols">
      <div><small>Highest individual stress</small><b>${esc(d.highest_individual_stress)}</b></div>
      <div><small>Combined stress risk</small><b>${pct(d.combined_stress_risk)}</b><span style="color:var(--high)">${pp(d.combined_stress_change)}</span></div></div></article>`;
}

/* ---------- flow ---------- */
function renderAll(data, input) {
  renderCurrent(data.prediction, input);
  renderWhatIf(data.counterfactual, data.prediction.threshold);
  renderStress(data.stress_testing, data.prediction.threshold);
  renderDecision(data.decision_summary, data.prediction);
  document.body.classList.add("has-results");
  document.querySelectorAll(".reveal").forEach(observe);
  $("result").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
}

async function onSubmit(e) {
  e.preventDefault();
  if ($("submit").disabled) return; // block duplicate submits
  showError("");
  const payload = readForm();
  if (!payload) { document.querySelector("[aria-invalid=true]")?.focus(); return; }
  setLoading(true);
  try {
    renderAll(await fetchAnalysis(payload), payload);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

function resetAll() {
  $("form").reset();
  syncRatio();
  document.querySelectorAll(".ferr").forEach((n) => n.remove());
  document.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));
  showError("");
  document.body.classList.remove("has-results");
  $("assess").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
}

/* ---------- reveal on scroll ---------- */
const io = "IntersectionObserver" in window
  ? new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }), { threshold: 0.08 })
  : null;
function observe(el) { io ? io.observe(el) : el.classList.add("in"); }

/* ---------- interactive hero orb ---------- */
function initOrb() {
  const svg = $("orb");
  if (!svg) return;
  const [A, B, C] = ["rA", "rB", "rC"].map($);
  const glow = $("glow"), ripples = $("ripples"), check = $("check");
  const spin = { a: 0, b: 0, c: 0, speed: 1, target: 1 };
  let last = performance.now();

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    spin.speed += (spin.target - spin.speed) * Math.min(1, dt * 4); // ease toward hover speed
    spin.a += 6 * spin.speed * dt; spin.b -= 10 * spin.speed * dt; spin.c += 26 * spin.speed * dt;
    A.setAttribute("transform", `rotate(${spin.a} 200 200)`);
    B.setAttribute("transform", `rotate(${spin.b} 200 200)`);
    C.setAttribute("transform", `rotate(${spin.c} 200 200)`);
    requestAnimationFrame(frame);
  }
  if (!reduced) requestAnimationFrame(frame);

  function pulse() {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    r.setAttribute("cx", 200); r.setAttribute("cy", 200); r.setAttribute("r", 60);
    r.setAttribute("class", "ripple");
    r.addEventListener("animationend", () => r.remove());
    ripples.appendChild(r);
    check.classList.remove("draw");
    void check.getBoundingClientRect(); // restart the check animation
    check.classList.add("draw");
  }

  svg.addEventListener("pointermove", (e) => {
    const b = svg.getBoundingClientRect();
    const nx = ((e.clientX - b.left) / b.width - 0.5) * 2, ny = ((e.clientY - b.top) / b.height - 0.5) * 2;
    if (!reduced) { svg.style.setProperty("--rx", `${-ny * 9}deg`); svg.style.setProperty("--ry", `${nx * 11}deg`); }
    glow.setAttribute("cx", 200 + nx * 55); glow.setAttribute("cy", 200 + ny * 55);
  });
  svg.addEventListener("pointerenter", () => { spin.target = 4; });
  svg.addEventListener("pointerleave", () => {
    spin.target = 1;
    svg.style.setProperty("--rx", "0deg"); svg.style.setProperty("--ry", "0deg");
    glow.setAttribute("cx", 200); glow.setAttribute("cy", 200);
  });
  svg.addEventListener("click", pulse);
  svg.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pulse(); } });
}

/* ---------- init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  $("form").addEventListener("submit", onSubmit);
  $("reset").addEventListener("click", resetAll);
  ["loan_amnt", "person_income"].forEach((id) => $(id).addEventListener("input", syncRatio));
  initOrb();
  const burger = $("burger"), menu = $("menu");
  burger.addEventListener("click", () => burger.setAttribute("aria-expanded", String(menu.classList.toggle("open"))));
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) { menu.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); } });
  document.querySelectorAll(".reveal").forEach(observe);
});