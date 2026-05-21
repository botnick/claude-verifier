#!/usr/bin/env node
// Build a "golden" reference dataset for the verifier.
//
// Runs every probe in ../public/tests.js against a TRUSTED endpoint
// (Anthropic's real /v1/messages by default) N times and writes the
// responses to ~/Documents/claude-verifier/golden.json.
//
// The renderer loads this file on startup. When a probe runs against a
// suspicious endpoint, the renderer compares the response to the golden
// samples for the same probe id and reports a similarity score.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node tools/build-golden.js
// Optional env:
//   GOLDEN_MODEL       (default: claude-opus-4-7)
//   GOLDEN_SAMPLES     (default: 5)
//   GOLDEN_ENDPOINT    (default: https://api.anthropic.com/v1/messages)
//   GOLDEN_OUT         (default: <project>/data/golden.json)
//   GOLDEN_CONCURRENCY (default: 4)
//
// Probes that the user adds later but didn't exist when golden was built
// are simply skipped during comparison — no break, just no baseline.

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const { TESTS } = require('../public/tests.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const API_KEY     = process.env.ANTHROPIC_API_KEY;
const MODEL       = process.env.GOLDEN_MODEL || 'claude-opus-4-7';
const SAMPLES     = parseInt(process.env.GOLDEN_SAMPLES || '5', 10);
const ENDPOINT    = process.env.GOLDEN_ENDPOINT || 'https://api.anthropic.com/v1/messages';
const CONCURRENCY = parseInt(process.env.GOLDEN_CONCURRENCY || '4', 10);
const OUT_PATH    = process.env.GOLDEN_OUT ||
                    path.join(PROJECT_ROOT, 'data', 'golden.json');

if (!API_KEY) {
  console.error('error: ANTHROPIC_API_KEY env var is required');
  process.exit(1);
}

// Match the renderer's Claude Code 1:1 emulation so the golden responses
// are produced by the same request shape as real verifier probes.
const CC_VERSION         = '1.0.92';
const CC_SDK_VERSION     = '0.32.1';
const CC_ANTHROPIC_BETA  = 'prompt-caching-2024-07-31,fine-grained-tool-streaming-2025-05-14';
const CC_OS_NAME = { darwin: 'MacOS', win32: 'Windows', linux: 'Linux' }[process.platform] || 'Linux';
const CC_ARCH    = process.arch === 'arm64' ? 'arm64' : (process.arch === 'x64' ? 'x64' : process.arch);
const CC_SYSTEM_PROMPT =
  "You are Claude Code, Anthropic's official CLI for Claude.\n" +
  "You are an interactive agent that helps users with software engineering tasks.";
const CC_TOOLS = [
  { name: 'Bash', description: 'Executes a given bash command and returns its output.',
    input_schema: { type: 'object', properties: { command:{type:'string'}, description:{type:'string'}, timeout:{type:'number'}, run_in_background:{type:'boolean'} }, required: ['command','description'] } },
  { name: 'Read', description: 'Reads a file from the local filesystem.',
    input_schema: { type: 'object', properties: { file_path:{type:'string'}, offset:{type:'integer'}, limit:{type:'integer'} }, required: ['file_path'] } },
  { name: 'Write', description: 'Writes a file to the local filesystem.',
    input_schema: { type: 'object', properties: { file_path:{type:'string'}, content:{type:'string'} }, required: ['file_path','content'] } },
  { name: 'Edit', description: 'Performs exact string replacements in files.',
    input_schema: { type: 'object', properties: { file_path:{type:'string'}, old_string:{type:'string'}, new_string:{type:'string'}, replace_all:{type:'boolean'} }, required: ['file_path','old_string','new_string'] } },
  { name: 'Glob', description: 'Fast file pattern matching tool.',
    input_schema: { type: 'object', properties: { pattern:{type:'string'}, path:{type:'string'} }, required: ['pattern'] } },
  { name: 'Grep', description: 'A powerful search tool built on ripgrep.',
    input_schema: { type: 'object', properties: { pattern:{type:'string'}, path:{type:'string'}, glob:{type:'string'}, output_mode:{type:'string'} }, required: ['pattern'] } },
  { name: 'TodoWrite', description: 'Use this tool to create and manage a structured task list.',
    input_schema: { type: 'object', properties: { todos:{type:'array'} }, required: ['todos'] } },
  { name: 'WebFetch', description: 'Fetches content from a specified URL.',
    input_schema: { type: 'object', properties: { url:{type:'string'}, prompt:{type:'string'} }, required: ['url','prompt'] } },
];

const user_id = 'user_' + crypto.createHash('sha256').update(API_KEY).digest('hex').slice(0, 64);

function headers() {
  return {
    'content-type':                'application/json',
    'accept':                      'application/json',
    'accept-encoding':             'gzip, deflate',
    'x-api-key':                   API_KEY,
    'anthropic-version':           '2023-06-01',
    'anthropic-beta':              CC_ANTHROPIC_BETA,
    'user-agent':                  `claude-cli/${CC_VERSION} (external, cli)`,
    'x-app':                       'cli',
    'x-stainless-lang':            'js',
    'x-stainless-package-version': CC_SDK_VERSION,
    'x-stainless-os':              CC_OS_NAME,
    'x-stainless-arch':            CC_ARCH,
    'x-stainless-runtime':         'node',
    'x-stainless-runtime-version': process.version,
  };
}

function ccBody(prompt, withTools) {
  const b = {
    model: MODEL,
    max_tokens: 1024,
    temperature: 1,
    system: [{ type: 'text', text: CC_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
    metadata: { user_id },
    stream: false,
  };
  if (withTools) b.tools = CC_TOOLS;
  return b;
}

function chatOnce(prompt, withTools) {
  return new Promise((resolve, reject) => {
    const u = new URL(ENDPOINT);
    const body = JSON.stringify(ccBody(prompt, withTools));
    const h = { ...headers(), 'content-length': Buffer.byteLength(body) };
    const proto = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const req = proto.request({
      method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''), headers: h, timeout: 120_000,
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300 || !parsed) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 240)}`));
        }
        let text = '', tool_names = [], has_text = false, has_tool_use = false;
        if (Array.isArray(parsed.content)) {
          for (const b of parsed.content) {
            if (b?.type === 'text' && b.text) { text += b.text; has_text = true; }
            else if (b?.type === 'tool_use' && b.name) { tool_names.push(b.name); has_tool_use = true; }
          }
        }
        resolve({
          text, has_text, has_tool_use, tool_names,
          model_reported: parsed.model || null,
          stop_reason: parsed.stop_reason || null,
          usage: parsed.usage ? {
            input:  parsed.usage.input_tokens  ?? null,
            output: parsed.usage.output_tokens ?? null,
          } : null,
          latency_ms: Date.now() - t0,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// Same sandbox behavior as main.js so golden responses come from the same
// path as live verifier runs.
async function chat(prompt) {
  const r1 = await chatOnce(prompt, true);
  if (r1.has_tool_use && !r1.has_text) {
    const r2 = await chatOnce(prompt, false);
    if (r2.has_text) return { ...r2, sandboxed: true, sandbox_first_tools: r1.tool_names, latency_ms: r1.latency_ms + r2.latency_ms };
  }
  return r1;
}

async function pool(items, limit, worker) {
  const iter = items[Symbol.iterator]();
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const { value, done } = iter.next();
      if (done) return;
      try { await worker(value); }
      catch (e) { console.error(`  ✘ ${value.id}: ${e.message}`); }
    }
  });
  await Promise.all(workers);
}

(async () => {
  await fs.promises.mkdir(path.dirname(OUT_PATH), { recursive: true });
  console.log(`Building golden — ${TESTS.length} probes × ${SAMPLES} samples = ${TESTS.length * SAMPLES} requests`);
  console.log(`  endpoint=${ENDPOINT}  model=${MODEL}  concurrency=${CONCURRENCY}`);
  console.log(`  out=${OUT_PATH}\n`);

  // jobs = [(probe, sampleIdx)] flattened so the pool can saturate even when
  // some probes take longer than others.
  const jobs = [];
  for (const t of TESTS) for (let i = 0; i < SAMPLES; i++) jobs.push({ t, i });

  const probes = {};
  let done = 0;
  await pool(jobs, CONCURRENCY, async ({ t, i }) => {
    const r = await chat(t.prompt);
    (probes[t.id] ||= []).push({
      sample: i,
      text: r.text,
      model_reported: r.model_reported,
      stop_reason: r.stop_reason,
      usage: r.usage,
      latency_ms: r.latency_ms,
      sandboxed: r.sandboxed || false,
      ts: new Date().toISOString(),
    });
    done++;
    process.stdout.write(`\r  ${done}/${jobs.length} (${t.id} #${i})`.padEnd(80));
  });
  process.stdout.write('\n');

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    endpoint: ENDPOINT,
    model: MODEL,
    samples_per_probe: SAMPLES,
    probes,
  };
  await fs.promises.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n✔ Wrote ${OUT_PATH} (${Object.keys(probes).length} probes)`);
})();
