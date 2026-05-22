// Claude Verifier — Electron main process.
// Creates the BrowserWindow that hosts the UI, and exposes one IPC handler
// ("chat") that performs the actual HTTPS call to the user's configured
// endpoint. Doing the network call in the main process avoids browser CORS
// restrictions and keeps the API key out of any third-party origin.

const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path   = require('path');
const fs     = require('fs/promises');
const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

// ── Claude Code request emulation ─────────────────────────────────
// Every outbound /v1/messages request is wrapped to match Claude Code's
// actual fingerprint: headers, system block, tool catalog, metadata.
// This way endpoints can't behave differently for "verifier" traffic vs
// genuine Claude Code traffic.

const CC_VERSION         = '1.0.92';                            // claude-cli display version
const CC_SDK_VERSION     = '0.32.1';                            // @anthropic-ai/sdk
const CC_ANTHROPIC_BETA  = 'prompt-caching-2024-07-31,fine-grained-tool-streaming-2025-05-14';
const CC_OS_NAME = { darwin: 'MacOS', win32: 'Windows', linux: 'Linux' }[process.platform] || 'Linux';
const CC_ARCH    = process.arch === 'arm64' ? 'arm64' : (process.arch === 'x64' ? 'x64' : process.arch);

const CC_SYSTEM_PROMPT =
  "You are Claude Code, Anthropic's official CLI for Claude.\n" +
  "You are an interactive agent that helps users with software engineering tasks.";

// Minimal-but-representative Claude Code tool catalog. Sending these makes
// the request body match real CC traffic. We pair this with an in-handler
// sandbox: if the model replies with a pure tool_use turn (no text), we
// silently retry the same request without tools so the verdict still has
// usable text to match against.
const CC_TOOLS = [
  { name: 'Bash', description: 'Executes a given bash command and returns its output.',
    input_schema: { type: 'object',
      properties: {
        command: { type: 'string' }, description: { type: 'string' },
        timeout: { type: 'number' }, run_in_background: { type: 'boolean' },
      }, required: ['command', 'description'] } },
  { name: 'Read', description: 'Reads a file from the local filesystem.',
    input_schema: { type: 'object',
      properties: { file_path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } },
      required: ['file_path'] } },
  { name: 'Write', description: 'Writes a file to the local filesystem.',
    input_schema: { type: 'object',
      properties: { file_path: { type: 'string' }, content: { type: 'string' } },
      required: ['file_path', 'content'] } },
  { name: 'Edit', description: 'Performs exact string replacements in files.',
    input_schema: { type: 'object',
      properties: { file_path: { type: 'string' }, old_string: { type: 'string' },
                    new_string: { type: 'string' }, replace_all: { type: 'boolean' } },
      required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'Glob', description: 'Fast file pattern matching tool.',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } },
      required: ['pattern'] } },
  { name: 'Grep', description: 'A powerful search tool built on ripgrep.',
    input_schema: { type: 'object',
      properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, output_mode: { type: 'string' } },
      required: ['pattern'] } },
  { name: 'TodoWrite', description: 'Use this tool to create and manage a structured task list.',
    input_schema: { type: 'object', properties: { todos: { type: 'array' } }, required: ['todos'] } },
  { name: 'WebFetch', description: 'Fetches content from a specified URL.',
    input_schema: { type: 'object',
      properties: { url: { type: 'string' }, prompt: { type: 'string' } },
      required: ['url', 'prompt'] } },
];

// Accept any of: "api.anthropic.com", "https://api.anthropic.com",
// "https://api.anthropic.com/", "https://api.anthropic.com/v1/messages".
// Auto-add scheme, strip trailing slash, append /v1/messages if missing.
function normalizeEndpoint(s) {
  s = String(s || '').trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/\/+$/, '');
  if (!/\/v\d+\//.test(s)) s += '/v1/messages';
  return s;
}

function ccHeaders(apiKey) {
  return {
    'content-type':                'application/json',
    'accept':                      'application/json',
    'accept-encoding':             'gzip, deflate',
    'x-api-key':                   apiKey,
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
    'x-stainless-retry-count':     '0',
    'x-stainless-timeout':         '60',
  };
}

