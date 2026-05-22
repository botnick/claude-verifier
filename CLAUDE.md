# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
./run.sh                          # macOS / Linux — installs deps on first run, then npm start
run.bat                           # Windows equivalent
npm start                         # direct launch (assumes `npm install` already ran)
ANTHROPIC_API_KEY=... npm run build-golden    # rebuild data/golden.json from real Anthropic API
```

There is no build step, no test runner, and no linter. Electron is the only runtime dependency. Requires Node 18+.

## Project-folder rule (load-bearing)

**Nothing this app produces ever lands outside the project directory.** No `~/Documents`, no `app.getPath('userData')` for app-generated state, no `localStorage` for persistent user data. The hard-coded paths in `main.js`:

```
<project>/data/golden.json         — reference baseline (read by renderer on init)
<project>/data/custom-probes.json  — user-imported probe packs
<project>/reports/<stamp>.md       — auto-saved reports after every run
```

If you add a new persistence concern, add it under `<project>/data/` via an IPC handler — don't take the easy `app.getPath('documents')` route.

## Architecture

Six files matter; the rest are presentation:

- **`main.js`** — Electron main process. BrowserWindow + IPC. All network egress (chat probes, paste-host uploads) happens here so the API key never touches a renderer/web origin and CORS doesn't apply.
- **`preload.js`** — `contextBridge` exposes a minimal typed `window.api` surface (`chat`, `saveFile`, `saveMdAuto`, `openFile`, `loadGolden`, `loadCustomProbes`, `saveCustomProbes`, `pushMd`, `platform`). The renderer has no Node access.
- **`public/tests.js`** — Probe catalog (47 probes). Loaded as a classic `<script>` so it becomes a top-level `const TESTS` for the renderer, AND it ships a Node `module.exports` footer so `tools/build-golden.js` can require the same source of truth.
- **`public/app.js`** — Renderer. Run loop with parallel concurrency + Stop/Resume, `judge()` verdict logic with confidence, MD report builder, auto-finish (save + push + clipboard), golden similarity, probe pack import/export.
- **`tools/build-golden.js`** — Baseline generator. Reads `public/tests.js`, runs each probe N times against the real Anthropic API, writes `data/golden.json`. Requires `ANTHROPIC_API_KEY`.

### Claude Code request emulation (load-bearing)

`main.js` does not send a plain Anthropic Messages request. Every call is wrapped to mimic the real `claude-cli` fingerprint: `user-agent: claude-cli/<ver>`, `x-app: cli`, full `x-stainless-*` set, `anthropic-beta` flags, a `system` block matching Claude Code's preamble, a `metadata.user_id` derived from `sha256(apiKey)`, and the full `tools` array. The point is that endpoints can't behave differently for "verifier" traffic vs genuine Claude Code traffic. **Do not strip or simplify these headers/body fields without understanding why — that's the whole product.** Constants live at the top of `main.js` (`CC_VERSION`, `CC_SDK_VERSION`, `CC_ANTHROPIC_BETA`, `CC_SYSTEM_PROMPT`, `CC_TOOLS`). The Node generator in `tools/build-golden.js` duplicates these constants on purpose so its requests have the same fingerprint.

### Sandbox fallback (load-bearing)

Because we include `tools` on every request, the model sometimes replies with a pure `tool_use` turn (no text content) — which would leave the keyword verdict with nothing to match. The `chat` IPC handler handles this transparently:

1. Attempt 1: `chatOnce({ withTools: true })` — true 1:1 with CC traffic.
2. If `r1.ok && r1.has_tool_use && !r1.has_text` → Attempt 2: same request with `withTools: false`, returned as the result with `sandboxed: true` and `sandbox_first_tools: [...]` so the renderer can surface "first reply was tool_use, retried without tools".
3. Any other shape (text present, error, network fail) returns immediately.

`latency_ms` is summed across both attempts so the user sees the true wall-clock cost. The `text` field always reflects what the renderer should run `judge()` against.

### Run loop: parallel + Stop + Resume

`runSelected({ resume })` in `public/app.js`:

- Pulls probes from a `runPool(items, concurrency, worker)` iterator-based pool (default `state.concurrency = 4`). Workers stop pulling new items when `state.abortRun` flips; in-flight probes finish naturally.
- On a fresh run, `state.lastRunPlan = [test_id...]` is set to the full plan; `state.results` is wiped.
- On Stop: `state.lastRunPlan` is preserved, the Resume button surfaces, and the partial result set runs through `autoFinishReport({ stopped: true, totalPlanned })` so even a stopped run produces a PARTIAL MD report.
- On Resume: `runSelected({ resume: true })` runs only `lastRunPlan \ completed_ids`, keeps `state.results` and accumulates new rows. Completing all probes resets `lastRunPlan` and produces a fresh combined report.

The MD report's hero badge encodes the run state: `PASS — looks genuine`, `REVIEW — inconclusive`, `FAIL — likely NOT Claude`, or `PARTIAL — X/Y probes done` when stopped.

### Verdict + confidence + fingerprint signals

`public/app.js`:

- **`judge(test, text)`** — case-insensitive substring match against `expect_any` and `red_flag` keyword lists. Returns `{ label, notes, confidence }` where confidence is in `[0, 1]` and reflects how strong the keyword evidence is (saturating at ~3 matches). Tune by editing keyword lists — not by adding new abstraction.
- **Latency anomaly** — when ≥5 probes complete, the MD report shows latency coefficient-of-variation. CV < 0.18 → "suspiciously uniform" (proxy / cache hint). CV > 1.6 → "highly variable" (network noise or genuine response-length variance).
- **Response shape fingerprint** — `stop_reason` mix + avg `chars/output_token`. Claude on Anthropic tends to ~3–6 chars/output-token and almost always ends with `end_turn`. Heavy skew is a signal.
- **Response headers** — Detail tab surfaces a curated allowlist (`anthropic-*`, `x-anthropic*`, `x-ratelimit*`, `request-id`, `via`, `server`, `cf-ray`, `x-served-by`, `x-forwarded-*`, `x-aws*`, `x-google*`, `x-proxy*`). The renderer stores `row.headers` in full; only the allowlist renders.

### Golden similarity

Optional reference dataset at `data/golden.json` (shape: `{ version, model, samples_per_probe, probes: { [test_id]: [{ text, ... }] } }`). On init the renderer calls `window.api.loadGolden()`; if present, every probe result gets `row.golden = { mean, max, min, samples }` computed via `similarity(text, baseline)`:

- **`similarity()`** — character-bigram cosine. Language-agnostic (works for Thai / Chinese / Arabic without tokenizers), no deps, range `[0, 1]`. Defined in `public/app.js`.
- **Thresholds** the renderer treats as semantic: `≥ 0.6` close to genuine · `≥ 0.35` partially diverging · `< 0.35` clearly different. Surfaced as colored `golden-sim` in the Console log during runs, in the Detail tab, and in the MD report (per-test + aggregate row).

**User-added probes that aren't in golden have no baseline.** `compareToGolden()` returns `null`, every display site skips silently, nothing breaks. Adding baselines for new probes = rerun `npm run build-golden` against the real Anthropic API after adding the probe to `public/tests.js`.

### Probe pack (community sharing)

Import/Export in the catalog header speak a single JSON format:

```json
{
  "format": "claude-verifier-probe-pack",
  "version": 1,
  "name": "…",
  "description": "…",
  "probes": [ { "id", "cat", "title", "prompt", "expect_any", "red_flag" } ]
}
```

`exportProbePack()` exports the ticked subset if any probes are ticked, else the full catalog. **No endpoint, key, or model is ever stored or shipped in a pack — strictly probes + metadata.**

`importProbePack()` validates the format, skips id collisions (built-in + previously imported), tags accepted probes with `_custom: true`, persists to `data/custom-probes.json` via IPC, rebuilds the catalog, and pre-selects the newly-imported probes. Custom probes show a `custom` badge + accent border in the catalog and are removable via right-click.

### Auto-finish

When `runSelected` finishes (or stops with partial results), `autoFinishReport(cfg, runMeta)` does three things in series:

1. **Save locally** — `window.api.saveMdAuto(filename, md)` writes to `<project>/reports/<filename>.md`.
2. **Publish to a paste host** — `window.api.pushMd(md)` tries a fallback chain (rentry.co → dpaste.org → paste.rs) until one succeeds. URL is copied to clipboard via `navigator.clipboard.writeText`.
3. **Render finish links** — pill in the action bar (clickable URL) + block at the bottom of the Summary tab (URL + local path + edit code if applicable).

The chain is intentionally undocumented in user-facing UI text (per design preference). Code comments in `main.js` document it.

### Endpoint + response normalization

`normalizeEndpoint()` in `main.js` accepts `api.anthropic.com`, `https://api.anthropic.com`, `https://api.anthropic.com/`, `https://api.anthropic.com/v1/messages` — auto-adds scheme, strips trailing slash, appends `/v1/messages` if no `/vN/` segment is present. Any endpoint speaking the Anthropic Messages format works (Bedrock proxy, LiteLLM, internal gateways).

