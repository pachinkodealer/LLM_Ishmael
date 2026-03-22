// The Ishmael Project — Web App
// Hybrid: WebLLM (in-browser, no key) on desktop with WebGPU,
//         Claude API (user key) on mobile / browsers without WebGPU.

import { WITNESS_SYSTEM_PROMPT } from './witness_character.js';

// ── Constants ──────────────────────────────────────────────────────

const WEBLLM_MODEL   = 'Llama-3.1-8B-Instruct-q4f32_1-MLC';
const CLAUDE_MODEL   = 'claude-sonnet-4-6';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const KEY_STORAGE    = 'witness_anthropic_key';
const SESSION_PREFIX = 'witness_session_';
const BACKEND_KEY    = 'witness_backend'; // 'webllm' | 'claude'

const ARC_ORDER  = ['economy', 'climate', 'ai', 'pattern', 'untagged'];
const ARC_TITLES = {
  economy:  'Part One — The Story of More',
  climate:  'Part Two — The Math We Refuse to Do',
  ai:       'Part Three — Machines That Think, Humans Who Wonder',
  pattern:  'Part Four — The Pattern',
  untagged: 'Appendix — Further Dialogues',
};

// ── State ──────────────────────────────────────────────────────────

let currentSession = null;
let isStreaming    = false;
let arcFilter      = 'all';
let webllmEngine   = null;
let backend        = null; // 'webllm' | 'claude'

// ── DOM refs ───────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const loadingScreen  = $('loading-screen');
const apikeyScreen   = $('apikey-screen');
const progressFill   = $('progress-bar-fill');
const progressText   = $('progress-text');
const apikeyInput    = $('apikey-input');
const apikeyError    = $('apikey-error');
const dialogue       = $('dialogue');
const emptyState     = $('empty-state');
const userInput      = $('user-input');
const btnSend        = $('btn-send');
const sessionList    = $('session-list');
const sidebar        = $('sidebar');
const sidebarBackdrop = $('sidebar-backdrop');
const arcChips       = document.querySelectorAll('.arc-chip');

// ── Startup ────────────────────────────────────────────────────────

async function init() {
  bindUI();

  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;

  if (hasWebGPU) {
    backend = 'webllm';
    localStorage.setItem(BACKEND_KEY, 'webllm');
    await initWebLLM();
  } else {
    backend = 'claude';
    localStorage.setItem(BACKEND_KEY, 'claude');
    loadingScreen.classList.add('hidden');

    const savedKey = getApiKey();
    if (savedKey) {
      showApp();
    } else {
      apikeyScreen.classList.remove('hidden');
    }
  }
}

// ── WebLLM ────────────────────────────────────────────────────────

async function initWebLLM() {
  try {
    const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');

    webllmEngine = await CreateMLCEngine(WEBLLM_MODEL, {
      initProgressCallback: (report) => {
        const pct = Math.round((report.progress || 0) * 100);
        progressFill.style.width = pct + '%';
        progressText.textContent = report.text || `Loading... ${pct}%`;
      }
    });

    loadingScreen.classList.add('hidden');
    showApp();
  } catch (err) {
    // WebGPU detected but engine failed — fall back to Claude
    console.warn('WebLLM failed, falling back to Claude API:', err);
    backend = 'claude';
    loadingScreen.classList.add('hidden');
    const savedKey = getApiKey();
    if (savedKey) {
      showApp();
    } else {
      apikeyScreen.classList.remove('hidden');
    }
  }
}

// ── Claude API ────────────────────────────────────────────────────

function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}

function setApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

function forgetApiKey() {
  localStorage.removeItem(KEY_STORAGE);
}

async function streamClaude(messages, onChunk) {
  const key = getApiKey();
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: WITNESS_SYSTEM_PROMPT,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   full    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value, { stream: true }).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          full += parsed.delta.text;
          onChunk(parsed.delta.text);
        }
      } catch (_) { /* skip malformed lines */ }
    }
  }

  return full;
}

