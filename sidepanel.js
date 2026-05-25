(function () {
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

var DEF_PARAMS = {
  temperature:    0.7,
  top_p:          0.9,
  top_k:          40,
  repeat_penalty: 1.1,
  seed:           -1,
  num_ctx:        4096,
  num_predict:    -1
};

var DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant.';

var PARAM_META = [
  { key: 'temperature',    label: 'Temperature',   min: 0,   max: 2,     step: 0.05 },
  { key: 'top_p',          label: 'Top-P',         min: 0,   max: 1,     step: 0.05 },
  { key: 'top_k',          label: 'Top-K',         min: 1,   max: 200,   step: 1    },
  { key: 'repeat_penalty', label: 'Repeat penalty',min: 0.5, max: 2,     step: 0.05 },
  { key: 'seed',           label: 'Seed (-1=rand)',min: -1,  max: 999999,step: 1    },
  { key: 'num_ctx',        label: 'Context (tokens)',min:512,max:131072, step: 512  },
  { key: 'num_predict',    label: 'Max tokens (-1=∞)',min:-1,max:8192,  step: 1    }
];

// ── State ─────────────────────────────────────────────────────────────────────

var S = {
  settings:      { url: 'http://localhost:11434', token: '' },
  theme:         'dark',
  models:        [],   // [{ name, paramSize, sizeLabel }]
  modelParams:   {},   // { [modelName]: { ...params } }
  templates:     [],   // [{ id, name, content }]
  sessions:      [],   // [{ id, name, model, updatedAt }]  index only
  activeSession: null, // full session object
  pageContext:   null,
  usePageContext: false,
  attachments:   [],   // [{ name, content }]
  isStreaming:   false,
  currentStream: null  // { requestId, bubble, thinkBlock, thinkContent,
                       //   mainContent, metrics, sources, msgIndex }
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

var app             = document.getElementById('app');
var statusDot       = document.getElementById('status-dot');
var btnSessions     = document.getElementById('btn-sessions');
var sessionsPanel   = document.getElementById('sessions-panel');
var sessionsList    = document.getElementById('sessions-list');
var btnNewSession   = document.getElementById('btn-new-session');
var btnSettings     = document.getElementById('btn-settings');
var settingsPanel   = document.getElementById('settings-panel');
var inputUrl        = document.getElementById('input-url');
var inputToken      = document.getElementById('input-token');
var btnShowToken    = document.getElementById('btn-show-token');
var btnSave         = document.getElementById('btn-save');
var settingsStatus  = document.getElementById('settings-status');
var btnTheme        = document.getElementById('btn-theme');
var sessionNameEl   = document.getElementById('session-name-display');
var btnRenameSession = document.getElementById('btn-rename-session');
var btnExportSession = document.getElementById('btn-export-session');
var btnDeleteSession = document.getElementById('btn-delete-session');
var chatArea        = document.getElementById('chat-area');
var messagesEl      = document.getElementById('messages');
var systemPanel     = document.getElementById('system-prompt-panel');
var inputSysPrompt  = document.getElementById('input-system-prompt');
var btnToggleSystem = document.getElementById('btn-toggle-system');
var btnCloseSystem  = document.getElementById('btn-close-system');
var paramsPanel     = document.getElementById('params-panel');
var paramsGrid      = document.getElementById('params-grid');
var btnToggleParams = document.getElementById('btn-toggle-params');
var btnCloseParams  = document.getElementById('btn-close-params');
var fileChipsArea   = document.getElementById('file-chips-area');
var fileChipsEl     = document.getElementById('file-chips');
var btnPageContext  = document.getElementById('btn-page-context');
var pageCtxLbl     = document.getElementById('page-ctx-lbl');
var btnAttachFile  = document.getElementById('btn-attach-file');
var btnTemplatesOpen = document.getElementById('btn-templates-open');
var btnClear        = document.getElementById('btn-clear');
var inputMessage    = document.getElementById('input-message');
var templateDropdown = document.getElementById('template-dropdown');
var tmplDdList      = document.getElementById('tmpl-dd-list');
var btnTmplManageInline = document.getElementById('btn-tmpl-manage-inline');
var selectModel     = document.getElementById('select-model');
var btnStop         = document.getElementById('btn-stop');
var btnSend         = document.getElementById('btn-send');
var tmplOverlay     = document.getElementById('tmpl-overlay');
var tmplList        = document.getElementById('tmpl-list');
var tmplNewName     = document.getElementById('tmpl-new-name');
var tmplNewContent  = document.getElementById('tmpl-new-content');
var btnTmplAdd      = document.getElementById('btn-tmpl-add');
var btnTmplOverlayClose = document.getElementById('btn-tmpl-overlay-close');
var fileInput       = document.getElementById('file-input');

// ── Utilities ─────────────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return b + ' B';
}

function formatMetrics(m) {
  if (!m || !m.eval_count) return '';
  var tps  = m.eval_duration ? (m.eval_count / (m.eval_duration / 1e9)).toFixed(1) : '?';
  var secs = m.total_duration ? (m.total_duration / 1e9).toFixed(2) : '?';
  return m.eval_count + ' tokens · ' + tps + ' tok/s · ' + secs + 's';
}

function humanizeError(raw) {
  if (typeof raw !== 'string') return 'Unknown error';
  if (raw.indexOf('HTTP 401') !== -1) return 'Unauthorized — bearer token required or incorrect';
  if (raw.indexOf('HTTP 403') !== -1) return 'Access denied — check your bearer token';
  if (raw.indexOf('HTTP 405') !== -1) return 'Method not allowed — check server CORS configuration';
  if (raw.indexOf('HTTP 5')   !== -1) return 'Server error — ' + raw;
  if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED|network/i.test(raw))
    return 'Cannot reach Ollama — check the URL and that Ollama is running';
  return raw;
}

function getHeaders() {
  var h = { 'Content-Type': 'application/json' };
  var tok = S.settings.token && S.settings.token.trim();
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  return h;
}

function setStatus(state, title) {
  statusDot.className = 'status-dot' + (state ? ' ' + state : '');
  statusDot.title = title || state || 'Unknown';
}

function setSettingsStatus(msg, type) {
  settingsStatus.textContent = msg;
  settingsStatus.className = 'status-line' + (type ? ' ' + type : '');
}

function setSendEnabled(on) {
  btnSend.disabled      = !on;
  inputMessage.disabled = !on;
  if (on) {
    btnStop.classList.add('hidden');
    btnSend.classList.remove('hidden');
  } else {
    btnStop.classList.remove('hidden');
    btnSend.classList.add('hidden');
  }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

// Import marked.js for proper markdown rendering
var marked;
function loadMarked() {
  if (!marked) {
    marked = new (window.marked || window.require('marked'))();
    // Use GitHub-style markdown preset
    marked.setOptions({
      gfm: true,
      breaks: true,
      sanitize: false
    });
  }
}

function renderInline(text) {
  var h = escapeHtml(text);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  h = h.replace(/\n/g, '<br>');
  return h;
}

function renderMarkdown(raw) {
  if (!raw) return '';
  loadMarked();
  try {
    var html = marked.parse(raw, { breaks: true });
    // Add syntax highlighting
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, function(match, attr, code) {
      var lang = attr.match(/[^\s]*=/)?.replace('=', '').trim() || '';
      var hl = '';
      if (lang && hl) hl = ' data-lang="' + escapeHtml(lang) + '"';
      return '<pre' + hl + '><code' + (hl ? hl : '') + '>' + escapeHtml(code) + '</code></pre>';
    });
    return html;
  } catch (e) {
    // Fallback to simple rendering if marked fails
    return renderInline(raw);
  }
}

function renderMarkdown(raw) {
  if (!raw) return '';
  var parts = raw.split(/(```[^\n]*\n[\s\S]*?```)/g);
  return parts.map(function (part, i) {
    if (i % 2 === 1) {
      var m = part.match(/```([^\n]*)\n([\s\S]*?)```/);
      if (m) {
        var la = m[1].trim() ? ' data-lang="' + escapeHtml(m[1].trim()) + '"' : '';
        return '<pre' + la + '><code>' + escapeHtml(m[2]) + '</code></pre>';
      }
      return escapeHtml(part);
    }
    return renderInline(part);
  }).join('');
}

// ── RAG helpers ───────────────────────────────────────────────────────────────

var STOP_WORDS = new Set(
  'the a an is are was were be been have has had do does did will would could should may might can this that these those i you he she it we they and or but in on at to for of with by from as'.split(' ')
);

function chunkText(text, size) {
  size = size || 250;
  var words = text.split(/\s+/);
  var chunks = [];
  for (var i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(' '));
  }
  return chunks;
}