Response shape is flattened by `chatOnce` in `main.js`: `text` concatenates all `text` content blocks (or `[tool_use: ...]` if only tool calls came back); `usage` is normalized across Anthropic (`input_tokens`/`output_tokens`) and OpenAI-style proxies (`prompt_tokens`/`completion_tokens`); `body_raw` only ships on error/parse-failure to keep IPC payloads small.

### Keyboard shortcuts

Wired globally in `init()`:

- `⌘↩` / `Ctrl+Enter` — Run selected
- `⇧⌘↩` / `Ctrl+Shift+Enter` — Run ALL
- `Esc` — Stop (only when a run is in flight)
- `⌘K` / `Ctrl+K` — focus API key field
- `⌘L` / `Ctrl+L` — focus endpoint field

## Code conventions

- Comments explain *why* (sandbox rationale, `body_raw` size optimization, CORS avoidance, project-folder rule). Preserve that style when editing; don't strip context comments.
- The renderer must never get direct `ipcRenderer` or Node — extend `preload.js` `contextBridge` surface instead.
- New persistent state goes under `<project>/data/` via an IPC handler. Never `~/Documents`, never `app.getPath('userData')`, never `localStorage` (which lives outside the project folder on disk).
- `TESTS` is the single source of truth. Renderer reads from it directly; Node tools require `public/tests.js`. Don't duplicate the catalog elsewhere.