async function streamWebLLM(messages, onChunk) {
  const stream = await webllmEngine.chat.completions.create({
    messages: [
      { role: 'system', content: WITNESS_SYSTEM_PROMPT },
      ...messages,
    ],
    stream: true,
    max_tokens: 1024,
    temperature: 0.7,
  });

  let full = '';
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? '';
    if (token) {
      full += token;
      onChunk(token);
    }
  }
  return full;
}

// ── Session Management ────────────────────────────────────────────

function newSession(arc = 'untagged') {
  const id = new Date().toISOString();
  return { id, arc, started_at: id, messages: [] };
}

function saveSession(session) {
  localStorage.setItem(SESSION_PREFIX + session.id, JSON.stringify(session));
}

function loadSession(id) {
  const raw = localStorage.getItem(SESSION_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}

function deleteSession(id) {
  localStorage.removeItem(SESSION_PREFIX + id);
}

function getAllSessions() {
  const sessions = [];
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(SESSION_PREFIX)) {
      try { sessions.push(JSON.parse(localStorage.getItem(key))); }
      catch (_) {}
    }
  }
  return sessions.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

function getLatestSession() {
  const all = getAllSessions();
  return all.length ? all[0] : null;
}

// ── Rendering ─────────────────────────────────────────────────────

function showApp() {
  renderSessionList();
  const latest = getLatestSession();
  if (latest) {
    openSession(latest.id);
  } else {
    startNewSession();
  }
}

function renderSessionList() {
  sessionList.innerHTML = '';
  const all = getAllSessions().filter(s =>
    arcFilter === 'all' || s.arc === arcFilter
  );

  if (all.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:0.78rem;color:var(--text-dim);padding:1rem;text-align:center;font-style:italic;';
    p.textContent = 'No sessions yet.';
    sessionList.appendChild(p);
    return;
  }

  for (const s of all) {
    const item = document.createElement('div');
    item.className = 'session-item' + (currentSession?.id === s.id ? ' active' : '');
    item.dataset.id = s.id;

    const preview = s.messages.length
      ? s.messages[0].content.slice(0, 60) + (s.messages[0].content.length > 60 ? '…' : '')
      : 'Empty session';

    const date = new Date(s.started_at).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    });

    item.innerHTML = `
      <span class="session-item-arc">${s.arc}</span>
      <span class="session-item-date">${date}</span>
      <span class="session-item-preview">${escapeHtml(preview)}</span>
    `;

    item.addEventListener('click', () => {
      openSession(s.id);
      closeSidebar();
    });

    sessionList.appendChild(item);
  }
}

function openSession(id) {
  currentSession = loadSession(id);
  if (!currentSession) return;
  renderDialogue();
  syncArcChips();
  renderSessionList(); // update active state
}

function startNewSession() {
  currentSession = newSession('untagged');
  saveSession(currentSession);
  renderDialogue();
  syncArcChips();
  renderSessionList();
  userInput.focus();
}

function renderDialogue() {
  dialogue.innerHTML = '';

  if (!currentSession || currentSession.messages.length === 0) {
    emptyState.classList.add('visible');
    return;
  }

  emptyState.classList.remove('visible');

  // Messages come in pairs: user → assistant
  const msgs = currentSession.messages;
  let i = 0;
  while (i < msgs.length) {
    const userMsg  = msgs[i];
    const asstMsg  = msgs[i + 1] || null;

    const exchange = document.createElement('div');
    exchange.className = 'exchange fade-in';

    exchange.appendChild(makeMessageBlock('narrator', userMsg.content));
    if (asstMsg) {
      exchange.appendChild(makeMessageBlock('witness', asstMsg.content));
    }

    dialogue.appendChild(exchange);
    i += 2;
  }

  scrollToBottom();
}