function scoreChunk(chunk, queryTerms) {
  if (!queryTerms.length) return 1; // no terms = include everything (short text)
  var lower = chunk.toLowerCase();
  var score = 0;
  queryTerms.forEach(function (t) {
    var re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'gi');
    var m = lower.match(re);
    if (m) score += m.length;
  });
  return score;
}

function getTopChunks(text, query, maxChunks, maxChars) {
  maxChunks = maxChunks || 4;
  maxChars  = maxChars  || 3000;
  if (!text || !text.trim()) return [];
  var terms = (query || '').toLowerCase().split(/\W+/)
    .filter(function (w) { return w.length > 2 && !STOP_WORDS.has(w); });
  var chunks = chunkText(text);
  var scored = chunks.map(function (c, idx) {
    return { c: c, s: scoreChunk(c, terms), idx: idx };
  });
  // If no query terms, include first N chunks
  if (!terms.length) {
    scored.sort(function (a, b) { return a.idx - b.idx; });
  } else {
    scored = scored.filter(function (x) { return x.s > 0; });
    scored.sort(function (a, b) { return b.s - a.s; });
  }
  var out = []; var chars = 0;
  for (var i = 0; i < scored.length && out.length < maxChunks; i++) {
    if (chars + scored[i].c.length > maxChars) break;
    out.push(scored[i].c);
    chars += scored[i].c.length;
  }
  return out;
}

// Build context block from active page context + attachments, using RAG scoring
function buildContextBlock(userQuery) {
  var sources = []; var names = [];

  if (S.usePageContext && S.pageContext && S.pageContext.content) {
    var chunks = getTopChunks(S.pageContext.content, userQuery);
    if (chunks.length) {
      sources.push('=== ' + (S.pageContext.title || S.pageContext.url || 'Page') + ' ===\n' + chunks.join('\n\n'));
      names.push(S.pageContext.title || 'Page');
    }
  }

  S.attachments.forEach(function (att) {
    var chunks = getTopChunks(att.content, userQuery);
    if (chunks.length) {
      sources.push('=== ' + att.name + ' ===\n' + chunks.join('\n\n'));
      names.push(att.name);
    }
  });

  if (!sources.length) return null;
  return { text: '[Context]\n' + sources.join('\n\n'), names: names };
}

// ── Storage ───────────────────────────────────────────────────────────────────

function loadAllData(cb) {
  chrome.storage.local.get(
    ['ollama_s','ollama_t','ollama_si','ollama_sa','ollama_mp','ollama_tp'],
    function (r) {
      // settings
      var saved = r.ollama_s || {};
      S.settings.url   = saved.url   || 'http://localhost:11434';
      S.settings.token = saved.token || '';
      inputUrl.value   = S.settings.url;
      inputToken.value = S.settings.token;

      // theme
      S.theme = r.ollama_t || 'dark';
      applyTheme(S.theme);

      // default system prompt
      loadDefaultSystemPrompt();

      // sessions index
      S.sessions = r.ollama_si || [];

      // model params
      S.modelParams = r.ollama_mp || {};

      // templates
      S.templates = r.ollama_tp || [];

      // load active session
      var activeId = r.ollama_sa;
      if (!activeId && S.sessions.length) activeId = S.sessions[0].id;

      if (activeId) {
        chrome.storage.local.get('ollama_ss_' + activeId, function (r2) {
          var sess = r2['ollama_ss_' + activeId];
          if (sess) {
            S.activeSession = sess;
          } else {
            S.activeSession = createSessionObj('New Chat');
            saveSession(S.activeSession);
          }
          if (cb) cb();
        });
      } else {
        S.activeSession = createSessionObj('New Chat');
        saveSession(S.activeSession);
        if (cb) cb();
      }
    }
  );
}

function saveSettings() {
  S.settings.url   = inputUrl.value.trim().replace(/\/+$/, '') || 'http://localhost:11434';
  S.settings.token = inputToken.value;
  inputUrl.value   = S.settings.url;
  chrome.storage.local.set({ ollama_s: { url: S.settings.url, token: S.settings.token } });
  // Save default system prompt if changed
  if (inputSysPrompt.value !== DEFAULT_SYSTEM_PROMPT) {
    chrome.storage.local.set({ ollama_s_default_sys: inputSysPrompt.value });
  }
}