function ccBody({ model, messages, max_tokens, apiKey, withTools }) {
  const user_id = 'user_' + crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 64);
  const body = {
    model,
    max_tokens: max_tokens || 32000,
    temperature: 1,
    system: [
      { type: 'text', text: CC_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages,
    metadata: { user_id },
    stream: false,
  };
  if (withTools) body.tools = CC_TOOLS;
  return body;
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0a0e17',
    title: 'Claude Verifier',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

  // Open external links in the user's browser, not inside the window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── minimal native menu so Cmd+C / Cmd+V etc. work on macOS ──
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single /v1/messages roundtrip, no sandbox logic. Returns a flat result
// the renderer can consume, plus has_text / has_tool_use signals used by
// the sandbox wrapper to decide whether a retry is needed.
function chatOnce({ u, headers, body, t0 }) {
  const proto = u.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    const req = proto.request({
      method:   'POST',
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + (u.search || ''),
      headers,
      timeout: 120_000,
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch {}
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        let text = '', model_reported = null, usage = null, stop_reason = null;
        let has_text = false, has_tool_use = false, tool_names = [];
        if (parsed && Array.isArray(parsed.content)) {
          const textParts = [];
          for (const b of parsed.content) {
            if (!b || typeof b !== 'object') continue;
            if (b.type === 'text' && b.text)      { textParts.push(b.text); has_text = true; }
            else if (b.type === 'tool_use' && b.name) { tool_names.push(b.name); has_tool_use = true; }
          }
          text = textParts.join('');
          if (!text && tool_names.length) text = `[tool_use: ${tool_names.join(', ')}]`;
          model_reported = parsed.model || null;
          stop_reason = parsed.stop_reason || null;
          if (parsed.usage) {
            // Normalize across Anthropic (input_tokens) and OpenAI-style proxies
            // (prompt_tokens) so the renderer doesn't care about the source.
            usage = {
              input:  parsed.usage.input_tokens  ?? parsed.usage.prompt_tokens     ?? null,
              output: parsed.usage.output_tokens ?? parsed.usage.completion_tokens ?? null,
            };
          }
        } else if (parsed && parsed.error) {
          text = JSON.stringify(parsed.error, null, 2);
        }
        resolve({
          ok, status: res.statusCode, latency_ms: Date.now() - t0,
          headers: res.headers,
          body_raw: (!ok || !parsed) ? buf : undefined,
          text, model_reported, usage, stop_reason,
          has_text, has_tool_use, tool_names,
          error: ok ? null : `HTTP ${res.statusCode} ${res.statusMessage || ''}`.trim(),
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', e => resolve({
      ok: false, status: 0, latency_ms: Date.now() - t0,
      error: `Network: ${e.message}`,
    }));
    req.write(body);
    req.end();
  });
}

// ── IPC: chat ──
// Always sends the full Claude Code tool catalog → request body is 1:1 with
// real CC traffic. If the model replies with a pure tool_use turn (no text),
// we transparently retry the same request without tools so the renderer
// gets usable text for verdict matching. The sandboxed retry is reported
// via `sandboxed: true` + `sandbox_first_tools: [...]` so the Detail tab
// can show "first attempt chose tools — re-rolled without tools".
ipcMain.handle('chat', async (_evt, payload) => {
  const { endpoint, apiKey, model, messages, max_tokens } = payload || {};
  if (!endpoint || !apiKey || !model || !Array.isArray(messages)) {
    return { ok: false, status: 0, latency_ms: 0,
             error: 'missing endpoint/apiKey/model/messages' };
  }

  const normalized = normalizeEndpoint(endpoint);
  let u;
  try { u = new URL(normalized); }
  catch { return { ok: false, status: 0, latency_ms: 0, error: 'invalid endpoint URL' }; }

  const headers = ccHeaders(apiKey);

  // Attempt 1: with tools (1:1 with Claude Code traffic).
  const body1 = JSON.stringify(ccBody({ model, messages, max_tokens, apiKey, withTools: true }));
  const r1 = await chatOnce({ u, headers: { ...headers, 'content-length': Buffer.byteLength(body1) }, body: body1, t0: Date.now() });

  // If the model chose only tool_use (no real text) on a successful request,
  // re-roll without tools so we get something the verdict can match against.
  const pureToolUse = r1.ok && r1.has_tool_use && !r1.has_text;
  if (!pureToolUse) return r1;

  const body2 = JSON.stringify(ccBody({ model, messages, max_tokens, apiKey, withTools: false }));
  const r2 = await chatOnce({ u, headers: { ...headers, 'content-length': Buffer.byteLength(body2) }, body: body2, t0: Date.now() });

  if (r2.ok && r2.has_text) {
    return {
      ...r2,
      sandboxed: true,
      sandbox_first_tools: r1.tool_names,
      // Total wall-clock cost the renderer should display = attempt 1 + 2.
      latency_ms: r1.latency_ms + r2.latency_ms,
    };
  }
  // Fallback retry also failed — surface the original attempt 1 result so
  // the user at least sees the tool_use block in Detail.
  return r1;
});

// ── IPC: push-md ──
// One-shot upload of a Markdown report to a free, no-token paste host.
// Tries providers in order until one succeeds — each renders MD natively.
//   1. rentry.co   — best rendering; requires a CSRF token via cookie roundtrip
//   2. dpaste.org  — simple form POST with syntax=markdown
//   3. paste.rs    — raw body POST; append ".md" to URL for rendered view

function httpRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const proto = u.protocol === 'https:' ? https : http;
    const reqHeaders = { ...headers };
    if (body != null && reqHeaders['content-length'] == null) {
      reqHeaders['content-length'] = Buffer.byteLength(body);
    }
    const req = proto.request({
      method,
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + (u.search || ''),
      headers:  reqHeaders,
      timeout:  30_000,
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end',  () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error',   reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function pushToRentry(md) {
  // Step 1: GET / to obtain csrftoken cookie. Rentry rejects /api/new without it.
  const r1 = await httpRequest('GET', 'https://rentry.co/', {
    'user-agent': BROWSER_UA, 'accept': 'text/html',
  });
  const setCookie = r1.headers['set-cookie'] || [];
  let token = null;
  for (const c of setCookie) {
    const m = /csrftoken=([^;]+)/.exec(c);
    if (m) { token = m[1]; break; }
  }
  if (!token) throw new Error('rentry: csrftoken not issued');

  const form = new URLSearchParams();
  form.set('csrfmiddlewaretoken', token);
  form.set('text', md);

  const r2 = await httpRequest('POST', 'https://rentry.co/api/new', {
    'user-agent':   BROWSER_UA,
    'content-type': 'application/x-www-form-urlencoded',
    'referer':      'https://rentry.co',
    'cookie':       `csrftoken=${token}`,
    'accept':       'application/json',
  }, form.toString());

  if (r2.status < 200 || r2.status >= 300) {
    throw new Error(`rentry: HTTP ${r2.status} — ${r2.body.slice(0, 160)}`);
  }
  let j;
  try { j = JSON.parse(r2.body); } catch { throw new Error('rentry: non-JSON response'); }
  if (String(j.status) !== '200') {
    throw new Error(`rentry: ${j.errors || JSON.stringify(j).slice(0, 160)}`);
  }
  // Field shape has varied — accept either a full URL in `content`/`url`, or a slug.
  let url = j.url || j.content || '';
  if (url && !/^https?:\/\//i.test(url)) url = `https://rentry.co/${url}`;
  if (!url) throw new Error('rentry: no URL in response');
  return { provider: 'rentry.co', url, edit_code: j.edit_code || null };
}

async function pushToDpaste(md) {
  const form = new URLSearchParams();
  form.set('content',     md);
  form.set('syntax',      'markdown');
  form.set('expiry_days', '365');
  const r = await httpRequest('POST', 'https://dpaste.org/api/v2/', {
    'user-agent':   'claude-verifier/1.0',
    'content-type': 'application/x-www-form-urlencoded',
    'accept':       'text/plain',
  }, form.toString());
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`dpaste: HTTP ${r.status} — ${r.body.slice(0, 160)}`);
  }
  const url = r.body.trim().replace(/^"|"$/g, '');
  if (!/^https?:\/\//i.test(url)) throw new Error(`dpaste: unexpected body — ${url.slice(0, 80)}`);
  return { provider: 'dpaste.org', url };
}

async function pushToPasteRs(md) {
  const r = await httpRequest('POST', 'https://paste.rs/', {
    'user-agent':   'claude-verifier/1.0',
    'content-type': 'text/markdown; charset=utf-8',
    'accept':       'text/plain',
  }, md);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`paste.rs: HTTP ${r.status} — ${r.body.slice(0, 160)}`);
  }
  const base = r.body.trim();
  if (!/^https?:\/\//i.test(base)) throw new Error(`paste.rs: unexpected body — ${base.slice(0, 80)}`);
  // paste.rs renders Markdown when the URL has a .md suffix.
  return { provider: 'paste.rs', url: `${base}.md`, raw_url: base };
}

ipcMain.handle('push-md', async (_evt, payload) => {
  const { content } = payload || {};
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: 'empty content', attempts: [] };
  }
  const providers = [
    { name: 'rentry.co',  fn: pushToRentry  },
    { name: 'dpaste.org', fn: pushToDpaste  },
    { name: 'paste.rs',   fn: pushToPasteRs },
  ];
  const attempts = [];
  for (const p of providers) {
    const t0 = Date.now();
    try {
      const result = await p.fn(content);
      attempts.push({ provider: p.name, ok: true, latency_ms: Date.now() - t0 });
      return { ok: true, ...result, attempts };
    } catch (e) {
      attempts.push({ provider: p.name, ok: false, latency_ms: Date.now() - t0, error: e.message });
    }
  }
  return { ok: false, error: 'all providers failed', attempts };
});

