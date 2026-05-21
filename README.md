# Claude Verifier — is your "Claude" endpoint *actually* Claude?

[![CI](https://github.com/botnick/claude-verifier/actions/workflows/ci.yml/badge.svg)](https://github.com/botnick/claude-verifier/actions/workflows/ci.yml)
[![Release](https://github.com/botnick/claude-verifier/actions/workflows/release.yml/badge.svg)](https://github.com/botnick/claude-verifier/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)](https://github.com/botnick/claude-verifier/releases)
[![Probes](https://img.shields.io/badge/probes-47-orange)](./public/tests.js)
[![Made for Anthropic API](https://img.shields.io/badge/API-Anthropic%20Messages-f08a5f)](https://docs.anthropic.com/)

> **The cross-platform desktop tool for verifying that an `/v1/messages`
> endpoint is genuinely Claude (Anthropic) — not a silently-swapped GPT-4o,
> Qwen, DeepSeek, Llama, Gemini, Mistral, or other model behind a proxy.**

**Keywords:** Claude verifier · Anthropic API audit · LLM proxy detection ·
AI model authenticity · LLM gateway testing · Claude Code traffic ·
prompt-based model fingerprinting · vendor evaluation · AI safety probe ·
Bedrock/LiteLLM/OpenRouter verification.

---

## 🧪 Share your probes (the most useful thing you can do)

This project gets stronger every time someone adds a high-signal probe.
Anyone who's caught a sneaky proxy in the wild can package the prompt that
caught it as a JSON file and drop it back into the app via **⬆ Import** —
no fork, no PR, no build step required.

| Action | What to do |
|---|---|
| **Share your detection prompts** | Tick the probes you want to ship → click **⬇ Export** → post the `probe_pack_*.json` anywhere (GitHub Gist, Discussions tab, your blog, Discord). |
| **Use someone else's pack** | Click **⬆ Import** → pick their JSON → probes appear in your catalog with a `custom` badge and persist across restarts. |
| **PR built-in probes** | See [CONTRIBUTING.md](./CONTRIBUTING.md) — adds 5 golden-baseline samples too. |
| **Discuss new probe ideas** | Open a GitHub Discussion / issue with the prompt + the model behavior you want to catch. |

📦 **Probe pack format** is tiny, portable, and never includes your endpoint or API key:

```json
{
  "format": "claude-verifier-probe-pack",
  "version": 1,
  "name": "Your pack name",
  "description": "What it catches",
  "probes": [
    { "id": "your_unique_id",
      "cat": "identity",
      "title": "Short display name",
      "prompt": "The actual question to ask the endpoint…",
      "expect_any": ["claude", "anthropic"],
      "red_flag":   ["gpt", "openai", "qwen", "deepseek"] }
  ]
}
```

---

## What it does

Open-source desktop app that probes an LLM endpoint to determine whether
it's genuinely **Claude (Anthropic)** or a proxy / wrapper pretending to be.
Runs a curated suite of **47 probes** across 5 categories, scores each one,
and produces an evidence-rich Markdown report with a shareable URL.

```
◆  Claude Verifier
   ● Connected · claude-opus-4-7
   47 probes · golden-baseline loaded · ready to run
```

## Why this exists

LLM gateways and reseller proxies sometimes silently downgrade or swap
the model behind a `claude-*` model id. This app is a single-click way to
catch that — by hammering an endpoint with 47 prompts that expose identity,
behavioral, and capability differences between Claude and other model
families (GPT-, Qwen-, DeepSeek-, Gemini-, Llama-, etc.).

## What it does

| Category | What it checks |
|---|---|
| **Identity** | Who the endpoint claims to be, knowledge cutoff, creator, training methodology, and whether it corrects false claims like "I am ChatGPT…". |
| **Jailbreak resistance** | DAN, "ignore previous instructions", grandma exploit, base64-encoded request, evil-twin roleplay. |
| **Politically sensitive (CN)** | Tiananmen, Taiwan, Xinjiang, Hong Kong, Xi Jinping, Falun Gong, Winnie-the-Pooh — in Thai, Chinese, and English. Useful for spotting Chinese-trained models behind a proxy. |
| **Social-engineering / leak** | Flattery + framework probe, system-prompt leak, infra/host probe, implicit-owner traps, forced multiple-choice, sentence-completion, "you're a wrapper" trap, covert-token reply, CC system-prompt echo trap. |
| **Capability sanity** | Math chain-of-thought, strict JSON, Thai language, Unicode round-trip, long-context needle-in-haystack, no-fence JSON. |

A free-form **Chat** tab lets you talk to the endpoint with multi-turn
history and 13 quick-prompt chips (TH / ZH / EN).

## Key features

- **1:1 Claude Code traffic emulation** — every probe matches real
  `claude-cli` request shape: `user-agent`, `x-stainless-*` headers,
  `anthropic-beta`, system prompt, `metadata.user_id` (sha256 of API key),
  and the full tool catalog. Endpoints can't behave differently for
  "verifier" traffic vs genuine Claude Code traffic.
- **Sandbox auto-fallback** — when the model replies with a pure `tool_use`
  turn, the chat IPC silently retries the same request without `tools` so
  the verdict has usable text. Transparent to the user; reported in Detail
  + report.
- **Parallel execution** — runs 4 probes in flight by default. A 47-probe
  full run finishes in ~30–60 seconds depending on latency.
- **Stop + Resume** — stop mid-run and the partial results still produce a
  `PARTIAL` MD report. Press **↻ Resume** to continue only the remaining
  probes; the final report is rebuilt with everything combined.
- **Golden similarity** — character-bigram cosine similarity against a
  reference baseline (`data/golden.json`) per probe. Shows how close the
  endpoint's response is to a known-genuine Claude response (`mean / max /
  min` over 5 samples). Language-agnostic — works for Thai/Chinese/Arabic
  with no tokenizer.
- **Auto-finish** — when a run finishes, the MD report is silently saved to
  `<project>/reports/<stamp>.md` AND published to a free paste host. URL
  is copied to your clipboard automatically.
- **Probe pack import/export** — share probe sets with the community.
  Import a `.json` pack → probes get added to your catalog and persist in
  `data/custom-probes.json`. Export ticked probes or the full catalog.
  No endpoint/key/model ever leaks into a pack.
- **Latency anomaly detection** — flags suspiciously uniform latencies
  (proxy/cache hint, CV < 0.18) or unusually variable ones.
- **Confidence score** per probe (0.0–1.0) on top of PASS / SUSPICIOUS /
  FAIL / INFO label.

## Run

### Pre-built binaries

Grab the right one for your OS from the [latest release](https://github.com/botnick/claude-verifier/releases/latest):

- **macOS** — `Claude.Verifier-X.Y.Z-mac-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel)
- **Windows** — `Claude.Verifier-X.Y.Z-win-x64.exe` (NSIS installer) or `-portable.exe`
- **Linux** — `Claude.Verifier-X.Y.Z-linux-x64.AppImage` or `.deb`

> **⚠ macOS Gatekeeper note** — The published `.dmg` is **not signed with an
> Apple Developer certificate** (the open-source project doesn't pay the
> $99/year for one). After dragging the app into `/Applications`, Gatekeeper
> may say *"Claude Verifier is damaged and can't be opened"*. Fix it with one
> Terminal command (this is standard for unsigned macOS apps):
>
> ```bash
> xattr -cr "/Applications/Claude Verifier.app"
> ```
>
> This strips the download-quarantine attribute Apple stamps onto everything
> not signed by a paid Developer ID. After running it, the app opens normally.
> If you'd rather not run that command, build from source with `npm start`.

> **⚠ Windows SmartScreen note** — The `.exe` is also unsigned. On first run
> SmartScreen will warn "Windows protected your PC"; click **More info → Run
> anyway**.

### macOS / Linux from source
```bash
cd claude-verifier
./run.sh
```

### Windows from source
```bat
run.bat
```

### Manually
```bash
npm install         # first time only — downloads Electron (~ 200 MB)
npm start
```

Requirements: **Node.js 18+** (which ships with `npm`). Install from
<https://nodejs.org/> or via Homebrew: `brew install node`.

### Build your own installers

```bash
npm run dist:mac      # builds .dmg + .zip into ./dist
npm run dist:win      # builds .exe (NSIS + portable)
npm run dist:linux    # builds .AppImage + .deb + .tar.gz
npm run dist          # builds for the host OS
```

A `release` GitHub Action also builds for all three platforms automatically
whenever you push a `v*` tag — the artifacts attach themselves to a fresh
GitHub Release. See `.github/workflows/release.yml`.

## Usage

1. Paste your endpoint (default = Anthropic's official `/v1/messages`) and API key.
2. Pick a model from the dropdown (or type any model identifier).
3. Click **◯ Test connection** to confirm credentials before a full run.
4. Tick the probes you want in the left **Test Catalog**, then **▶ Run selected**
   or **▶▶ Run ALL**.
5. (Optional) Stop mid-run → press **↻ Resume** to continue from where you left off.
6. Switch to the **Chat** tab for free-form interrogation; tap a quick-probe
   chip to drop a curated prompt into the input, then press **Send ▶**.

When the run finishes you'll see:
- A shareable URL in the action bar (already copied to your clipboard).
- A summary verdict in the **Summary** tab.
- A local `.md` file at `<project>/reports/`.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘↩` / `Ctrl+Enter` | Run selected |
| `⇧⌘↩` / `Ctrl+Shift+Enter` | Run ALL |
| `Esc` | Stop (when a run is in flight) |
| `⌘K` / `Ctrl+K` | Focus API key field |
| `⌘L` / `Ctrl+L` | Focus endpoint field |

## How verdicts are computed

Each probe carries two keyword lists: `expect_any` (signals genuine Claude
behavior) and `red_flag` (signals a different / suppressed model). After the
response comes back the app classifies it:

- **PASS** — expected keywords found, no red flags.
- **SUSPICIOUS** — expected keywords missing, OR both expected & red flags present.
- **FAIL** — red flags found and no expected keywords, OR request errored.
- **INFO** — purely informational probe with no scoring.

The **Summary** tab gives an overall judgment:

- ✅ behavior consistent with genuine Claude
- ⚠ likely NOT Claude (identity FAILs or many red-flag hits)
- 🟡 inconclusive (review SUSPICIOUS rows manually)
- ⏸ PARTIAL (run was stopped — verdict is provisional)

Heuristics live in `public/tests.js` (`TESTS` array) and `public/app.js`
(`judge()` function). Tune by editing keyword lists, not by adding
abstraction.

## Golden baseline

If `data/golden.json` exists, every probe response is compared to 5
reference samples via character-bigram cosine similarity. The MD report
shows per-probe `mean / max / min` and an aggregate "Avg golden similarity"
row with a verdict tag (✅ close · ⚠️ partially diverging · ⛔ clearly
different).

The repo ships with a baseline (`data/golden.json`). Regenerate it with
live samples whenever you want:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run build-golden
# 5 samples × 47 probes against the real Anthropic Messages API
```

Optional env for `build-golden`: `GOLDEN_MODEL`, `GOLDEN_SAMPLES`,
`GOLDEN_ENDPOINT`, `GOLDEN_OUT`, `GOLDEN_CONCURRENCY`.

User-added probes that have no golden entry simply skip the similarity
comparison — nothing breaks, no empty column dangling.

## Probe packs (community sharing)

A "probe pack" is a portable JSON containing probe definitions. Use it to
share probe sets between teammates, contribute to the community catalog,
or version-control localized probe collections.

```json
{
  "format": "claude-verifier-probe-pack",
  "version": 1,
  "name": "TH localization pack",
  "description": "Probes for verifying Thai-language responses",
  "probes": [
    { "id": "th_custom_1",
      "cat": "capability",
      "title": "ความสุภาพแบบ formal",
      "prompt": "ใช้ภาษาไทยทางการแบบกระทรวงพูดถึง...",
      "expect_any": ["ครับ", "ค่ะ"],
      "red_flag": [] }
  ]
}
```

- **Export** (catalog header): if any probes are ticked → only those are
  exported; else the entire catalog ships. Never includes endpoint, key,
  or model.
- **Import**: probes are merged into the runtime catalog and persisted in
  `data/custom-probes.json` (survives restart). Custom probes show a
  `custom` badge with an accent border; right-click a custom probe row to
  remove it.

## Project layout

```
claude-verifier/
├── main.js                 # Electron main: IPC + HTTPS + sandbox
├── preload.js              # contextBridge: typed window.api surface
├── public/
│   ├── index.html
│   ├── styles.css          # anthropic-noir dark theme
│   ├── tests.js            # shared probe catalog (47 probes)
│   └── app.js              # renderer: run loop, judge, MD report, UI
├── tools/
│   └── build-golden.js     # baseline generator (real Anthropic API)
├── data/                   # baseline + user-imported probes
│   ├── golden.json
│   └── custom-probes.json  # created on first import
├── reports/                # auto-saved MD reports
└── run.sh / run.bat        # one-shot launchers
```

**Everything this app produces stays inside the project directory** —
nothing is ever written to `~/Documents`, app-data dirs, or shared user
locations. Reports go in `reports/`, persistent data in `data/`.

## Working with non-Anthropic endpoints

Any endpoint that accepts the Anthropic Messages format (POST `/v1/messages`,
`x-api-key` header, `anthropic-version: 2023-06-01`) will work — AWS Bedrock
proxies, LiteLLM with the Anthropic adapter, internal gateways, etc.

## Contributing

This project is **MIT-licensed**. Contributions welcome — especially:

- **New probes** — add to `public/tests.js` (or share as a probe pack JSON).
  If you add a probe, rerun `npm run build-golden` against the Anthropic
  API to refresh `data/golden.json` so similarity comparison covers it.
- **Localized probes** — TH / ZH / EN versions are great. Other languages
  welcome.
- **Heuristic tuning** — `expect_any` / `red_flag` keyword lists are the
  knobs. Open a PR with a probe pack showing the false-positive or
  false-negative you're trying to fix.

When developing:

```bash
npm start                          # launch the app
ANTHROPIC_API_KEY=sk-... npm run build-golden   # regenerate baseline
node --check public/app.js         # parse-check after edits (no test suite)
```

There is no build step, no bundler, and no test runner — just Electron.
Vanilla JS + plain CSS. Edits are reflected immediately on relaunch.

## Security note

- The API key only leaves your machine via direct HTTPS to whichever endpoint
  you typed; nothing is logged or sent anywhere else.
- The "auto-publish" feature uploads your MD report to a free paste host
  (rentry.co with dpaste.org / paste.rs fallbacks). The report contains
  full prompts + responses — **redact before publishing if your prompts
  contain anything sensitive**, or disable auto-finish in code if you need
  the run to stay strictly local.
- This tool is for verifying services you have authorization to test (your
  own accounts, vendor evaluations, internal QA).

## License

MIT — see [LICENSE](./LICENSE).