function loadDefaultSystemPrompt() {
  chrome.storage.local.get('ollama_s_default_sys', function(r) {
    var saved = r['ollama_s_default_sys'];
    if (saved && typeof saved === 'string') {
      inputSysPrompt.value = saved;
      if (S.activeSession) S.activeSession.systemPrompt = saved;
    }
  });
}

function saveSession(sess) {
  sess.updatedAt = Date.now();
  // Upsert in index
  var idx = -1;
  for (var i = 0; i < S.sessions.length; i++) {
    if (S.sessions[i].id === sess.id) { idx = i; break; }
  }
  var meta = { id: sess.id, name: sess.name, model: sess.model, updatedAt: sess.updatedAt };
  if (idx === -1) S.sessions.unshift(meta);
  else            S.sessions[idx] = meta;
  var store = {};
  store['ollama_ss_' + sess.id] = sess;
  store['ollama_si'] = S.sessions;
  store['ollama_sa'] = sess.id;
  chrome.storage.local.set(store);
}

var _saveTimer = null;
function debouncedSaveSession() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function () {
    if (S.activeSession) saveSession(S.activeSession);
  }, 600);
}

function deleteSessionFromStorage(id) {
  S.sessions = S.sessions.filter(function (s) { return s.id !== id; });
  chrome.storage.local.remove('ollama_ss_' + id);
  chrome.storage.local.set({ ollama_si: S.sessions });
}

function saveModelParams() {
  chrome.storage.local.set({ ollama_mp: S.modelParams });
}

function saveTemplates() {
  chrome.storage.local.set({ ollama_tp: S.templates });
}

// ── Session management ────────────────────────────────────────────────────────

function createSessionObj(name) {
  var model = (selectModel && selectModel.value) || '';
  // Auto-generate title from first message if no name provided
  var generatedName = '';
  if (!name && S.attachments.length === 0 && S.pageContext) {
    var ctx = S.pageContext.title || S.pageContext.url || 'page';
    generatedName = '[From ' + ctx + ']';
  }
  return {
    id:           genId(),
    name:         name || generatedName || 'New Chat',
    model:        model,
    systemPrompt: '',
    messages:     [],
    createdAt:    Date.now(),
    updatedAt:    Date.now()
  };
}

function newSession() {
  if (S.activeSession) saveSession(S.activeSession);
  var sess = createSessionObj('New Chat');
  S.activeSession = sess;
  saveSession(sess);
  renderSession();
  updateSessionsPanel();
  closePanels();
}

function switchSession(id) {
  if (S.activeSession && S.activeSession.id === id) { closePanels(); return; }
  if (S.activeSession) saveSession(S.activeSession);
  chrome.storage.local.get('ollama_ss_' + id, function (r) {
    var sess = r['ollama_ss_' + id];
    if (!sess) return;
    S.activeSession = sess;
    chrome.storage.local.set({ ollama_sa: id });
    renderSession();
    updateSessionsPanel();
    closePanels();
  });
}

function deleteSession(id) {
  if (!confirm('Delete this conversation?')) return;
  deleteSessionFromStorage(id);
  if (S.activeSession && S.activeSession.id === id) {
    if (S.sessions.length) {
      switchSession(S.sessions[0].id);
    } else {
      S.activeSession = createSessionObj('New Chat');
      saveSession(S.activeSession);
      renderSession();
    }
  }
  updateSessionsPanel();
}

function renameSession(id) {
  var meta = S.sessions.find(function (s) { return s.id === id; });
  if (!meta) return;
  var name = prompt('Rename conversation:', meta.name);
  if (!name || !name.trim()) return;
  name = name.trim().slice(0, 80);
  meta.name = name;
  if (S.activeSession && S.activeSession.id === id) {
    S.activeSession.name = name;
    saveSession(S.activeSession);
    sessionNameEl.textContent = name;
  } else {
    chrome.storage.local.get('ollama_ss_' + id, function (r) {
      var sess = r['ollama_ss_' + id];
      if (sess) { sess.name = name; saveSession(sess); }
      else { chrome.storage.local.set({ ollama_si: S.sessions }); }
    });
  }
  updateSessionsPanel();
}

function exportSession(sess) {
  if (!sess) return;
  var lines = ['# ' + sess.name, '',
    '> **Model:** ' + (sess.model || 'unknown') + '  ',
    '> **Created:** ' + new Date(sess.createdAt).toLocaleString(),
    ''];
  if (sess.systemPrompt) {
    lines.push('## System Prompt', '', sess.systemPrompt, '');
  }
  lines.push('---', '');
  (sess.messages || []).forEach(function (m) {
    lines.push('**' + (m.role === 'user' ? 'You' : 'Assistant') + ':**', '', m.content, '', '---', '');
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = (sess.name || 'chat').replace(/[^a-z0-9\-_ ]/gi, '-').slice(0,60) + '.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Model management ──────────────────────────────────────────────────────────

function fetchModels() {
  setStatus('', 'Connecting…');
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage(
      { action: 'OLLAMA_GET', url: S.settings.url + '/api/tags', headers: getHeaders() },
      function (response) {
        if (chrome.runtime.lastError || !response) {
          var e = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No response';
          setStatus('error', humanizeError(e));
          setSettingsStatus(humanizeError(e), 'err');
          resolve(); return;
        }
        if (!response.ok) {
          var msg = humanizeError(response.error || ('HTTP ' + response.status));
          setStatus('error', msg);
          setSettingsStatus(msg, 'err');
          resolve(); return;
        }
        var raw = response.data.models || [];
        S.models = raw.map(function (m) {
          return {
            name:       m.name,
            paramSize:  (m.details && m.details.parameter_size) || '',
            sizeLabel:  m.size ? formatBytes(m.size) : ''
          };
        });
        populateModels();
        setStatus('connected', 'Connected');
        setSettingsStatus('Connected — ' + S.models.length + ' model(s)', 'ok');
        resolve();
      }
    );
  });
}

function populateModels() {
  var current = (S.activeSession && S.activeSession.model) || '';
  selectModel.innerHTML = '<option value="">-- select model --</option>';
  S.models.forEach(function (m) {
    var opt   = document.createElement('option');
    opt.value = m.name;
    var lbl   = m.name;
    if (m.paramSize)  lbl += ' (' + m.paramSize + ')';
    if (m.sizeLabel)  lbl += ' · ' + m.sizeLabel;
    opt.textContent = lbl;
    if (m.name === current) opt.selected = true;
    selectModel.appendChild(opt);
  });
  if (selectModel.value && S.activeSession) S.activeSession.model = selectModel.value;
}

function getModelOptions() {
  var model = (S.activeSession && S.activeSession.model) || selectModel.value || '';
  return Object.assign({}, DEF_PARAMS, S.modelParams[model] || {});
}

// ── Page context ──────────────────────────────────────────────────────────────

function getPageContent() {
  return new Promise(function (resolve, reject) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) { reject(new Error('No active tab')); return; }
      chrome.runtime.sendMessage(
        { action: 'GET_PAGE_CONTENT', tabId: tabs[0].id },
        function (response) {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (!response)           { reject(new Error('No response from background')); return; }
          if (response.error)      { reject(new Error(response.error)); return; }
          resolve(response);
        }
      );
    });
  });
}