function makeMessageBlock(role, text) {
  const block = document.createElement('div');
  block.className = 'msg-block';

  const label = document.createElement('div');
  label.className = `msg-label ${role}`;
  label.textContent = role === 'narrator' ? 'Narrator' : 'The Witness';

  const body = document.createElement('div');
  body.className = `msg-text ${role}`;
  body.textContent = text;

  block.appendChild(label);
  block.appendChild(body);
  return block;
}

function syncArcChips() {
  if (!currentSession) return;
  arcChips.forEach(chip => {
    chip.classList.toggle('selected', chip.dataset.arc === currentSession.arc);
  });
}

function scrollToBottom() {
  dialogue.scrollTop = dialogue.scrollHeight;
}

// ── Send Message ──────────────────────────────────────────────────

async function sendMessage() {
  if (isStreaming || !currentSession) return;
  const text = userInput.value.trim();
  if (!text) return;

  isStreaming = true;
  userInput.value = '';
  autoResizeInput();
  btnSend.classList.remove('ready');
  emptyState.classList.remove('visible');

  // Add user message
  currentSession.messages.push({ role: 'user', content: text });

  // Create exchange block
  const exchange = document.createElement('div');
  exchange.className = 'exchange fade-in';
  exchange.appendChild(makeMessageBlock('narrator', text));

  // Witness block with streaming cursor
  const witnessBlock = document.createElement('div');
  witnessBlock.className = 'msg-block';

  const witnessLabel = document.createElement('div');
  witnessLabel.className = 'msg-label witness';
  witnessLabel.textContent = 'The Witness';

  const witnessBody = document.createElement('div');
  witnessBody.className = 'msg-text witness';

  const cursor = document.createElement('span');
  cursor.className = 'streaming-cursor';
  witnessBody.appendChild(cursor);

  witnessBlock.appendChild(witnessLabel);
  witnessBlock.appendChild(witnessBody);
  exchange.appendChild(witnessBlock);
  dialogue.appendChild(exchange);
  scrollToBottom();

  // Build messages array for API (exclude system — handled separately)
  const apiMessages = currentSession.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  let fullResponse = '';

  try {
    const onChunk = (token) => {
      // Insert before cursor
      witnessBody.insertBefore(document.createTextNode(token), cursor);
      scrollToBottom();
      fullResponse += token;
    };

    if (backend === 'webllm' && webllmEngine) {
      await streamWebLLM(apiMessages, onChunk);
    } else {
      await streamClaude(apiMessages, onChunk);
    }

    // Remove cursor
    cursor.remove();

    // Save
    currentSession.messages.push({ role: 'assistant', content: fullResponse });
    saveSession(currentSession);
    renderSessionList();

  } catch (err) {
    cursor.remove();
    witnessBody.textContent = '';

    const errEl = document.createElement('span');
    errEl.style.color = 'var(--danger)';
    errEl.style.fontSize = '0.85rem';
    errEl.textContent = err.message || 'Something went wrong. Please try again.';
    witnessBody.appendChild(errEl);

    // Remove the failed user message so they can retry
    currentSession.messages.pop();
  }

  isStreaming = false;
  btnSend.classList.toggle('ready', userInput.value.trim().length > 0);
  userInput.focus();
}

// ── Arc Management ────────────────────────────────────────────────

function setArc(arc) {
  if (!currentSession) return;
  currentSession.arc = arc;
  saveSession(currentSession);
  syncArcChips();
  renderSessionList();
}

// ── Book Export (port of book_builder.py) ─────────────────────────