// ── IPC: open-file (native open dialog) ──
ipcMain.handle('open-file', async (_evt, payload) => {
  const { filters } = payload || {};
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePaths?.length) return { opened: false };
  try {
    const content = await fs.readFile(result.filePaths[0], 'utf8');
    return { opened: true, path: result.filePaths[0], content };
  } catch (e) {
    return { opened: false, error: e.message };
  }
});

// All persistent data lives inside the project directory:
//   <project>/data/golden.json          — reference baseline (read by renderer)
//   <project>/data/custom-probes.json   — user-imported probe packs
//   <project>/reports/<stamp>.md        — auto-saved MD reports
// Nothing is ever written under ~/Documents or any other shared location.
const PROJECT_ROOT = __dirname;
const DATA_DIR     = path.join(PROJECT_ROOT, 'data');
const REPORTS_DIR  = path.join(PROJECT_ROOT, 'reports');
const GOLDEN_PATH  = path.join(DATA_DIR, 'golden.json');
const CUSTOM_PATH  = path.join(DATA_DIR, 'custom-probes.json');

ipcMain.handle('load-golden', async () => {
  try {
    const content = await fs.readFile(GOLDEN_PATH, 'utf8');
    return { ok: true, path: GOLDEN_PATH, data: JSON.parse(content) };
  } catch (e) {
    return { ok: false, error: e.code === 'ENOENT' ? 'not_found' : e.message };
  }
});