async function togglePageContext() {
  if (S.usePageContext) {
    S.usePageContext = false; S.pageContext = null;
    btnPageContext.classList.remove('active');
    pageCtxLbl.textContent = 'Page';
    return;
  }
  btnPageContext.disabled = true;
  pageCtxLbl.textContent = 'Loading…';
  try {
    var ctx = await getPageContent();
    S.pageContext = ctx; S.usePageContext = true;
    btnPageContext.classList.add('active');
    var title = (ctx.title || ctx.url || 'page').trim();
    pageCtxLbl.textContent = title.length > 20 ? title.slice(0, 18) + '…' : title;
  } catch (e) {
    pageCtxLbl.textContent = 'Page';
    appendSystemMsg('Could not read page: ' + e.message);
  } finally {
    btnPageContext.disabled = false;
  }
}

// ── File attachments ──────────────────────────────────────────────────────────

function extractPdfText(buffer) {
  var bytes = new Uint8Array(buffer);
  var runs = []; var cur = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b >= 32 && b <= 126)   { cur += String.fromCharCode(b); }
    else if (b === 10 || b === 13) { if (cur.length > 3) runs.push(cur); cur = ''; }
    else { if (cur.length > 3) runs.push(cur); cur = ''; }
  }
  if (cur.length > 3) runs.push(cur);
  return runs.filter(function (s) { return !/^[\/\-\(\)\.]{2,}$/.test(s.trim()); })
    .join(' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
}

function handleFiles(files) {
  Array.prototype.forEach.call(files, function (file) {
    var name = file.name;
    var ext  = name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      var reader = new FileReader();
      reader.onload = function (e) {
        var text = extractPdfText(e.target.result);
        S.attachments.push({ name: name, content: text });
        renderFileChips();
      };
      reader.readAsArrayBuffer(file);
    } else {
      var reader2 = new FileReader();
      reader2.onload = function (e) {
        S.attachments.push({ name: name, content: (e.target.result || '').slice(0, 12000) });
        renderFileChips();
      };
      reader2.readAsText(file);
    }
  });
  fileInput.value = '';
}

function removeAttachment(idx) {
  S.attachments.splice(idx, 1);
  renderFileChips();
}

function renderFileChips() {
  if (!S.attachments.length) {
    fileChipsArea.classList.add('hidden'); return;
  }
  fileChipsArea.classList.remove('hidden');
  fileChipsEl.innerHTML = '';
  S.attachments.forEach(function (att, i) {
    var chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML =
      '<span class="file-chip-name" title="' + escapeHtml(att.name) + '">' + escapeHtml(att.name) + '</span>' +
      '<button class="file-chip-del" data-idx="' + i + '" title="Remove">&#10005;</button>';
    fileChipsEl.appendChild(chip);
  });
}

// ── Template management ───────────────────────────────────────────────────────

function renderTmplOverlay() {
  tmplList.innerHTML = '';
  if (!S.templates.length) {
    tmplList.innerHTML = '<div style="padding:12px;color:var(--fg3);font-size:12px;">No templates yet.</div>';
    return;
  }
  S.templates.forEach(function (t) {
    var el = document.createElement('div');
    el.className = 'tmpl-item';
    el.innerHTML =
      '<div class="tmpl-item-body">' +
        '<div class="tmpl-item-name">' + escapeHtml(t.name) + '</div>' +
        '<div class="tmpl-item-text">' + escapeHtml((t.content || '').slice(0, 80)) + '</div>' +
      '</div>' +
      '<button class="tmpl-item-del" data-id="' + t.id + '" title="Delete">&#10005;</button>';
    tmplList.appendChild(el);
  });
}

function renderTmplDropdown(filter) {
  var filtered = S.templates.filter(function (t) {
    if (!filter) return true;
    return t.name.toLowerCase().includes(filter) || t.content.toLowerCase().includes(filter);
  });
  if (!filtered.length) { templateDropdown.classList.add('hidden'); return; }
  tmplDdList.innerHTML = '';
  filtered.slice(0, 8).forEach(function (t) {
    var el = document.createElement('div');
    el.className = 'tmpl-dd-item';
    el.innerHTML =
      '<div class="tmpl-dd-name">' + escapeHtml(t.name) + '</div>' +
      '<div class="tmpl-dd-preview">' + escapeHtml((t.content || '').slice(0, 60)) + '</div>';
    el.addEventListener('click', function () {
      inputMessage.value = t.content;
      inputMessage.style.height = 'auto';
      inputMessage.style.height = Math.min(inputMessage.scrollHeight, 160) + 'px';
      templateDropdown.classList.add('hidden');
      inputMessage.focus();
    });
    tmplDdList.appendChild(el);
  });
  templateDropdown.classList.remove('hidden');
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function applyTheme(t) {
  S.theme = t;
  app.setAttribute('data-theme', t);
  chrome.storage.local.set({ ollama_t: t });
}

function closePanels() {
  settingsPanel.classList.add('hidden');
  btnSettings.classList.remove('active');
  sessionsPanel.classList.add('hidden');
  btnSessions.classList.remove('active');
}

function updateSessionsPanel() {
  if (!S.sessions.length) {
    sessionsList.innerHTML = '<div style="padding:8px;color:var(--fg3);font-size:12px;">No saved sessions.</div>';
    return;
  }
  sessionsList.innerHTML = '';
  S.sessions.forEach(function (s) {
    var el   = document.createElement('div');
    el.className = 'session-item' + (S.activeSession && S.activeSession.id === s.id ? ' active' : '');
    var ts   = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '';
    el.innerHTML =
      '<div class="session-item-name" title="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</div>' +
      '<div class="session-item-meta">' + escapeHtml(ts) + '</div>' +
      '<div class="session-item-actions">' +
        '<button class="icon-btn sm" data-action="rename" data-id="' + s.id + '" title="Rename">&#9998;</button>' +
        '<button class="icon-btn sm danger" data-action="delete" data-id="' + s.id + '" title="Delete">&#10005;</button>' +
      '</div>';
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-action]')) return;
      switchSession(s.id);
    });
    sessionsList.appendChild(el);
  });
}

