/* docs.github.io probe editor — vanilla JS, no deps.
   - Loads the built-in catalog from public/tests.js (raw on GitHub or local)
   - Custom probes stored in localStorage so edits survive page reload
   - Import / Export use the same probe-pack JSON schema as the desktop app
*/

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const PROBE_PACK_FORMAT = "claude-verifier-probe-pack";
const LS_CUSTOM = "cv_editor_custom_v1";
const TESTS_URL = "https://raw.githubusercontent.com/botnick/claude-verifier/main/public/tests.js";

const CAT_LABEL = {
  identity:   "Identity probes",
  jailbreak:  "Jailbreak resistance",
  china:      "Politically sensitive (CN)",
  trick:      "Social-engineering / leak",
  capability: "Capability sanity",
};

const state = {
  builtIn: [],       // never mutated locally
  custom:  [],       // mutable; persisted to localStorage
  search:  "",
  filterCat: "",
  editingId: null,   // id currently in modal, or null for add
};

function loadCustom() {
  try { const v = JSON.parse(localStorage.getItem(LS_CUSTOM) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function saveCustom() {
  localStorage.setItem(LS_CUSTOM, JSON.stringify(state.custom));
}

// Parse `public/tests.js` by evaluating it as a tiny CommonJS-ish module.
// The file declares `const TESTS = [...]` and ends with a Node export footer
// that's harmless in the browser. We wrap it so we can capture `TESTS`.
function parseTestsJs(source) {
  // Strip the "if (typeof module ..." footer — it does nothing in browser
  // anyway, but keeps eval cleaner.
  const cleaned = source.replace(/if\s*\(typeof module[\s\S]*$/, "");
  // Wrap and eval to get TESTS without polluting global scope. Strict mode
  // requires explicit declaration access via a returned value.
  const factory = new Function(`${cleaned}\n;return TESTS;`);
  return factory();
}

async function loadBuiltIn() {
  // Try GitHub raw first (so this works on github.io). Fall back to local
  // ../public/tests.js for local dev.
  const candidates = [TESTS_URL, "../public/tests.js"];
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const src = await res.text();
      const tests = parseTestsJs(src);
      if (Array.isArray(tests) && tests.length) return tests;
    } catch {}
  }
  throw new Error("Could not load built-in catalog from any source");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showToast(msg, isError) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function mergedProbes() {
  // Custom probes win over built-in by id (so users can override).
  const customIds = new Set(state.custom.map(p => p.id));
  const merged = [
    ...state.custom.map(p => ({ ...p, _custom: true })),
    ...state.builtIn.filter(p => !customIds.has(p.id)).map(p => ({ ...p, _custom: false })),
  ];
  return merged;
}

function renderStats() {
  $("#stat-builtin").textContent = state.builtIn.length;
  $("#stat-custom").textContent = state.custom.length;
  $("#stat-total").textContent = mergedProbes().length;
}

function renderList() {
  const root = $("#probe-list");
  const q = state.search.toLowerCase();
  const filtered = mergedProbes().filter(p => {
    if (state.filterCat && p.cat !== state.filterCat) return false;
    if (!q) return true;
    return (p.title || "").toLowerCase().includes(q)
        || (p.prompt || "").toLowerCase().includes(q)
        || (p.id || "").toLowerCase().includes(q);
  });

  if (!filtered.length) {
    root.innerHTML = `<div style="padding: 36px 8px; text-align: center; color: var(--muted)">No probes match.</div>`;
    return;
  }

  root.innerHTML = filtered.map(p => `
    <div class="probe-row ${p._custom ? "custom" : ""}" data-id="${escapeHtml(p.id)}">
      <div>
        <div class="title">
          ${escapeHtml(p.title || p.id)}
          <span class="cat ${escapeHtml(p.cat || "trick")}">${escapeHtml(p.cat || "—")}</span>
          ${p._custom ? '<span class="cat" style="background: var(--accent-bg); color: var(--accent)">custom</span>' : ""}
        </div>
        <div class="prompt">${escapeHtml(p.prompt || "")}</div>
      </div>
      <div class="actions">
        <button data-act="edit"     title="Edit this probe">✎ Edit</button>
        <button data-act="duplicate" title="Duplicate as new probe">⎘ Duplicate</button>
        <button class="danger" data-act="delete" title="${p._custom ? "Delete this custom probe" : "Hide this built-in probe (creates a deletion marker)"}">🗑 Delete</button>
      </div>
    </div>
  `).join("");

  // Wire row buttons
  $$(".probe-row").forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-act="edit"]').addEventListener("click", () => openModal(id, "edit"));
    row.querySelector('[data-act="duplicate"]').addEventListener("click", () => openModal(id, "duplicate"));
    row.querySelector('[data-act="delete"]').addEventListener("click", () => deleteProbe(id));
  });
}