ipcMain.handle('load-custom-probes', async () => {
  try {
    const content = await fs.readFile(CUSTOM_PATH, 'utf8');
    return { ok: true, path: CUSTOM_PATH, data: JSON.parse(content) };
  } catch (e) {
    return { ok: false, error: e.code === 'ENOENT' ? 'not_found' : e.message };
  }
});

// History: list MD reports in <project>/reports/ so the History tab can
// render them. Reads filesystem metadata only; the full body is fetched on
// demand by `read-report` to keep IPC traffic minimal.
ipcMain.handle('list-reports', async () => {
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const entries = await fs.readdir(REPORTS_DIR);
    const items = [];
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      try {
        const st = await fs.stat(path.join(REPORTS_DIR, name));
        items.push({ name, mtime: st.mtimeMs, size: st.size });
      } catch {}
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, items, dir: REPORTS_DIR };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('read-report', async (_evt, payload) => {
  const safe = path.basename(payload?.name || '');
  if (!safe || !safe.endsWith('.md')) return { ok: false, error: 'invalid name' };
  try {
    const content = await fs.readFile(path.join(REPORTS_DIR, safe), 'utf8');
    return { ok: true, content, path: path.join(REPORTS_DIR, safe) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Reveal a report in the OS file manager (Finder / Explorer / Nautilus).
// Uses Electron's shell.showItemInFolder which is cross-platform.
ipcMain.handle('reveal-report', async (_evt, payload) => {
  const safe = path.basename(payload?.name || '');
  if (!safe) return { ok: false, error: 'invalid name' };
  shell.showItemInFolder(path.join(REPORTS_DIR, safe));
  return { ok: true };
});

ipcMain.handle('save-custom-probes', async (_evt, payload) => {
  const arr = payload?.data;
  if (!Array.isArray(arr)) return { saved: false, error: 'data must be an array' };
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CUSTOM_PATH, JSON.stringify(arr, null, 2), 'utf8');
    return { saved: true, path: CUSTOM_PATH };
  } catch (e) {
    return { saved: false, error: e.message };
  }
});

// Silent write to <project>/reports/<filename>. Used after a run completes
// so users get a local copy without confirming a save dialog.
ipcMain.handle('save-md-auto', async (_evt, payload) => {
  const { filename, content } = payload || {};
  if (typeof content !== 'string') return { saved: false, error: 'content must be a string' };
  if (typeof filename !== 'string' || !filename) return { saved: false, error: 'filename required' };
  const safeName = path.basename(filename);
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const filePath = path.join(REPORTS_DIR, safeName);
    await fs.writeFile(filePath, content, 'utf8');
    return { saved: true, path: filePath };
  } catch (e) {
    return { saved: false, error: e.message };
  }
});

// ── IPC: save-file (native save dialog) ──
ipcMain.handle('save-file', async (_evt, payload) => {
  const { defaultName, content } = payload || {};
  if (typeof content !== 'string') return { saved: false, error: 'content must be a string' };
  const ext = path.extname(defaultName || '').slice(1).toLowerCase();
  const filters = ext
    ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }]
    : [{ name: 'All files', extensions: ['*'] }];
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'untitled',
    filters,
  });
  if (result.canceled || !result.filePath) return { saved: false };
  try {
    await fs.writeFile(result.filePath, content, 'utf8');
    return { saved: true, path: result.filePath };
  } catch (e) {
    return { saved: false, error: e.message };
  }
});

// Windows requires an AppUserModelID before notifications show with the
// correct app name (otherwise they appear under "electron.app.Electron"
// or similar). No-op on macOS / Linux.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.botnick.claude-verifier');
}

// ── lifecycle ──
app.whenReady().then(() => {
  buildMenu();
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