function updateSessionBar() {
  if (!S.activeSession) return;
  sessionNameEl.textContent = S.activeSession.name;
}

function updateModelDisplay() {
  var model = S.activeSession && S.activeSession.model || selectModel.value || '';
  var display = model || '(no model)';
  document.getElementById('model-display').textContent = display;
}

function renderParamsPanel() {
  var opts = getModelOptions();
  paramsGrid.innerHTML = '';
  PARAM_META.forEach(function (pm) {
    var val = opts[pm.key] !== undefined ? opts[pm.key] : DEF_PARAMS[pm.key];
    var lbl = document.createElement('label');
    lbl.className = 'param-lbl';
    lbl.htmlFor   = 'param_' + pm.key;
    lbl.textContent = pm.label;

    var inp = document.createElement('input');
    inp.id        = 'param_' + pm.key;
    inp.type      = 'number';
    inp.className = 'param-input';
    inp.value     = val;
    inp.min       = pm.min;
    inp.max       = pm.max;
    inp.step      = pm.step;
    inp.addEventListener('change', function () {
      var model = (S.activeSession && S.activeSession.model) || selectModel.value || '';
      if (!S.modelParams[model]) S.modelParams[model] = {};
      S.modelParams[model][pm.key] = parseFloat(this.value);
      saveModelParams();
    });

    var valEl = document.createElement('span');
    valEl.className = 'param-val';
    valEl.textContent = val;
    inp.addEventListener('input', function () { valEl.textContent = this.value; });

    paramsGrid.appendChild(lbl);
    paramsGrid.appendChild(inp);
    paramsGrid.appendChild(valEl);
  });
}

function renderSession() {
  if (!S.activeSession) return;
  updateSessionBar();
  // Sync system prompt field
  inputSysPrompt.value = S.activeSession.systemPrompt || '';
  // Sync model selector
  if (S.activeSession.model && selectModel) {
    selectModel.value = S.activeSession.model;
    if (!selectModel.value && S.activeSession.model) {
      // Model not in list yet, will be set after fetchModels
    }
  }
  renderAllMessages();
}

// ── Message rendering ─────────────────────────────────────────────────────────

function scrollToBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

function showEmptyState() {
  if (messagesEl.children.length) return;
  var el = document.createElement('div');
  el.id = 'empty-state'; el.className = 'empty-state';
  el.innerHTML =
    '<div class="ei">&#x1F999;</div>' +
    '<p>Ask anything.<br>Use <strong>Page</strong> or <strong>Attach</strong> to include context.</p>';
  messagesEl.appendChild(el);
}

function removeEmptyState() {
  var el = document.getElementById('empty-state');
  if (el) el.remove();
}

function appendSystemMsg(text) {
  var w = document.createElement('div');
  w.className = 'message error';
  var b = document.createElement('div');
  b.className = 'msg-bubble'; b.textContent = humanizeError(text);
  var body = document.createElement('div');
  body.className = 'msg-body'; body.appendChild(b);
  w.appendChild(body); messagesEl.appendChild(w); scrollToBottom();
}

function buildMessageEl(msg, index) {
  var w = document.createElement('div');
  w.className = 'message ' + msg.role;
  w.dataset.index = index;

  var roleEl = document.createElement('div');
  roleEl.className = 'msg-role';
  roleEl.textContent = msg.role === 'user' ? 'You' : 'Assistant';

  var body = document.createElement('div');
  body.className = 'msg-body';

  if (msg.role === 'assistant') {
    // Thinking block
    if (msg.thinking) {
      var det = document.createElement('details');
      det.className = 'think-block';
      var sum = document.createElement('summary');
      sum.textContent = 'Thinking';
      var tc = document.createElement('div');
      tc.className = 'think-content';
      tc.innerHTML = renderMarkdown(msg.thinking);
      det.appendChild(sum); det.appendChild(tc);
      body.appendChild(det);
    }
    // Bubble
    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = renderMarkdown(msg.content || '');
    body.appendChild(bubble);
    // Meta (source + metrics)
    var meta = document.createElement('div');
    meta.className = 'msg-meta';
    if (msg.sources && msg.sources.length) {
      var sc = document.createElement('div');
      sc.className = 'source-chip';
      sc.textContent = '📎 ' + msg.sources.join(', ');
      meta.appendChild(sc);
    }
    if (msg.metrics) {
      var ml = document.createElement('div');
      ml.className = 'metrics-line';
      ml.textContent = formatMetrics(msg.metrics);
      if (ml.textContent) meta.appendChild(ml);
    }
    if (meta.children.length) body.appendChild(meta);
    // Actions
    var acts = document.createElement('div');
    acts.className = 'msg-actions';
    acts.innerHTML =
      '<button class="act-btn" data-action="copy" title="Copy">&#10697; Copy</button>';
    body.appendChild(acts);
  } else {
    // User bubble
    var ub = document.createElement('div');
    ub.className = 'msg-bubble';
    ub.textContent = msg.content;
    body.appendChild(ub);
    var ua = document.createElement('div');
    ua.className = 'msg-actions';
    ua.innerHTML = '<button class="act-btn" data-action="edit" title="Edit">&#9998; Edit</button>';
    body.appendChild(ua);
  }

  w.appendChild(roleEl); w.appendChild(body);
  return w;
}

function renderAllMessages() {
  messagesEl.innerHTML = '';
  if (!S.activeSession || !S.activeSession.messages.length) { showEmptyState(); return; }
  S.activeSession.messages.forEach(function (msg, i) {
    messagesEl.appendChild(buildMessageEl(msg, i));
  });
  // Add regen button to last assistant message
  updateRegenButton();
  scrollToBottom();
}