function compileBook(sessions, filterArc = null) {
  const groups = {};
  for (const s of sessions) {
    const arc = s.arc || 'untagged';
    if (filterArc && arc !== filterArc) continue;
    if (!groups[arc]) groups[arc] = [];
    groups[arc].push(s);
  }

  let out = '# The Ishmael Project\n\n';

  for (const arc of ARC_ORDER) {
    if (!groups[arc]) continue;
    out += `# ${ARC_TITLES[arc]}\n\n`;
    for (const s of groups[arc]) {
      const date = new Date(s.started_at).toLocaleDateString();
      out += `## Session — ${date}\n\n`;
      for (const msg of s.messages) {
        if (msg.role === 'user')
          out += `**Narrator:** ${msg.content}\n\n`;
        if (msg.role === 'assistant')
          out += `**The Witness:** ${msg.content}\n\n`;
      }
      out += '---\n\n';
    }
  }

  return out;
}

function downloadText(text, filename, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── UI Helpers ────────────────────────────────────────────────────

function autoResizeInput() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 180) + 'px';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function openSidebar() {
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('visible');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('visible');
}

// ── Bind UI ───────────────────────────────────────────────────────

function bindUI() {
  // API key screen
  $('btn-show-key').addEventListener('click', () => {
    const isHidden = apikeyInput.type === 'password';
    apikeyInput.type = isHidden ? 'text' : 'password';
    $('btn-show-key').textContent = isHidden ? 'hide' : 'show';
  });

  $('btn-enter-dialogue').addEventListener('click', async () => {
    const key = apikeyInput.value.trim();
    if (!key || !key.startsWith('sk-ant-')) {
      apikeyError.textContent = 'Please enter a valid Anthropic API key (starts with sk-ant-).';
      return;
    }
    apikeyError.textContent = '';
    setApiKey(key);
    apikeyScreen.classList.add('hidden');
    showApp();
  });

  apikeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-enter-dialogue').click();
  });

  // New session
  $('btn-new-session').addEventListener('click', () => {
    startNewSession();
    closeSidebar();
  });

  // Arc filter (sidebar)
  document.querySelectorAll('.arc-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.arc-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      arcFilter = chip.dataset.arc;
      renderSessionList();
    });
  });

  // Arc chips (topbar)
  arcChips.forEach(chip => {
    chip.addEventListener('click', () => setArc(chip.dataset.arc));
  });

  // Export session
  $('btn-export-session').addEventListener('click', () => {
    if (!currentSession || currentSession.messages.length === 0) return;
    const md  = compileBook([currentSession]);
    const date = new Date(currentSession.started_at).toISOString().slice(0, 10);
    downloadText(md, `witness-session-${date}.md`);
  });

  // Export full book
  $('btn-export-book').addEventListener('click', () => {
    const all = getAllSessions();
    if (all.length === 0) return;
    downloadText(compileBook(all), 'the_witness_book.md');
  });

  // Backup
  $('btn-backup').addEventListener('click', () => {
    const all = getAllSessions();
    downloadText(JSON.stringify(all, null, 2), 'witness_sessions_backup.json', 'application/json');
  });

  // Restore
  $('btn-restore-trigger').addEventListener('click', () => $('btn-restore').click());
  $('btn-restore').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const sessions = JSON.parse(ev.target.result);
        if (!Array.isArray(sessions)) throw new Error('Invalid format');
        sessions.forEach(s => {
          if (s.id && s.messages) saveSession(s);
        });
        renderSessionList();
        alert(`Restored ${sessions.length} session(s).`);
      } catch (err) {
        alert('Could not read backup file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Forget key
  $('btn-forget-key').addEventListener('click', () => {
    if (backend !== 'claude') {
      alert('You are using in-browser AI — no API key is stored.');
      return;
    }
    if (confirm('Forget your API key? You will need to enter it again.')) {
      forgetApiKey();
      location.reload();
    }
  });

  // Mobile menu
  $('btn-menu').addEventListener('click', openSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // Input
  userInput.addEventListener('input', () => {
    autoResizeInput();
    btnSend.classList.toggle('ready', userInput.value.trim().length > 0);
  });

  userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  btnSend.addEventListener('click', sendMessage);
}

// ── Boot ──────────────────────────────────────────────────────────

init();