function findProbe(id) {
  return mergedProbes().find(p => p.id === id) || null;
}

function openModal(id, mode) {
  state.editingId = mode === "duplicate" ? null : id;
  const probe = id ? findProbe(id) : null;
  const isEdit = mode === "edit" && probe;
  const isDup  = mode === "duplicate" && probe;
  $("#modal-title").textContent = isEdit ? "Edit probe" : (isDup ? "Duplicate probe" : "Add probe");

  $("#f-id").value     = isEdit ? probe.id : (isDup ? `${probe.id}_copy` : "");
  $("#f-id").disabled  = isEdit;
  $("#f-cat").value    = probe?.cat || "trick";
  $("#f-title").value  = isDup ? `${probe.title} (copy)` : (probe?.title || "");
  $("#f-prompt").value = probe?.prompt || "";
  $("#f-expect").value = (probe?.expect_any || []).join("\n");
  $("#f-red").value    = (probe?.red_flag   || []).join("\n");

  $("#modal").classList.add("open");
  setTimeout(() => $("#f-title").focus(), 0);
}
function closeModal() {
  $("#modal").classList.remove("open");
  state.editingId = null;
}

function saveModal() {
  const id     = $("#f-id").value.trim();
  const cat    = $("#f-cat").value;
  const title  = $("#f-title").value.trim();
  const prompt = $("#f-prompt").value;
  const expect = $("#f-expect").value.split("\n").map(s => s.trim()).filter(Boolean);
  const red    = $("#f-red").value.split("\n").map(s => s.trim()).filter(Boolean);

  if (!id || !/^[a-z][a-z0-9_]*$/i.test(id)) {
    showToast("ID must be lowercase letters / numbers / underscores", true); return;
  }
  if (!title) { showToast("Title is required", true); return; }
  if (!prompt.trim()) { showToast("Prompt is required", true); return; }

  const editing = !!state.editingId;
  if (!editing) {
    // adding new: check id uniqueness against the merged catalog
    if (mergedProbes().some(p => p.id === id)) {
      showToast(`Probe id "${id}" already exists`, true); return;
    }
  }

  const probe = { id, cat, title, prompt, expect_any: expect, red_flag: red };

  if (editing) {
    const idx = state.custom.findIndex(p => p.id === id);
    if (idx >= 0) state.custom[idx] = probe;
    else state.custom.push(probe);  // overriding a built-in
  } else {
    state.custom.push(probe);
  }
  saveCustom();
  renderStats();
  renderList();
  closeModal();
  showToast(editing ? "Probe updated" : "Probe added");
}

function deleteProbe(id) {
  const p = findProbe(id);
  if (!p) return;
  if (p._custom) {
    if (!confirm(`Delete custom probe "${p.title}"?`)) return;
    state.custom = state.custom.filter(x => x.id !== id);
    saveCustom();
    renderStats();
    renderList();
    showToast("Custom probe deleted");
  } else {
    showToast(`"${p.title}" is built-in — can't delete from the editor. Untick it in the desktop app to skip it on a run.`, true);
  }
}