function updateRegenButton() {
  // Remove any existing regen buttons
  messagesEl.querySelectorAll('[data-action="regen"]').forEach(function (b) { b.remove(); });
  // Find last assistant message
  var msgs = S.activeSession && S.activeSession.messages;
  if (!msgs || !msgs.length) return;
  for (var i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') {
      var el = messagesEl.querySelector('.message[data-index="' + i + '"] .msg-actions');
      if (el) {
        var rb = document.createElement('button');
        rb.className = 'act-btn'; rb.dataset.action = 'regen'; rb.title = 'Regenerate';
        rb.innerHTML = '&#8635; Regen';
        el.appendChild(rb);
      }
      break;
    }
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function buildApiMessages() {
  var out = [];
  if (S.activeSession && S.activeSession.systemPrompt) {
    out.push({ role: 'system', content: S.activeSession.systemPrompt });
  }
  (S.activeSession && S.activeSession.messages || []).forEach(function (m) {
    out.push({ role: m.role, content: m.content });
  });
  return out;
}

function doSendChat(text) {
  if (S.isStreaming) return;
  if (!text || !text.trim()) return;
  if (!S.activeSession) return;

  var model = selectModel.value;
  if (!model) { appendSystemMsg('Please select a model first.'); return; }
  S.activeSession.model = model;

  // Collect context
  var ctx = buildContextBlock(text);

  // Build actual user content (with context prefix)
  var apiContent = text;
  if (ctx) apiContent = ctx.text + '\n\n' + text;

  removeEmptyState();
  inputMessage.value = '';
  inputMessage.style.height = '';
  setSendEnabled(false);
  S.isStreaming = true;

  // User message (display only the typed text)
  var userMsg = { id: genId(), role: 'user', content: text, ts: Date.now() };
  S.activeSession.messages.push(userMsg);
  var userIdx = S.activeSession.messages.length - 1;
  messagesEl.appendChild(buildMessageEl(userMsg, userIdx));
  scrollToBottom();

  // Generate title from first message if this is the first message
  if (S.activeSession.messages.length === 2 && !S.activeSession.name) {
    // First message just sent - generate a short title
    var shortTitle = text.slice(0, 40).trim().replace(/[^a-zA-Z0-9 ]/g, '');
    S.activeSession.name = shortTitle || 'New Chat';
    saveSession(S.activeSession);
  }

  // Build API history with context-injected version of the last message
  var apiMsgs = buildApiMessages();
  apiMsgs[apiMsgs.length - 1] = { role: 'user', content: apiContent };

  // Assistant bubble
  var asstIdx  = S.activeSession.messages.length; // will be pushed on DONE
  var asstMsgEl = document.createElement('div');
  asstMsgEl.className = 'message assistant';
  asstMsgEl.dataset.index = asstIdx;

  var roleEl = document.createElement('div');
  roleEl.className = 'msg-role'; roleEl.textContent = 'Assistant';

  var body = document.createElement('div');
  body.className = 'msg-body';

  // Thinking block (hidden until content arrives)
  var thinkBlock = document.createElement('details');
  thinkBlock.className = 'think-block hidden';
  var thinkSum = document.createElement('summary');
  thinkSum.textContent = 'Thinking';
  var thinkContent = document.createElement('div');
  thinkContent.className = 'think-content';
  thinkBlock.appendChild(thinkSum); thinkBlock.appendChild(thinkContent);
  body.appendChild(thinkBlock);

  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble streaming';
  body.appendChild(bubble);

  asstMsgEl.appendChild(roleEl); asstMsgEl.appendChild(body);
  messagesEl.appendChild(asstMsgEl);
  scrollToBottom();

  var requestId = genId();
  S.currentStream = {
    requestId:    requestId,
    bubble:       bubble,
    thinkBlock:   thinkBlock,
    thinkContent: thinkContent,
    thinkText:    '',
    mainText:     '',
    inThinkTag:   false,
    metrics:      null,
    sources:      ctx ? ctx.names : null,
    msgIndex:     asstIdx,
    msgEl:        asstMsgEl,
    bodyEl:       body
  };

  chrome.runtime.sendMessage({
    action:    'OLLAMA_FETCH',
    url:       S.settings.url + '/api/chat',
    headers:   getHeaders(),
    body:      JSON.stringify({
      model:    model,
      messages: apiMsgs,
      stream:   true,
      options:  getModelOptions()
    }),
    requestId: requestId
  });
}

function sendChat() {
  var text = inputMessage.value.trim();
  if (text) doSendChat(text);
}

function stopStream() {
  if (!S.currentStream) return;
  chrome.runtime.sendMessage({ action: 'CANCEL_STREAM', requestId: S.currentStream.requestId });
}

function regenerateLastResponse() {
  if (S.isStreaming || !S.activeSession) return;
  var msgs = S.activeSession.messages;
  // Remove trailing assistant messages
  while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return;
  var lastUserText = msgs[msgs.length - 1].content;
  msgs.pop(); // will be re-added by doSendChat
  saveSession(S.activeSession);
  renderAllMessages();
  doSendChat(lastUserText);
}

function startEditMessage(msgEl, index) {
  if (S.isStreaming) return;
  var msgs = S.activeSession && S.activeSession.messages;
  if (!msgs || index >= msgs.length) return;
  var original = msgs[index].content;

  var bubble = msgEl.querySelector('.msg-bubble');
  bubble.innerHTML = '';
  var ta = document.createElement('textarea');
  ta.className = 'edit-textarea'; ta.value = original;
  bubble.appendChild(ta);

  var acts = msgEl.querySelector('.msg-actions');
  acts.innerHTML = '';
  var saveBtn = document.createElement('button');
  saveBtn.className = 'primary-btn sm'; saveBtn.textContent = 'Save & Send';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'secondary-btn'; cancelBtn.textContent = 'Cancel';

  saveBtn.addEventListener('click', function () {
    var newText = ta.value.trim();
    if (!newText) return;
    // Truncate history to before this message
    S.activeSession.messages = msgs.slice(0, index);
    saveSession(S.activeSession);
    renderAllMessages();
    doSendChat(newText);
  });
  cancelBtn.addEventListener('click', function () {
    bubble.innerHTML = escapeHtml(original).replace(/\n/g,'<br>');
    acts.innerHTML = '<button class="act-btn" data-action="edit" title="Edit">&#9998; Edit</button>';
  });

  var editActs = document.createElement('div');
  editActs.className = 'edit-actions';
  editActs.appendChild(saveBtn); editActs.appendChild(cancelBtn);
  msgEl.querySelector('.msg-body').appendChild(editActs);
  ta.focus(); ta.select();
}

// ── Stream message listener ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (msg) {
  if (!S.currentStream || msg.requestId !== S.currentStream.requestId) return;
  var cs = S.currentStream;

  if (msg.action === 'STREAM_THINKING') {
    cs.thinkText += msg.text;
    cs.thinkContent.innerHTML = renderMarkdown(cs.thinkText);
    cs.thinkBlock.classList.remove('hidden');
    cs.thinkBlock.open = true;
    scrollToBottom();
    return;
  }

  if (msg.action === 'STREAM_CHUNK') {
    var delta = msg.text;

    // Parse inline <think>...</think> tags from content
    if (!cs.inThinkTag && !cs.mainText && delta.trimStart().startsWith('<think>')) {
      cs.inThinkTag = true;
      delta = delta.replace(/^[\s\S]*?<think>/, '');
    }
    if (cs.inThinkTag) {
      var closeIdx = delta.indexOf('</think>');
      if (closeIdx !== -1) {
        cs.thinkText += delta.slice(0, closeIdx);
        cs.inThinkTag = false;
        delta = delta.slice(closeIdx + 8).replace(/^\s+/, '');
      } else {
        cs.thinkText += delta;
        delta = '';
      }
    }
    if (cs.thinkText) {
      cs.thinkContent.innerHTML = renderMarkdown(cs.thinkText);
      cs.thinkBlock.classList.remove('hidden');
      if (cs.inThinkTag) cs.thinkBlock.open = true;
    }
    if (delta) {
      cs.mainText += delta;
      cs.bubble.innerHTML = renderMarkdown(cs.mainText);
    }
    scrollToBottom();
    return;
  }

  if (msg.action === 'STREAM_METRICS') {
    cs.metrics = msg.metrics;
    return;
  }

  if (msg.action === 'STREAM_DONE' || msg.action === 'STREAM_ERROR') {
    var isErr  = msg.action === 'STREAM_ERROR';
    var content = cs.mainText;

    cs.bubble.classList.remove('streaming');
    if (cs.thinkBlock && cs.thinkText) cs.thinkBlock.open = false; // collapse when done

    if (isErr && !content) {
      // No partial content — show error in bubble
      if (S.activeSession && S.activeSession.messages.length) {
        S.activeSession.messages.pop(); // roll back user message
      }
      cs.bubble.parentElement.parentElement.className = 'message error';
      cs.bubble.textContent = humanizeError(msg.error || 'Unknown error');
    } else {
      if (isErr) {
        // Partial content + error note
        var note = document.createElement('div');
        note.className = 'stream-err-note';
        note.textContent = humanizeError(msg.error || 'Stream interrupted');
        cs.bubble.parentElement.appendChild(note);
      }

      // Add source chip if context was used
      if (cs.sources && cs.sources.length) {
        var sc = document.createElement('div');
        sc.className = 'source-chip';
        sc.textContent = '📎 ' + cs.sources.join(', ');
        var metaEl = document.createElement('div');
        metaEl.className = 'msg-meta';
        metaEl.appendChild(sc);
        if (cs.metrics) {
          var ml = document.createElement('div');
          ml.className = 'metrics-line';
          ml.textContent = formatMetrics(cs.metrics);
          if (ml.textContent) metaEl.appendChild(ml);
        }
        cs.bodyEl.insertBefore(metaEl, cs.bubble.nextSibling);
      } else if (cs.metrics) {
        var mEl = document.createElement('div');
        mEl.className = 'msg-meta';
        var ml2 = document.createElement('div');
        ml2.className = 'metrics-line';
        ml2.textContent = formatMetrics(cs.metrics);
        if (ml2.textContent) { mEl.appendChild(ml2); cs.bodyEl.insertBefore(mEl, cs.bubble.nextSibling); }
      }

      // Add actions row
      var actsEl = document.createElement('div');
      actsEl.className = 'msg-actions';
      actsEl.innerHTML = '<button class="act-btn" data-action="copy" title="Copy">&#10697; Copy</button>';
      cs.bodyEl.appendChild(actsEl);

      // Push to session
      if (S.activeSession) {
        var asstMsg = {
          id:       genId(),
          role:     'assistant',
          content:  content || '',
          thinking: cs.thinkText || null,
          metrics:  cs.metrics   || null,
          sources:  cs.sources   || null,
          ts:       Date.now()
        };
        S.activeSession.messages.push(asstMsg);
        cs.msgEl.dataset.index = S.activeSession.messages.length - 1;
        saveSession(S.activeSession);
        updateRegenButton();
      }
    }

    S.currentStream = null;
    S.isStreaming   = false;
    setSendEnabled(true);
    scrollToBottom();
    inputMessage.focus();
  }
});

