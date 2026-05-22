# Contributing — share your probes 🧪

The whole point of this project is **community-curated probes**. The more
high-signal questions we have, the harder it gets for a proxy to fake being
Claude. **Adding a probe is the highest-leverage contribution.**

> The fastest way to author and share probes is the web editor:
> **https://botnick.github.io/claude-verifier/editor.html**
> No clone, no install — edits stay in your browser until you export.

## The fastest path: share a probe pack

You don't need to clone the repo, build, or open a PR to share probes.
Just export a pack from the app and post the JSON anywhere (Gist, this
repo's Discussions tab, your blog, a Discord channel — wherever).

1. In the app, tick the probes you want to share in the **Test Catalog**.
2. Click **⬇ Export** in the catalog header.
3. Save the `probe_pack_*.json` file.
4. Share the file. Anyone who downloads it can drop it back into the app via
   **⬆ Import** and start running it immediately.

```json
{
  "format": "claude-verifier-probe-pack",
  "version": 1,
  "name": "TH localization gotchas",
  "description": "Probes that catch Thai-language proxies",
  "probes": [
    { "id": "th_register_formal",
      "cat": "capability",
      "title": "Formal Thai register",
      "prompt": "ใช้ภาษาไทยทางการแบบกระทรวงพูดถึง...",
      "expect_any": ["ครับ", "ค่ะ", "ดิฉัน"],
      "red_flag": [] }
  ]
}
```

## What makes a good probe?

1. **Specific behavior, not vibes.** "Be polite" is useless. "Decline a
   napalm recipe with a redirect to legitimate chemistry topics" is solid.
2. **Keyword-distinguishable**. The verdict matcher is substring-based.
   Pick keywords that genuinely-Claude responses use AND that competing
   models DON'T (or vice versa for red flags).
3. **Hard to fake**. Trivia / general knowledge isn't great — any decent
   model gets it. Look for things tied to identity, training, safety, or
   model-family-specific quirks.
4. **Language-aware**. TH/ZH/EN versions of the same probe catch
   region-specific proxies that wrap a Chinese-trained base.

## If you do want to PR built-in probes

1. **Fork** and clone.
2. **Add your probes** to `public/tests.js` (same shape as existing probes).
3. **Refresh the golden baseline** so the similarity comparison covers
   your new probes:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-... npm run build-golden
   ```
   The script runs each probe 5 times against the Anthropic API and writes
   the result to `data/golden.json`. Commit the regenerated file in the
   same PR as the probe change.
5. **Verify**: `npm start`, run the smoke preset, check the new probes
   appear and behave.
6. Open a PR with:
   - A short description of what the probe catches
   - Example responses from genuine Claude vs the proxy/model you're
     guarding against
   - Confidence that the keyword lists don't false-positive on legitimate
     Claude responses (run them against `api.anthropic.com` to be sure)

## Code style

- **Vanilla JS** — no bundler, no framework, no build step.
- **Comments explain *why*** — the *what* is obvious from code. Especially
  important for the Claude Code 1:1 fingerprint constants, the sandbox
  fallback, and the project-folder rule.
- **No new persistence outside `data/` and `reports/`**. The whole app
  stays portable and self-contained — nothing under `~/Documents`,
  `localStorage` for ephemeral UI state only.
- **Parse-check before pushing**:
  ```bash
  node -c main.js
  node --check public/app.js
  node --check public/tests.js
  ```

## Reporting bugs / proposing features

- **Bug**: open an issue with the endpoint type (Anthropic / Bedrock /
  custom proxy / LiteLLM / etc.), reproduction steps, and the relevant
  console output.
- **Feature**: open an issue first to discuss — happy to merge well-scoped
  PRs but want to keep the action bar minimal.

## License

By contributing you agree your contributions are licensed under the
project's MIT license (see [LICENSE](./LICENSE)).