function importPack(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let pack;
    try { pack = JSON.parse(e.target.result); }
    catch (err) { showToast("Not valid JSON: " + err.message, true); return; }

    if (pack.format !== PROBE_PACK_FORMAT || !Array.isArray(pack.probes)) {
      showToast(`Not a probe pack — expected format="${PROBE_PACK_FORMAT}"`, true);
      return;
    }
    const existing = new Set(mergedProbes().map(p => p.id));
    let added = 0, skipped = 0;
    for (const raw of pack.probes) {
      if (!raw?.id || typeof raw.prompt !== "string") { skipped++; continue; }
      if (existing.has(raw.id)) { skipped++; continue; }
      state.custom.push({
        id: raw.id,
        cat: raw.cat || "trick",
        title: raw.title || raw.id,
        prompt: raw.prompt,
        expect_any: Array.isArray(raw.expect_any) ? raw.expect_any.filter(s => typeof s === "string") : [],
        red_flag:   Array.isArray(raw.red_flag)   ? raw.red_flag.filter(s => typeof s === "string")   : [],
      });
      existing.add(raw.id);
      added++;
    }
    saveCustom();
    renderStats();
    renderList();
    showToast(`Imported "${pack.name || "(unnamed)"}" — +${added} probes${skipped ? `, skipped ${skipped}` : ""}`);
  };
  reader.readAsText(file);
}

function exportPack() {
  // If anything is "selected" via search/filter, narrow; otherwise export everything visible (custom + built-in).
  const probes = mergedProbes().map(p => ({
    id: p.id, cat: p.cat, title: p.title, prompt: p.prompt,
    expect_any: p.expect_any || [], red_flag: p.red_flag || [],
  }));
  const pack = {
    format: PROBE_PACK_FORMAT,
    version: 1,
    name: state.custom.length
      ? `Custom catalog (${state.custom.length} custom + ${state.builtIn.length - state.custom.filter(c => state.builtIn.some(b => b.id === c.id)).length} built-in)`
      : `Full built-in catalog (${state.builtIn.length} probes)`,
    description: `Exported from the Claude Verifier web editor on ${new Date().toISOString().slice(0, 10)}.`,
    created_at: new Date().toISOString(),
    probe_count: probes.length,
    categories: [...new Set(probes.map(p => p.cat))],
    probes,
  };
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  a.href = url;
  a.download = `probe_pack_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  showToast(`Exported ${probes.length} probes`);
}

function resetCustom() {
  if (!state.custom.length) { showToast("Nothing to reset"); return; }
  if (!confirm(`Discard ${state.custom.length} local custom probe(s) and revert to the built-in catalog?`)) return;
  state.custom = [];
  saveCustom();
  renderStats();
  renderList();
  showToast("Reset to built-in catalog");
}

// ── boot ──
(async () => {
  state.custom = loadCustom();
  try {
    state.builtIn = await loadBuiltIn();
  } catch (e) {
    showToast("Failed to load built-in catalog. Editing custom probes only.", true);
    state.builtIn = [];
  }
  renderStats();
  renderList();

  $("#btn-add").addEventListener("click", () => openModal(null, "add"));
  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#btn-export").addEventListener("click", exportPack);
  $("#btn-reset").addEventListener("click", resetCustom);
  $("#import-file").addEventListener("change", (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    importPack(f);
    e.target.value = "";  // allow re-picking the same file
  });
  $("#search").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("#filter-cat").addEventListener("change", (e) => { state.filterCat = e.target.value; renderList(); });

  $$('[data-close]').forEach(b => b.addEventListener("click", closeModal));
  $("#modal-save").addEventListener("click", saveModal);
  $("#modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();  // backdrop click
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#modal").classList.contains("open")) closeModal();
  });
})();