// ── Event handlers ────────────────────────────────────────────────────────────

function initEventHandlers() {

  // Header
  btnSettings.addEventListener('click', function () {
    var wasOpen = !settingsPanel.classList.contains('hidden');
    closePanels();
    if (!wasOpen) { settingsPanel.classList.remove('hidden'); btnSettings.classList.add('active'); }
  });

  btnSessions.addEventListener('click', function () {
    var wasOpen = !sessionsPanel.classList.contains('hidden');
    closePanels();
    if (!wasOpen) {
      updateSessionsPanel();
      sessionsPanel.classList.remove('hidden');
      btnSessions.classList.add('active');
    }
  });

  btnTheme.addEventListener('click', function () {
    applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  });

  // Settings
  btnShowToken.addEventListener('click', function () {
    inputToken.type = inputToken.type === 'password' ? 'text' : 'password';
  });

  var urlTimer = null;
  inputUrl.addEventListener('input', function () {
    clearTimeout(urlTimer);
    var val = this.value.trim().replace(/\/+$/, '');
    if (!val || !/^https?:\/\//.test(val)) return;
    urlTimer = setTimeout(function () {
      setStatus('', 'Checking…');
      var lh = { 'Content-Type': 'application/json' };
      var tok = inputToken.value.trim();
      if (tok) lh['Authorization'] = 'Bearer ' + tok;
      chrome.runtime.sendMessage(
        { action: 'OLLAMA_GET', url: val + '/api/tags', headers: lh },
        function (r) {
          if (!r || !r.ok) { setStatus('error', 'Cannot connect'); return; }
          setStatus('connected', 'Connected');
          var models = (r.data.models || []).map(function (m) {
            return { name: m.name, paramSize: (m.details && m.details.parameter_size) || '', sizeLabel: m.size ? formatBytes(m.size) : '' };
          });
          S.models = models;
          populateModels();
        }
      );
    }, 800);
  });

  btnSave.addEventListener('click', async function () {
    saveSettings();
    setSettingsStatus('Connecting…', '');
    await fetchModels();
  });

  // Sessions panel
  btnNewSession.addEventListener('click', newSession);

  sessionsList.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.dataset.id;
    if (btn.dataset.action === 'rename') renameSession(id);
    if (btn.dataset.action === 'delete') deleteSession(id);
  });

  // Session bar
  btnRenameSession.addEventListener('click', function () {
    if (S.activeSession) renameSession(S.activeSession.id);
  });
  btnExportSession.addEventListener('click', function () { exportSession(S.activeSession); });
  btnDeleteSession.addEventListener('click', function () {
    if (S.activeSession) deleteSession(S.activeSession.id);
  });
  sessionNameEl.addEventListener('dblclick', function () {
    if (S.activeSession) renameSession(S.activeSession.id);
  });

  // Model selector (in settings panel)
  selectModel.addEventListener('change', function () {
    if (!S.activeSession) return;
    S.activeSession.model = this.value;
    updateModelDisplay();
    debouncedSaveSession();
    renderParamsPanel();
  });

  // System prompt (now in settings panel, but also accessible from input area as reminder)
  btnToggleSystem.addEventListener('click', function () {
    // Toggle visibility in input area (for quick editing)
    var open = systemPanel.classList.toggle('hidden') === false;
    btnToggleSystem.classList.toggle('active', !systemPanel.classList.contains('hidden'));
    if (open) inputSysPrompt.focus();
  });
  btnCloseSystem.addEventListener('click', function () {
    systemPanel.classList.add('hidden');
    btnToggleSystem.classList.remove('active');
  });
  inputSysPrompt.addEventListener('input', function () {
    if (!S.activeSession) return;
    S.activeSession.systemPrompt = this.value;
    debouncedSaveSession();
  });

  // Settings panel system prompt
  var settingsSysPanel = document.getElementById('system-prompt-panel');
  if (settingsSysPanel) {
    var settingsBtnCloseSystem = settingsSysPanel.querySelector('#btn-close-system');
    if (settingsBtnCloseSystem) {
      settingsBtnCloseSystem.addEventListener('click', function () {
        settingsSysPanel.classList.add('collapsed');
      });
    }
    var settingsInputSysPrompt = settingsSysPanel.querySelector('#input-system-prompt');
    if (settingsInputSysPrompt) {
      settingsInputSysPrompt.addEventListener('input', function () {
        if (!S.activeSession) return;
        S.activeSession.systemPrompt = this.value;
        debouncedSaveSession();
      });
    }
  }

  // Params panel
  btnToggleParams.addEventListener('click', function () {
    var open = !paramsPanel.classList.contains('hidden');
    paramsPanel.classList.toggle('hidden', open);
    btnToggleParams.classList.toggle('active', !open);
    if (!open) renderParamsPanel();
  });
  btnCloseParams.addEventListener('click', function () {
    paramsPanel.classList.add('hidden');
    btnToggleParams.classList.remove('active');
  });

  // File chips (delegation)
  fileChipsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.file-chip-del');
    if (!btn) return;
    var idx = parseInt(btn.dataset.idx);
    removeAttachment(idx);
  });

  // File attach
  btnAttachFile.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () { if (this.files.length) handleFiles(this.files); });

  // Page context
  btnPageContext.addEventListener('click', togglePageContext);

  // Clear
  btnClear.addEventListener('click', function () {
    if (S.isStreaming) return;
    if (!confirm('Clear this conversation?')) return;
    if (S.activeSession) { S.activeSession.messages = []; saveSession(S.activeSession); }
    renderAllMessages();
  });

  // Textarea input & template dropdown
  inputMessage.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 160) + 'px';
    var val = this.value;
    if (val.startsWith('/')) {
      renderTmplDropdown(val.slice(1).toLowerCase());
    } else {
      templateDropdown.classList.add('hidden');
    }
  });

  inputMessage.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
    if (e.key === 'Escape') templateDropdown.classList.add('hidden');
  });

  // Templates button (open manager)
  btnTemplatesOpen.addEventListener('click', function () {
    renderTmplOverlay();
    tmplOverlay.classList.remove('hidden');
  });
  btnTmplManageInline.addEventListener('click', function () {
    templateDropdown.classList.add('hidden');
    renderTmplOverlay();
    tmplOverlay.classList.remove('hidden');
  });

  // Template overlay
  btnTmplOverlayClose.addEventListener('click', function () {
    tmplOverlay.classList.add('hidden');
  });
  tmplOverlay.addEventListener('click', function (e) {
    if (e.target === tmplOverlay) tmplOverlay.classList.add('hidden');
  });
  btnTmplAdd.addEventListener('click', function () {
    var name    = tmplNewName.value.trim();
    var content = tmplNewContent.value.trim();
    if (!name || !content) return;
    S.templates.push({ id: genId(), name: name, content: content });
    saveTemplates();
    tmplNewName.value = ''; tmplNewContent.value = '';
    renderTmplOverlay();
  });
  tmplList.addEventListener('click', function (e) {
    var btn = e.target.closest('.tmpl-item-del');
    if (!btn) return;
    var id = btn.dataset.id;
    S.templates = S.templates.filter(function (t) { return t.id !== id; });
    saveTemplates();
    renderTmplOverlay();
  });

  // Send / Stop
  btnSend.addEventListener('click', sendChat);
  btnStop.addEventListener('click', stopStream);

  // Message actions (delegation)
  messagesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.act-btn[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var msgEl  = btn.closest('.message');
    var index  = msgEl ? parseInt(msgEl.dataset.index) : -1;

    if (action === 'copy') {
      var bubble = msgEl && msgEl.querySelector('.msg-bubble');
      var text   = bubble ? (bubble.innerText || bubble.textContent || '') : '';
      navigator.clipboard.writeText(text).catch(function () {
        // fallback: select text
        var r = document.createRange(); r.selectNode(bubble);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(r);
        document.execCommand('copy');
        window.getSelection().removeAllRanges();
      });
      btn.textContent = '✓ Copied';
      setTimeout(function () { btn.innerHTML = '&#10697; Copy'; }, 1500);
    }
    if (action === 'edit')  { startEditMessage(msgEl, index); }
    if (action === 'regen') { regenerateLastResponse(); }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadAllData(async function () {
  renderSession();
  initEventHandlers();
  renderParamsPanel();
  await fetchModels();
  // After models load, sync session model to selector
  if (S.activeSession && S.activeSession.model) {
    selectModel.value = S.activeSession.model;
    if (!selectModel.value) {
      // model stored in session not in list; pick first
      if (selectModel.options.length > 1) {
        selectModel.selectedIndex = 1;
        S.activeSession.model = selectModel.value;
      }
    }
  }
});

})();
