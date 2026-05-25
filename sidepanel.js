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

var DEFAULT_TEMPLATES = [
  {
    id: '__builtin_explain', builtin: true,
    name: 'Explain this',
    content: 'Explain the following clearly, using analogies if helpful:\n\n'
  },
  {
    id: '__builtin_summarize', builtin: true,
    name: 'Summarize',
    content: 'Summarize the following. Lead with the single most important point, then cover key supporting details in bullet points:\n\n'
  },
  {
    id: '__builtin_fix_code', builtin: true,
    name: 'Fix this code',
    content: 'Find and fix any bugs in the following code. List what was wrong and why, then show the corrected version:\n\n```\n\n```'
  },
  {
    id: '__builtin_debug', builtin: true,
    name: 'Debug help',
    content: "I'm getting this error:\n\n```\n\n```\n\nHere's the relevant code:\n\n```\n\n```\n\nWhat's causing it and how do I fix it?"
  },
  {
    id: '__builtin_review', builtin: true,
    name: 'Review & improve',
    content: 'Review the following and give specific, actionable feedback. Focus on clarity, correctness, and anything that could be stronger:\n\n'
  },
  {
    id: '__builtin_write_tests', builtin: true,
    name: 'Write tests',
    content: 'Write comprehensive unit tests for the following code. Cover happy paths, edge cases, and error conditions:\n\n```\n\n```'
  },
  {
    id: '__builtin_pros_cons', builtin: true,
    name: 'Pros & cons',
    content: 'List the pros and cons of the following. Be balanced and specific:\n\n'
  },
  {
    id: '__builtin_eli5', builtin: true,
    name: 'ELI5',
    content: 'Explain this like I\'m five years old, using only simple words and a concrete analogy:\n\n'
  },
  {
    id: '__builtin_regex', builtin: true,
    name: 'Write a regex',
    content: 'Write a regex pattern that matches the following. Explain each part of the pattern and provide test cases:\n\n'
  },
  {
    id: '__builtin_translate', builtin: true,
    name: 'Translate',
    content: 'Translate the following to [language]. Preserve tone and meaning as closely as possible:\n\n'
  }
];

var DEFAULT_PERSONAS = [
  {
    id: '__persona_default', builtin: true,
    name: 'Assistant',
    prompt: 'Be concise and detailed. Give the most information in the fewest words unless the topic requires a longer explanation.'
  },
  {
    id: '__persona_code_reviewer', builtin: true,
    name: 'Code Reviewer',
    prompt: 'You are an expert code reviewer. Analyze code for bugs, security vulnerabilities, performance issues, and style problems. Be specific — reference line numbers or variable names, and always show a corrected example alongside your critique.'
  },
  {
    id: '__persona_study_buddy', builtin: true,
    name: 'Study Buddy',
    prompt: 'You are a patient tutor. Explain concepts step by step using plain language and concrete analogies. After explaining, ask one follow-up question to check understanding. Never just give answers — guide the user to figure things out.'
  },
  {
    id: '__persona_editor', builtin: true,
    name: 'Writing Editor',
    prompt: 'You are a professional editor. Prioritize clarity, conciseness, and flow. Give specific rewrites, not general advice. Preserve the author\'s voice. Point out the two or three most impactful changes first.'
  },
  {
    id: '__persona_rubber_duck', builtin: true,
    name: 'Rubber Duck',
    prompt: 'Help the user think through their problem by asking clarifying questions. Do not jump to solutions. Reflect back what you hear, identify what is unclear or assumed, and guide them toward their own answer.'
  },
  {
    id: '__persona_devil', builtin: true,
    name: "Devil's Advocate",
    prompt: 'Constructively challenge the user\'s ideas and assumptions. Identify weaknesses in their reasoning, overlooked risks, and alternative perspectives. Be direct and specific, not dismissive.'
  },
  {
    id: '__persona_tech_writer', builtin: true,
    name: 'Technical Writer',
    prompt: 'Write clear, precise technical documentation. Use active voice. Define every acronym on first use. Structure content with headers, numbered steps for procedures, and code examples where relevant.'
  },
  {
    id: '__persona_brief', builtin: true,
    name: 'Be Brief (BLUF)',
    prompt: 'Use BLUF format. Lead with the direct answer in one sentence. Follow with no more than 3 bullet points of essential context if needed. If the answer fits in one sentence, stop there. Do not restate the question, add pleasantries, or summarize at the end.'
  }
];

// ── State ─────────────────────────────────────────────────────────────────────

var S = {
  settings:            { url: 'http://localhost:11434', token: '' },
  theme:               'dark',
  models:              [],
  storedParams:        {},
  defaultModel:        '',
  defaultSystemPrompt: '',
  templates:           [],
  personas:            [],
  activePersonaId:     null,
  sessions:            [],
  activeSession:       null,
  pageContext:         null,
  usePageContext:      false,
  attachments:         [],
  isStreaming:         false,
  currentStream:       null,
  autoScroll:          true,
  compact:             false,
  compareMode:         false,
  language:            '',
  embedModel:          ''
};

var _ctrlLPending = false;
var _ctrlLTimer   = null;

// ── Debug logging ─────────────────────────────────────────────────────────────

var DBG_KEY = 'ollama_debug_log';
var DBG_MAX = 500;

function dbg(type, msg, detail) {
  var entry = {
    ts:     Date.now(),
    type:   type,
    msg:    msg,
    detail: detail !== undefined ? JSON.parse(JSON.stringify(detail)) : undefined
  };
  chrome.storage.local.get(DBG_KEY, function (r) {
    var log = r[DBG_KEY] || [];
    var cutoff = Date.now() - (30 * 60 * 1000);
    log = log.filter(function (e) { return e.ts > cutoff; });
    log.push(entry);
    if (log.length > DBG_MAX) log.splice(0, log.length - DBG_MAX);
    chrome.storage.local.set({ [DBG_KEY]: log });
  });
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

var app             = document.getElementById('app');
var statusDot       = document.getElementById('status-dot');
var btnSessions     = document.getElementById('btn-sessions');
var sessionsPanel   = document.getElementById('sessions-panel');
var sessionsList    = document.getElementById('sessions-list');
var sessionSearch   = document.getElementById('session-search');
var btnNewSession   = document.getElementById('btn-new-session');
var btnSettings     = document.getElementById('btn-settings');
var sessionNameEl   = document.getElementById('session-name-display');
var btnExportSession = document.getElementById('btn-export-session');
var btnDeleteSession = document.getElementById('btn-delete-session');
var chatArea        = document.getElementById('chat-area');
var messagesEl      = document.getElementById('messages');
var fileChipsArea   = document.getElementById('file-chips-area');
var fileChipsEl     = document.getElementById('file-chips');
var btnPageContext  = document.getElementById('btn-page-context');
var pageCtxLbl     = document.getElementById('page-ctx-lbl');
var btnTemplatesOpen = document.getElementById('btn-templates-open');
var inputMessage    = document.getElementById('input-message');
var templateDropdown = document.getElementById('template-dropdown');
var tmplDdList      = document.getElementById('tmpl-dd-list');
var btnTmplManageInline = document.getElementById('btn-tmpl-manage-inline');
var btnSend         = document.getElementById('btn-send');
var tmplOverlay     = document.getElementById('tmpl-overlay');
var tmplList        = document.getElementById('tmpl-list');
var tmplNewName     = document.getElementById('tmpl-new-name');
var tmplNewContent  = document.getElementById('tmpl-new-content');
var btnTmplAdd      = document.getElementById('btn-tmpl-add');
var btnTmplOverlayClose = document.getElementById('btn-tmpl-overlay-close');
var modelSelect     = document.getElementById('model-select');
var modelSelectB    = document.getElementById('model-select-b');
var btnCompare      = document.getElementById('btn-compare');
var personaOverlay  = document.getElementById('persona-overlay');
var personaList     = document.getElementById('persona-list');
var personaNewName  = document.getElementById('persona-new-name');
var personaNewPrompt = document.getElementById('persona-new-prompt');
var btnPersonaAdd   = document.getElementById('btn-persona-add');
var btnPersonaOverlayClose = document.getElementById('btn-persona-overlay-close');
var exportOverlay      = document.getElementById('export-overlay');
var exportOverlayTitle = document.getElementById('export-overlay-title');
var exportContent      = document.getElementById('export-content');
var btnExportCopy      = document.getElementById('btn-export-copy');
var btnExportClose     = document.getElementById('btn-export-close');
var helpOverlay        = document.getElementById('help-overlay');

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

function setSendEnabled(on) {
  inputMessage.disabled = !on;
  if (on) {
    btnSend.innerHTML   = '&#9658;';
    btnSend.title       = 'Send (Enter)';
    btnSend.classList.remove('streaming');
    btnSend.onclick     = null;
    dbg('CLICK', 'send button switched to send mode');
  } else {
    btnSend.innerHTML   = '&#9632;';
    btnSend.title       = 'Stop generation';
    btnSend.classList.add('streaming');
    btnSend.onclick     = function (e) {
      e.stopPropagation();
      dbg('CLICK', 'send button used to abort stream', { requestId: S.currentStream && S.currentStream.requestId });
      stopStream();
    };
    dbg('CLICK', 'send button switched to stop mode');
  }
}

function updateCtxBar() {
  var bar = document.getElementById('ctx-bar');
  if (!bar || !S.activeSession) return;
  var opts    = Object.assign({}, DEF_PARAMS, S.storedParams);
  var numCtx  = opts.num_ctx || 4096;
  var msgs    = S.activeSession.messages || [];
  var usedChars = msgs.reduce(function (n, m) { return n + (m.content || '').length; }, 0);
  var usedToks  = Math.round(usedChars / 3.5);
  var pct       = Math.min(usedToks / numCtx * 100, 100);
  bar.style.width = pct + '%';
  var pctEl = document.getElementById('ctx-bar-pct');
  if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  var prevClass = bar.className;
  bar.className = 'ctx-bar' + (pct > 85 ? ' danger' : pct > 60 ? ' warn' : '');
  if (bar.className !== prevClass) {
    dbg('INFO', 'context window usage changed zone', {
      pct:      Math.round(pct),
      usedToks: usedToks,
      numCtx:   numCtx,
      zone:     pct > 85 ? 'danger' : pct > 60 ? 'warn' : 'ok'
    });
  }
  document.getElementById('ctx-bar-wrap').title =
    '~' + usedToks + ' / ' + numCtx + ' tokens used';
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

marked.setOptions({ breaks: true, gfm: true });

// marked v9 dropped the highlight option from setOptions; wire it via the renderer instead
marked.use({
  renderer: {
    code: function(code, lang) {
      var highlighted;
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, { language: lang }).value;
      } else {
        highlighted = hljs.highlightAuto(code).value;
      }
      return '<pre' + (lang ? ' data-lang="' + lang + '"' : '') + '><code class="hljs">' + highlighted + '</code></pre>';
    }
  }
});

function renderMarkdown(raw) {
  if (!raw) return '';
  try {
    return marked.parse(raw);
  } catch (e) {
    return escapeHtml(raw).replace(/\n/g, '<br>');
  }
}

// ── RAG pipeline ──────────────────────────────────────────────────────────────

var STOP_WORDS = new Set(
  'the a an is are was were be been have has had do does did will would could should may might can this that these those i you he she it we they and or but in on at to for of with by from as into than then also just so more very well still even back after'.split(' ')
);

// ── Dynamic context budget ────────────────────────────────────────────────────
// Derive character budget from num_ctx so larger context windows get more content.
// Reserve ~1200 tokens for conversation history + system prompt + response headroom.
// 1 token ≈ 3.5 chars for English prose.
function getContextBudget() {
  var opts   = Object.assign({}, DEF_PARAMS, S.storedParams);
  var numCtx = opts.num_ctx || 4096;
  var reserved = 1200;
  return Math.min(Math.floor((numCtx - reserved) * 3.5), 80000);
}

// ── Chunking on paragraph boundaries ─────────────────────────────────────────
// Split on double-newlines (paragraph breaks preserved by content.js).
// Merge tiny fragments into neighbours. Split oversized paragraphs at sentences.
var MAX_CHUNK_CHARS = 600;
var MIN_CHUNK_CHARS = 60;

function chunkText(text) {
  var raw = (text || '').split(/\n\n+/);
  var chunks = [];
  var buf = '';

  raw.forEach(function (para) {
    para = para.trim();
    if (!para) return;

    // Oversized paragraph — split at sentence boundaries
    if (para.length > MAX_CHUNK_CHARS) {
      if (buf) { chunks.push(buf); buf = ''; }
      var sentences = para.match(/[^.!?]+[.!?]+["']?\s*/g) || [para];
      var sentBuf = '';
      sentences.forEach(function (s) {
        if (sentBuf.length + s.length > MAX_CHUNK_CHARS && sentBuf) {
          chunks.push(sentBuf.trim());
          sentBuf = s;
        } else {
          sentBuf += s;
        }
      });
      if (sentBuf.trim()) chunks.push(sentBuf.trim());
      return;
    }

    // Tiny fragment — merge into buffer
    if (para.length < MIN_CHUNK_CHARS) {
      buf = buf ? buf + ' ' + para : para;
      return;
    }

    // Normal paragraph
    if (buf) { chunks.push(buf); buf = ''; }
    chunks.push(para);
  });

  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

// ── Embedding helpers ─────────────────────────────────────────────────────────

function getEmbedding(text, cb) {
  if (!S.embedModel) { cb(null); return; }
  dbg('OLLAMA', 'embedding request', { model: S.embedModel, textLen: text.length, preview: text.slice(0, 60) });
  chrome.runtime.sendMessage({
    action:  'OLLAMA_FETCH_JSON',
    url:     S.settings.url + '/api/embed',
    headers: getHeaders(),
    body:    JSON.stringify({ model: S.embedModel, input: text })
  }, function (res) {
    if (!res || !res.ok || !res.data || !res.data.embeddings) {
      dbg('ERROR', 'embedding failed', { model: S.embedModel, error: 'no embedding in response' });
      cb(null);
      return;
    }
    var vec = res.data.embeddings[0];
    dbg('OLLAMA', 'embedding received', { model: S.embedModel, dims: vec.length });
    cb(vec);
  });
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  var dot = 0, na = 0, nb = 0;
  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ── Scoring ───────────────────────────────────────────────────────────────────
// Extract query terms — remove stop words, deduplicate.
function queryTerms(query) {
  return (query || '').toLowerCase()
    .split(/\W+/)
    .filter(function (w) { return w.length > 2 && !STOP_WORDS.has(w); })
    .filter(function (w, i, a) { return a.indexOf(w) === i; });
}

// Score a single chunk. Returns a float.
// - Term frequency: count of matching query terms (with simple stem: also try +s, -s, -ed, -ing)
// - Heading bonus: headings are high-signal anchors
// - Position bonus: earlier chunks are often context-setting
function scoreChunk(chunk, terms, idx, total) {
  if (!terms.length) return 1;
  var lower = chunk.toLowerCase();
  var tf = 0;
  terms.forEach(function (t) {
    // Exact match
    var exact = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'gi');
    var m = lower.match(exact);
    if (m) tf += m.length;
    // Stem variants: try stripping/adding common suffixes
    var stems = [t + 's', t + 'ed', t + 'ing', t.replace(/s$/, ''), t.replace(/ing$/, ''), t.replace(/ed$/, '')];
    stems.forEach(function (s) {
      if (s !== t && s.length > 2) {
        var re = new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'gi');
        var sm = lower.match(re);
        if (sm) tf += sm.length * 0.5; // half-weight for stem matches
      }
    });
  });

  if (tf === 0) return 0;

  // Heading bonus — markdown headings start with #
  var headingBonus = /^#{1,6} /.test(chunk) ? 2.0 : 1.0;

  // Position bonus — first 20% of document gets 1.25×, rest tapers to 1.0
  var posWeight = total > 1 ? (1.0 + 0.25 * Math.max(0, 1 - (idx / (total * 0.2)))) : 1.0;

  return tf * headingBonus * posWeight;
}

// ── Selection with adjacent context ──────────────────────────────────────────
// Shared assembly: pick top-scored items within budget, expand with neighbours,
// then re-sort into document order.
function assembleChunks(scored, budget) {
  var byIdx = {};
  scored.forEach(function (x) { byIdx[x.idx] = x.c; });

  // Use document order when all scores are equal (e.g. no query terms →
  // keyword scores all 1) or when no positive scores exist.
  // For both keyword hits (scores > 1) and cosine similarities (0–1 but
  // varying), we detect "meaningful order" by checking score variance.
  var allSame = scored.length <= 1 || scored.every(function (x) { return x.s === scored[0].s; });
  var hasOrder = !allSame && scored.some(function (x) { return x.s > 0; });

  var ordered;
  if (!hasOrder) {
    ordered = scored.slice();
  } else {
    ordered = scored.filter(function (x) { return x.s > 0; })
                    .sort(function (a, b) { return b.s - a.s; });
  }

  var selected = {};
  var chars = 0;
  for (var i = 0; i < ordered.length; i++) {
    var item = ordered[i];
    if (chars + item.c.length > budget) break;
    selected[item.idx] = true;
    chars += item.c.length;

    [-1, 1].forEach(function (offset) {
      var ni = item.idx + offset;
      if (byIdx[ni] !== undefined && !selected[ni]) {
        if (chars + byIdx[ni].length <= budget) {
          selected[ni] = true;
          chars += byIdx[ni].length;
        }
      }
    });
  }

  return Object.keys(selected)
    .map(Number)
    .sort(function (a, b) { return a - b; })
    .map(function (idx) { return byIdx[idx]; })
    .join('\n\n');
}

// Keyword fallback: score chunks by term frequency then assemble.
function selectChunksKeyword(chunks, query, budget) {
  var terms = queryTerms(query);
  var total = chunks.length;
  var scored = chunks.map(function (c, i) {
    return { c: c, s: scoreChunk(c, terms, i, total), idx: i };
  });
  return assembleChunks(scored, budget);
}

// Async entry point: uses vector similarity when an embed model is configured,
// falls back to keyword scoring on failure or when no model is set.
function selectChunks(text, query, budget, cb) {
  budget = budget || getContextBudget();

  // Short content fits entirely — skip chunking and embedding entirely.
  if (!text || text.length < 500) { cb(text ? text.slice(0, budget) : ''); return; }

  var chunks = chunkText(text);
  if (!chunks.length) { cb(''); return; }

  // Single chunk: nothing to compare against semantically — return it directly.
  if (chunks.length === 1) { cb(chunks[0].length <= budget ? chunks[0] : chunks[0].slice(0, budget)); return; }

  // Content quality gate — skip embedding on very short/garbage content
  var totalTextLen = chunks.reduce(function (n, c) { return n + c.length; }, 0);
  if (!S.embedModel || !query || totalTextLen < 200) {
    dbg('INFO', 'semantic RAG fallback to keyword scoring', {
      reason: !S.embedModel ? 'no embed model configured' : !query ? 'no query' : 'content below threshold',
      totalChars: totalTextLen
    });
    cb(selectChunksKeyword(chunks, query, budget));
    return;
  }

  dbg('INFO', 'semantic RAG started', { chunkCount: chunks.length, embedModel: S.embedModel, queryPreview: query.slice(0, 60) });

  var scored = chunks.map(function (c, i) { return { c: c, s: 0, idx: i }; });

  // Fire query embedding and all chunk embeddings in parallel
  var queryEmbedPromise = new Promise(function (resolve) {
    getEmbedding(query, resolve);
  });
  var chunkEmbedPromises = chunks.map(function (chunk, i) {
    return new Promise(function (resolve) {
      getEmbedding(chunk, function (vec) {
        scored[i]._vec = vec;
        resolve();
      });
    });
  });

  Promise.all([queryEmbedPromise].concat(chunkEmbedPromises))
    .then(function (results) {
      var queryVec = results[0];
      if (!queryVec) {
        dbg('INFO', 'semantic RAG fallback to keyword scoring', { reason: 'embedding call failed' });
        cb(selectChunksKeyword(chunks, query, budget));
        return;
      }
      scored.forEach(function (item) {
        item.s = cosineSimilarity(queryVec, item._vec);
        delete item._vec;
      });
      var result = assembleChunks(scored, budget);
      dbg('INFO', 'semantic RAG complete', { chunkCount: chunks.length, selectedChars: result.length, budget: budget });
      cb(result);
    });
}

// ── Build context block ───────────────────────────────────────────────────────
// Always include title + meta description as a header — these are free signal
// that costs few tokens. Then fill the remaining budget with scored chunks.
// Async because selectChunks may call the embedding API.
function buildContextBlock(userQuery, cb) {
  // Fast path — no context sources active, skip all embedding work
  if (!S.usePageContext && !S.attachments.length) {
    dbg('INFO', 'buildContextBlock — no context sources active, skipping');
    cb(null);
    return;
  }

  var budget  = getContextBudget();
  var sources = [];
  var names   = [];

  var pending = [];
  if (S.usePageContext && S.pageContext && S.pageContext.content) {
    pending.push({ type: 'page', pc: S.pageContext });
  }
  S.attachments.forEach(function (att) {
    if (att.type !== 'image') pending.push({ type: 'file', att: att });
  });

  if (!pending.length) { cb(null); return; }

  var idx = 0;
  function processNext() {
    if (idx >= pending.length) {
      if (sources.length) {
        var ctxText = '[Context]\n' + sources.join('\n\n');
        dbg('INFO', 'context block built', { sources: names, totalChars: ctxText.length, semantic: !!S.embedModel });
        cb({ text: ctxText, names: names });
      } else {
        cb(null);
      }
      return;
    }
    var item      = pending[idx++];
    var remaining = budget - sources.reduce(function (n, s) { return n + s.length; }, 0);
    if (remaining < 200) { processNext(); return; }

    if (item.type === 'page') {
      var pc            = item.pc;
      var contentBudget = Math.max(remaining - 200, 500);
      selectChunks(pc.content, userQuery, contentBudget, function (body) {
        if (body) {
          var header = '=== ' + (pc.title || pc.url || 'Page') + ' ===';
          if (pc.description) header += '\n' + pc.description;
          sources.push(header + '\n\n' + body);
          names.push(pc.title || 'Page');
        }
        processNext();
      });
    } else {
      var att = item.att;
      selectChunks(att.content, userQuery, remaining - 50, function (body) {
        if (body) {
          sources.push('=== ' + att.name + ' ===\n\n' + body);
          names.push(att.name);
        }
        processNext();
      });
    }
  }
  processNext();
}

// ── Storage ───────────────────────────────────────────────────────────────────

function loadAllData(cb) {
  chrome.storage.local.get(
    ['ollamaSidebarUrl','ollamaSidebarToken','ollamaSidebarTheme',
     'ollamaSidebarSystemPrompt','ollamaSidebarDefaultModel','ollamaSidebarParams',
     'ollama_si','ollama_sa','ollama_tp','ollama_personas','ollama_active_persona',
     'ollamaSidebarCompact','ollamaSidebarLanguage','ollamaSidebarEmbedModel',
     'ollamaSidebarAutoScroll'],
    function (r) {
      S.settings.url   = r.ollamaSidebarUrl   || 'http://localhost:11434';
      S.settings.token = r.ollamaSidebarToken  || '';
      S.storedParams   = r.ollamaSidebarParams  || {};
      S.defaultModel   = r.ollamaSidebarDefaultModel || '';
      S.defaultSystemPrompt = r.ollamaSidebarSystemPrompt ||
        'Be concise and detailed. Give the most information in the fewest words unless the topic requires a longer explanation.';
      S.theme      = r.ollamaSidebarTheme || 'dark';
      S.language   = r.ollamaSidebarLanguage || '';
      S.embedModel = r.ollamaSidebarEmbedModel || '';
      S.autoScroll = r.ollamaSidebarAutoScroll !== false;
      applyTheme(S.theme);
      applyCompact(r.ollamaSidebarCompact || false);
      dbg('INFO', 'compact mode restored from storage', { enabled: S.compact });
      dbg('INFO', 'language lock loaded', { language: S.language || 'none' });
      S.sessions  = r.ollama_si || [];
      var userTemplates = (r.ollama_tp || []).filter(function (t) { return !t.builtin; });
      S.templates = DEFAULT_TEMPLATES.concat(userTemplates);
      var userPersonas = (r.ollama_personas || []).filter(function (p) { return !p.builtin; });
      S.personas = DEFAULT_PERSONAS.concat(userPersonas);
      S.activePersonaId = r.ollama_active_persona || '__persona_default';

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

function saveTemplates() {
  var userOnly = S.templates.filter(function (t) { return !t.builtin; });
  chrome.storage.local.set({ ollama_tp: userOnly });
}

function savePersonas() {
  var userOnly = S.personas.filter(function (p) { return !p.builtin; });
  chrome.storage.local.set({ ollama_personas: userOnly });
}

function saveActivePersona(id) {
  S.activePersonaId = id;
  chrome.storage.local.set({ ollama_active_persona: id });
}

// ── Session management ────────────────────────────────────────────────────────

function createSessionObj(name) {
  var model = S.defaultModel || '';
  var generatedName = '';
  if (!name && S.attachments.length === 0 && S.pageContext) {
    var ctx = S.pageContext.title || S.pageContext.url || 'page';
    generatedName = '[From ' + ctx + ']';
  }
  return {
    id:           genId(),
    name:         name || generatedName || 'New Chat',
    model:        model,
    systemPrompt: S.defaultSystemPrompt || '',
    messages:     [],
    createdAt:    Date.now(),
    updatedAt:    Date.now()
  };
}

function newSession() {
  if (S.activeSession) saveSession(S.activeSession);
  var sess = createSessionObj('New Chat');
  dbg('SESSION', 'new session created', { id: sess.id });
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
    dbg('SESSION', 'session switched', { id: id });
    chrome.storage.local.set({ ollama_sa: id });
    renderSession();
    updateSessionsPanel();
    closePanels();
  });
}

function deleteSession(id) {
  dbg('SESSION', 'session deleted', { id: id });
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
  var current = meta.name;

  var inp = document.createElement('input');
  inp.type = 'text';
  inp.value = current;
  inp.maxLength = 80;
  inp.className = 'session-name-input';
  sessionNameEl.replaceWith(inp);
  inp.focus(); inp.select();

  function commit() {
    var name = inp.value.trim().slice(0, 80) || current;
    inp.replaceWith(sessionNameEl);
    sessionNameEl.textContent = name;
    meta.name = name;
    if (S.activeSession && S.activeSession.id === id) {
      S.activeSession.name = name;
      saveSession(S.activeSession);
    } else {
      chrome.storage.local.get('ollama_ss_' + id, function (r) {
        var sess = r['ollama_ss_' + id];
        if (sess) { sess.name = name; saveSession(sess); }
        else { chrome.storage.local.set({ ollama_si: S.sessions }); }
      });
    }
    updateSessionsPanel();
  }

  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { inp.replaceWith(sessionNameEl); }
  });
  inp.addEventListener('blur', commit);
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
  var text = lines.join('\n');
  exportOverlayTitle.textContent = sess.name || 'Export';
  exportContent.textContent = text;
  btnExportCopy.textContent = 'Copy';
  exportOverlay.classList.remove('hidden');
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
          dbg('ERROR', 'fetchModels failed', { error: e });
          resolve(false); return;
        }
        if (!response.ok) {
          var msg = humanizeError(response.error || ('HTTP ' + response.status));
          setStatus('error', msg);
          dbg('ERROR', 'fetchModels failed', { error: msg });
          resolve(false); return;
        }
        var raw = response.data.models || [];
        S.models = raw.map(function (m) {
          return {
            name:       m.name,
            paramSize:  (m.details && m.details.parameter_size) || '',
            sizeLabel:  m.size ? formatBytes(m.size) : ''
          };
        });
        setStatus('connected', 'Connected');
        dbg('MODEL', 'models fetched', { count: S.models.length, models: S.models.map(function(m){ return m.name; }) });
        resolve(true);
      }
    );
  });
}

function populateModels() {
  if (!S.activeSession) { populateModelSelect(); return; }
  if (!S.activeSession.model && S.defaultModel) {
    S.activeSession.model = S.defaultModel;
    debouncedSaveSession();
  }
  var names = S.models.map(function (m) { return m.name; });
  if (S.activeSession.model && names.length && names.indexOf(S.activeSession.model) === -1) {
    var fallback = (S.defaultModel && names.indexOf(S.defaultModel) !== -1)
      ? S.defaultModel : (names[0] || '');
    S.activeSession.model = fallback;
    debouncedSaveSession();
  }
  populateModelSelect();
}

function getModelOptions() {
  return Object.assign({}, DEF_PARAMS, S.storedParams);
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
  dbg('INFO', 'page context toggled', { enabled: !S.usePageContext });
  if (S.usePageContext) {
    S.usePageContext = false; S.pageContext = null;
    btnPageContext.classList.remove('active');
    pageCtxLbl.textContent = 'Add page';
    return;
  }
  btnPageContext.disabled = true;
  pageCtxLbl.textContent = 'Loading…';
  try {
    var ctx = await getPageContent();
    S.pageContext = ctx; S.usePageContext = true;
    dbg('INFO', 'page context fetched', { wordCount: ctx.content ? ctx.content.split(/\s+/).length : 0, url: ctx.url });
    btnPageContext.classList.add('active');
    var title = (ctx.title || ctx.url || 'page').trim();
    pageCtxLbl.textContent = title.length > 20 ? title.slice(0, 18) + '…' : title;
  } catch (e) {
    dbg('ERROR', 'page context failed', { error: e.message });
    pageCtxLbl.textContent = 'Add page';
    appendSystemMsg('Could not read page: ' + e.message);
  } finally {
    btnPageContext.disabled = false;
  }
}

// ── File attachments ──────────────────────────────────────────────────────────

async function extractPdfText(buffer) {
  if (typeof pdfjsLib === 'undefined') {
    dbg('ERROR', 'PDF.js not loaded — falling back to byte scan');
    return extractPdfTextFallback(buffer);
  }
  try {
    var pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    dbg('INFO', 'PDF loaded', { pages: pdf.numPages });
    var allText = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      var page    = await pdf.getPage(i);
      var content = await page.getTextContent();
      var pageText = content.items
        .map(function (item) { return item.str; })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) allText.push('--- Page ' + i + ' ---\n' + pageText);
    }
    var result = allText.join('\n\n');
    dbg('INFO', 'PDF text extracted', { pages: pdf.numPages, chars: result.length });
    return result;
  } catch (e) {
    dbg('ERROR', 'PDF.js extraction failed', { error: e.message });
    return extractPdfTextFallback(buffer);
  }
}

function extractPdfTextFallback(buffer) {
  var bytes = new Uint8Array(buffer);
  var runs = []; var cur = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b >= 32 && b <= 126)   { cur += String.fromCharCode(b); }
    else if (b === 10 || b === 13) { if (cur.length > 3) runs.push(cur); cur = ''; }
    else { if (cur.length > 3) runs.push(cur); cur = ''; }
  }
  if (cur.length > 3) runs.push(cur);
  return runs
    .filter(function (s) { return !/^[\/\-\(\)\.]{2,}$/.test(s.trim()); })
    .join(' ').replace(/\s+/g, ' ').trim();
}

function handleFiles(files) {
  dbg('FILE', 'handleFiles called', { count: files.length, names: Array.from(files).map(function(f){ return f.name; }) });
  Array.prototype.forEach.call(files, function (file) {
    var name = file.name;
    var ext  = name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      var reader = new FileReader();
      reader.onload = async function (e) {
        dbg('FILE', 'PDF file read, extracting text', { name: name });
        var text = await extractPdfText(e.target.result);
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
}

function handleImages(files) {
  dbg('FILE', 'image files received', {
    count:  files.length,
    names:  files.map(function(f){ return f.name; }),
    types:  files.map(function(f){ return f.type; })
  });
  files.forEach(function (file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var b64 = e.target.result.split(',')[1];
      S.attachments.push({ name: file.name, type: 'image', mime: file.type, content: b64 });
      dbg('FILE', 'image encoded and attached', { name: file.name, mime: file.type, b64Len: b64.length });
      renderFileChips();
    };
    reader.readAsDataURL(file);
  });
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
    if (att.type === 'image') {
      chip.innerHTML =
        '<img class="file-chip-thumb" src="data:' + att.mime + ';base64,' + att.content + '" alt="' + escapeHtml(att.name) + '">' +
        '<span class="file-chip-name" title="' + escapeHtml(att.name) + '">' + escapeHtml(att.name) + '</span>' +
        '<button class="file-chip-del" data-idx="' + i + '" title="Remove">&#10005;</button>';
    } else {
      chip.innerHTML =
        '<span class="file-chip-name" title="' + escapeHtml(att.name) + '">' + escapeHtml(att.name) + '</span>' +
        '<button class="file-chip-del" data-idx="' + i + '" title="Remove">&#10005;</button>';
    }
    fileChipsEl.appendChild(chip);
  });
}

// ── Template management ───────────────────────────────────────────────────────

function renderTmplOverlay() {
  tmplList.innerHTML = '';
  var builtins = S.templates.filter(function (t) { return t.builtin; });
  var user     = S.templates.filter(function (t) { return !t.builtin; });

  function makeItem(t) {
    var el = document.createElement('div');
    el.className = 'tmpl-item';
    var action = t.builtin
      ? '<span class="tmpl-builtin-badge" title="Built-in">&#128274;</span>'
      : '<button class="tmpl-item-del" data-id="' + t.id + '" title="Delete">&#10005;</button>';
    el.innerHTML =
      '<div class="tmpl-item-body">' +
        '<div class="tmpl-item-name">' + escapeHtml(t.name) + '</div>' +
        '<div class="tmpl-item-text">' + escapeHtml((t.content || '').slice(0, 80)) + '</div>' +
      '</div>' + action;
    tmplList.appendChild(el);
  }

  builtins.forEach(makeItem);

  if (user.length) {
    var sep = document.createElement('div');
    sep.className = 'tmpl-section-label';
    sep.textContent = 'Your templates';
    tmplList.appendChild(sep);
    user.forEach(makeItem);
  } else if (!builtins.length) {
    tmplList.innerHTML = '<div style="padding:12px;color:var(--fg3);font-size:12px;">No templates yet.</div>';
  }
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

function applyPersona(id) {
  var persona = S.personas.find(function (p) { return p.id === id; });
  if (!persona || !S.activeSession) return;
  dbg('PERSONA', 'applied', { id: id, name: persona.name });
  S.activeSession.systemPrompt = persona.prompt;
  saveActivePersona(id);
  debouncedSaveSession();
  updatePersonaButton();
}

function updatePersonaButton() {
  var btn = document.getElementById('btn-persona');
  if (!btn) return;
  var persona = S.personas.find(function (p) { return p.id === S.activePersonaId; });
  btn.title = persona ? ('Persona: ' + persona.name) : 'Switch persona';
  btn.classList.toggle('active', !!S.activePersonaId && S.activePersonaId !== '__persona_default');
}

function renderPersonaOverlay() {
  personaList.innerHTML = '';
  var builtins = S.personas.filter(function (p) { return p.builtin; });
  var user     = S.personas.filter(function (p) { return !p.builtin; });

  function makeItem(p) {
    var isActive = S.activePersonaId === p.id;
    var el = document.createElement('div');
    el.className = 'tmpl-item' + (isActive ? ' persona-active' : '');
    var action = p.builtin
      ? '<span class="tmpl-builtin-badge" title="Built-in">&#128274;</span>'
      : '<button class="tmpl-item-del" data-id="' + p.id + '" title="Delete">&#10005;</button>';
    el.innerHTML =
      '<div class="tmpl-item-body" style="cursor:pointer">' +
        '<div class="tmpl-item-name">' + escapeHtml(p.name) +
          (isActive ? ' <span style="color:var(--accent);font-size:10px;">&#9679; active</span>' : '') +
        '</div>' +
        '<div class="tmpl-item-text">' + escapeHtml((p.prompt || '').slice(0, 80)) + '</div>' +
      '</div>' + action;
    el.querySelector('.tmpl-item-body').addEventListener('click', function () {
      applyPersona(p.id);
      personaOverlay.classList.add('hidden');
    });
    personaList.appendChild(el);
  }

  builtins.forEach(makeItem);
  if (user.length) {
    var sep = document.createElement('div');
    sep.className = 'tmpl-section-label';
    sep.textContent = 'Your personas';
    personaList.appendChild(sep);
    user.forEach(makeItem);
  }

  personaList.addEventListener('click', function (e) {
    var btn = e.target.closest('.tmpl-item-del');
    if (!btn) return;
    var id = btn.dataset.id;
    S.personas = S.personas.filter(function (p) { return p.id !== id || p.builtin; });
    if (S.activePersonaId === id) applyPersona('__persona_default');
    savePersonas();
    renderPersonaOverlay();
  }, { once: true });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function applyTheme(t) {
  S.theme = t;
  app.setAttribute('data-theme', t);
  chrome.storage.local.set({ ollamaSidebarTheme: t });
}

function applyCompact(on) {
  S.compact = on;
  app.classList.toggle('compact', on);
  chrome.storage.local.set({ ollamaSidebarCompact: on });
  dbg('INFO', 'compact mode', { enabled: on });
}

function closePanels() {
  sessionsPanel.classList.add('hidden');
  btnSessions.classList.remove('active');
  sessionSearch.value = '';
  updateSessionsPanel();
}

function renderSessionItem(s) {
  var el = document.createElement('div');
  el.className = 'session-item' + (S.activeSession && S.activeSession.id === s.id ? ' active' : '');
  var ts = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '';
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
  return el;
}

function renderFilteredSessions(list) {
  dbg('SESSION', 'search results rendered', { showing: list.length });
  sessionsList.innerHTML = '';
  if (!list.length) {
    sessionsList.innerHTML = '<div style="padding:8px;color:var(--fg3);font-size:12px;">No matches.</div>';
    return;
  }
  list.forEach(function (s) { sessionsList.appendChild(renderSessionItem(s)); });
}

function filterSessions(query) {
  query = (query || '').toLowerCase().trim();
  if (!query) { renderFilteredSessions(S.sessions); return; }

  dbg('SESSION', 'search query entered', { query: query, totalSessions: S.sessions.length });

  var nameMatches = S.sessions.filter(function (s) {
    return s.name.toLowerCase().includes(query);
  });
  dbg('SESSION', 'search name matches', { count: nameMatches.length });
  var remaining = S.sessions.filter(function (s) {
    return !s.name.toLowerCase().includes(query);
  });

  if (!remaining.length) { renderFilteredSessions(nameMatches); return; }

  var keys = remaining.map(function (s) { return 'ollama_ss_' + s.id; });
  chrome.storage.local.get(keys, function (r) {
    var contentMatches = remaining.filter(function (s) {
      var sess = r['ollama_ss_' + s.id];
      if (!sess || !sess.messages) return false;
      return sess.messages.some(function (m) {
        return (m.content || '').toLowerCase().includes(query);
      });
    });
    dbg('SESSION', 'search content matches', { count: contentMatches.length });
    renderFilteredSessions(nameMatches.concat(contentMatches));
  });
}

function updateSessionsPanel() {
  if (!S.sessions.length) {
    sessionsList.innerHTML = '<div style="padding:8px;color:var(--fg3);font-size:12px;">No saved sessions.</div>';
    return;
  }
  filterSessions(sessionSearch ? sessionSearch.value : '');
}

function updateSessionBar() {
  if (!S.activeSession) return;
  sessionNameEl.textContent = S.activeSession.name;
}

function populateModelSelect() {
  var current = (S.activeSession && S.activeSession.model) || '';

  if (!S.models.length) {
    if (!modelSelect.options.length) {
      var opt = document.createElement('option');
      opt.value = ''; opt.textContent = '(no model)';
      modelSelect.appendChild(opt);
    }
    return;
  }

  modelSelect.innerHTML = '';
  S.models.forEach(function(m) {
    var opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = m.name;
    modelSelect.appendChild(opt);
  });
  modelSelect.value = current;

  // Keep the secondary compare selector in sync
  var currentB = modelSelectB.value;
  modelSelectB.innerHTML = '';
  var ph = document.createElement('option');
  ph.value = ''; ph.textContent = '(second model)';
  modelSelectB.appendChild(ph);
  S.models.forEach(function(m) {
    var opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = m.name;
    modelSelectB.appendChild(opt);
  });
  if (currentB) modelSelectB.value = currentB;
  dbg('MODEL', 'populate model select B', { count: S.models.length, currentB: modelSelectB.value });
}

function renderSession() {
  if (!S.activeSession) return;
  updateSessionBar();
  populateModelSelect();
  renderAllMessages();
  updatePersonaButton();
}

// ── Message rendering ─────────────────────────────────────────────────────────

function scrollToBottom() {
  if (S.autoScroll) chatArea.scrollTop = chatArea.scrollHeight;
}

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

  var body = document.createElement('div');
  body.className = 'msg-body';

  var b = document.createElement('div');
  b.className = 'msg-bubble sys-msg-bubble';
  b.textContent = humanizeError(text);

  var dismiss = document.createElement('button');
  dismiss.className = 'sys-msg-dismiss';
  dismiss.title     = 'Dismiss';
  dismiss.innerHTML = '&#10005;';
  dismiss.addEventListener('click', function () { w.remove(); });

  b.appendChild(dismiss);
  body.appendChild(b);
  w.appendChild(body);
  messagesEl.appendChild(w);
  scrollToBottom();
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
  if (!S.activeSession || !S.activeSession.messages.length) { showEmptyState(); updateCtxBar(); return; }
  S.activeSession.messages.forEach(function (msg, i) {
    messagesEl.appendChild(buildMessageEl(msg, i));
  });
  // Add regen button to last assistant message
  updateRegenButton();
  updateCtxBar();
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

// ── Compare mode ─────────────────────────────────────────────────────────────

function toggleCompare() {
  S.compareMode = !S.compareMode;
  dbg('INFO', 'compare mode toggled', { enabled: S.compareMode });
  btnCompare.classList.toggle('active', S.compareMode);
  modelSelectB.classList.toggle('hidden', !S.compareMode);
  messagesEl.className = S.compareMode ? 'messages compare-layout' : 'messages';
  if (!S.compareMode) {
    renderAllMessages();
  }
}

function buildCompareColumn(modelName) {
  var el     = document.createElement('div');
  el.className = 'compare-col';
  var header = document.createElement('div');
  header.className = 'compare-col-header';
  header.textContent = modelName;
  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble streaming';
  el.appendChild(header);
  el.appendChild(bubble);
  return { el: el, bubble: bubble, text: '' };
}

function fireCompareStream(model, msgs, col, requestId, onDone) {
  dbg('STREAM', 'compare stream started', { model: model, requestId: requestId });
  chrome.runtime.sendMessage({
    action:    'OLLAMA_FETCH',
    requestId: requestId,
    url:       S.settings.url + '/api/chat',
    headers:   getHeaders(),
    body:      JSON.stringify({ model: model, messages: msgs, stream: true, options: getModelOptions() })
  });
  var listener = function (msg) {
    if (msg.requestId !== requestId) return;
    if (msg.action === 'STREAM_CHUNK') {
      col.text += msg.text;
      col.bubble.innerHTML = renderMarkdown(col.text);
      scrollToBottom();
    }
    if (msg.action === 'STREAM_DONE') {
      dbg('STREAM', 'compare stream complete', { model: model, requestId: requestId, chars: col.text.length });
      col.bubble.classList.remove('streaming');
      chrome.runtime.onMessage.removeListener(listener);
      if (onDone) onDone();
    }
    if (msg.action === 'STREAM_ERROR') {
      dbg('ERROR', 'compare stream failed', { model: model, requestId: requestId, error: msg.error });
      col.bubble.classList.remove('streaming');
      col.bubble.textContent = humanizeError(msg.error || 'Stream error');
      chrome.runtime.onMessage.removeListener(listener);
      if (onDone) onDone();
    }
  };
  chrome.runtime.onMessage.addListener(listener);
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function generateSessionTitle(firstUserMessage) {
  if (!S.activeSession || S.activeSession.name !== 'New Chat') return;
  var sessionId = S.activeSession.id;
  var chatModel = S.activeSession.model;
  chrome.storage.local.get('ollamaSidebarTitleModel', function (r) {
    var titleModel = r.ollamaSidebarTitleModel || chatModel;
    if (!titleModel) return;
    chrome.runtime.sendMessage({
      action:  'OLLAMA_FETCH_JSON',
      url:     S.settings.url + '/api/chat',
      headers: getHeaders(),
      body:    JSON.stringify({
        model:    titleModel,
        messages: [{ role: 'user', content: 'Summarize this in 4 words or less, just the title, no punctuation: ' + firstUserMessage }],
        stream:   false
      })
    }, function (response) {
      if (!response || !response.ok) return;
      var title = ((response.data && response.data.message && response.data.message.content) || '').trim();
      if (!title) return;
      title = title.slice(0, 80);
      if (!S.activeSession || S.activeSession.id !== sessionId || S.activeSession.name !== 'New Chat') return;
      S.activeSession.name = title;
      saveSession(S.activeSession);
      sessionNameEl.textContent = title;
      updateSessionsPanel();
    });
  });
}

function buildApiMessages() {
  var out = [];
  if (S.activeSession && S.activeSession.systemPrompt) {
    out.push({ role: 'system', content: S.activeSession.systemPrompt });
  }
  if (S.language && out.length && out[0].role === 'system') {
    out[0].content += '\n\nAlways respond in ' + S.language + '.';
    dbg('INFO', 'language lock applied', { language: S.language });
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

  var model = (S.activeSession && S.activeSession.model) || '';
  if (!model) { appendSystemMsg('No model selected — open Settings to choose a default model.'); return; }
  S.activeSession.model = model;

  var imageAttachments = S.attachments.filter(function (a) { return a.type === 'image'; });

  // Lock UI immediately
  removeEmptyState();
  inputMessage.value = '';
  inputMessage.style.height = '';
  setSendEnabled(false);
  S.isStreaming = true;

  var _t0 = Date.now();
  dbg('INFO', 'doSendChat step', { step: 'start', usePageContext: S.usePageContext, attachments: S.attachments.length, embedModel: !!S.embedModel });

  // ── Compare mode: render user bubble now, fire streams after context resolves ─
  if (S.compareMode) {
    var modelA = S.activeSession.model;
    var modelB = modelSelectB.value;
    if (!modelA || !modelB) {
      if (!modelB) dbg('ERROR', 'compare aborted — second model not selected');
      appendSystemMsg('Select two models to compare.');
      S.isStreaming = false;
      setSendEnabled(true);
      return;
    }

    // Render user prompt immediately (display-only, not stored)
    var uDisplay = document.createElement('div');
    uDisplay.className = 'message user';
    var uBody = document.createElement('div'); uBody.className = 'msg-body';
    var uBubble = document.createElement('div'); uBubble.className = 'msg-bubble';
    uBubble.textContent = text;
    uBody.appendChild(uBubble); uDisplay.appendChild(uBody);
    messagesEl.appendChild(uDisplay);

    var row = document.createElement('div');
    row.className = 'compare-row';
    var colA = buildCompareColumn(modelA);
    var colB = buildCompareColumn(modelB);
    row.appendChild(colA.el);
    row.appendChild(colB.el);
    messagesEl.appendChild(row);
    scrollToBottom();
    appendSystemMsg('Compare results are not saved to conversation history.');

    buildContextBlock(text, function (ctx) {
      dbg('INFO', 'doSendChat step', { step: 'context-resolved', ms: Date.now() - _t0, hasCtx: !!ctx });
      var apiContent = ctx ? ctx.text + '\n\n' + text : text;
      var compareMsgs = [];
      if (S.activeSession.systemPrompt) compareMsgs.push({ role: 'system', content: S.activeSession.systemPrompt });
      var cUserMsg = { role: 'user', content: apiContent };
      if (imageAttachments.length) cUserMsg.images = imageAttachments.map(function (a) { return a.content; });
      compareMsgs.push(cUserMsg);
      dbg('INFO', 'compare send initiated', { modelA: modelA, modelB: modelB, msgCount: compareMsgs.length });
      dbg('INFO', 'doSendChat step', { step: 'before-fetch', ms: Date.now() - _t0 });

      var cPending = 2;
      function onCompareDone() {
        if (--cPending === 0) {
          S.isStreaming = false;
          setSendEnabled(true);
          inputMessage.focus();
        }
      }
      fireCompareStream(modelA, compareMsgs, colA, genId(), onCompareDone);
      fireCompareStream(modelB, compareMsgs, colB, genId(), onCompareDone);
    });
    return;
  }

  // ── Normal mode: render user message + assistant bubble immediately ───────────
  var userMsg = { id: genId(), role: 'user', content: text, ts: Date.now() };
  S.activeSession.messages.push(userMsg);
  var userIdx = S.activeSession.messages.length - 1;
  messagesEl.appendChild(buildMessageEl(userMsg, userIdx));
  scrollToBottom();

  // Assistant bubble — visible immediately while context/embedding resolves
  var asstIdx  = S.activeSession.messages.length; // will be pushed on DONE
  var asstMsgEl = document.createElement('div');
  asstMsgEl.className = 'message assistant';
  asstMsgEl.dataset.index = asstIdx;

  var roleEl = document.createElement('div');
  roleEl.className = 'msg-role'; roleEl.textContent = 'Assistant';

  var body = document.createElement('div');
  body.className = 'msg-body';

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
    sources:      null, // filled in once context resolves
    msgIndex:     asstIdx,
    msgEl:        asstMsgEl,
    bodyEl:       body
  };

  // Build context (may call embedding API) — API fetch fires when ready
  buildContextBlock(text, function (ctx) {
    dbg('INFO', 'doSendChat step', { step: 'context-resolved', ms: Date.now() - _t0, hasCtx: !!ctx });
    if (S.currentStream) S.currentStream.sources = ctx ? ctx.names : null;

    var apiContent = ctx ? ctx.text + '\n\n' + text : text;
    var apiMsgs = buildApiMessages();
    var lastMsg = { role: 'user', content: apiContent };
    if (imageAttachments.length) {
      dbg('OLLAMA', 'sending message with images', { imageCount: imageAttachments.length, model: S.activeSession.model });
      lastMsg.images = imageAttachments.map(function (a) { return a.content; });
    }
    apiMsgs[apiMsgs.length - 1] = lastMsg;

    dbg('OLLAMA', 'request', { action: 'OLLAMA_FETCH', url: S.settings.url + '/api/chat', model: model, msFromStart: Date.now() - _t0 });
    dbg('INFO', 'doSendChat step', { step: 'before-fetch', ms: Date.now() - _t0 });
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
    dbg('STREAM', msg.action, { requestId: msg.requestId, aborted: msg.aborted, error: msg.error });
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
        updateCtxBar();
        if (S.activeSession.messages.length === 2 && S.activeSession.name === 'New Chat') {
          generateSessionTitle(S.activeSession.messages[0].content);
        }
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

function armConfirm(btn, label, cb) {
  var orig = btn.innerHTML;
  var origClass = btn.className;
  btn.innerHTML = label || 'Sure?';
  btn.className = btn.className.replace('danger','') + ' danger';
  btn.style.opacity = '1';
  var t = setTimeout(function () { reset(); }, 2500);
  function reset() {
    clearTimeout(t);
    btn.innerHTML = orig;
    btn.className = origClass;
    btn.style.opacity = '';
    btn.onclick = null;
  }
  btn.onclick = function (e) {
    e.stopPropagation();
    reset();
    cb();
  };
}

function toggleHelp() {
  helpOverlay.classList.toggle('hidden');
  dbg('CLICK', 'help overlay toggled', { open: !helpOverlay.classList.contains('hidden') });
}

function initEventHandlers() {

  // Status dot stats panel
  var statsPanel = document.getElementById('stats-panel');
  statusDot.style.cursor = 'pointer';
  statusDot.addEventListener('click', function(e) {
    e.stopPropagation();
    if (!statsPanel.classList.contains('hidden')) {
      statsPanel.classList.add('hidden'); return;
    }
    statsPanel.innerHTML = '<div style="color:var(--fg3)">Loading…</div>';
    statsPanel.classList.remove('hidden');
    var base = S.settings.url;
    var hdrs = getHeaders();
    var done = 0;
    var ps, ver;
    function tryRender() {
      if (++done < 2) return;
      var lines = [];
      if (ver) lines.push('<div class="stats-line"><span>Version</span><span class="stats-val">' + escapeHtml(ver) + '</span></div>');
      if (ps && ps.models && ps.models.length) {
        ps.models.forEach(function(m) {
          lines.push('<div class="stats-line"><span>' + escapeHtml(m.name) + '</span><span class="stats-val">loaded</span></div>');
        });
      } else {
        lines.push('<div class="stats-line"><span>No models loaded</span></div>');
      }
      statsPanel.innerHTML = lines.join('');
    }
    chrome.runtime.sendMessage({ action: 'OLLAMA_GET', url: base + '/api/version', headers: hdrs }, function(r) {
      if (r && r.ok && r.data) ver = r.data.version;
      tryRender();
    });
    chrome.runtime.sendMessage({ action: 'OLLAMA_GET', url: base + '/api/ps', headers: hdrs }, function(r) {
      if (r && r.ok && r.data) ps = r.data;
      tryRender();
    });
  });
  document.addEventListener('click', function() { statsPanel.classList.add('hidden'); });

  // Header
  btnSettings.addEventListener('click', function () {
    dbg('CLICK', 'btn-settings');
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  });

  btnSessions.addEventListener('click', function () {
    dbg('CLICK', 'btn-sessions');
    var wasOpen = !sessionsPanel.classList.contains('hidden');
    closePanels();
    if (!wasOpen) {
      updateSessionsPanel();
      sessionsPanel.classList.remove('hidden');
      btnSessions.classList.add('active');
    }
  });

  document.getElementById('btn-help').addEventListener('click', toggleHelp);
  document.getElementById('btn-help-close').addEventListener('click', function () {
    helpOverlay.classList.add('hidden');
  });
  helpOverlay.addEventListener('click', function (e) {
    if (e.target === helpOverlay) helpOverlay.classList.add('hidden');
  });

  chatArea.addEventListener('scroll', function () {
    var atBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 40;
    if (atBottom && !S.autoScroll) {
      S.autoScroll = true;
      dbg('INFO', 'auto-scroll re-enabled — user scrolled to bottom');
    }
  });

  chatArea.addEventListener('wheel', function (e) {
    if (e.deltaY < 0 && S.isStreaming) {
      S.autoScroll = false;
      dbg('INFO', 'auto-scroll disabled — user scrolled up during stream');
    }
  });

  var btnCompact = document.getElementById('btn-compact');
  btnCompact.classList.toggle('active', S.compact);
  btnCompact.addEventListener('click', function () {
    applyCompact(!S.compact);
    btnCompact.classList.toggle('active', S.compact);
  });

  modelSelect.addEventListener('change', function() {
    dbg('MODEL', 'model changed', { model: this.value });
    if (!S.activeSession) return;
    S.activeSession.model = this.value;
    debouncedSaveSession();
  });

  // Sessions panel
  btnNewSession.addEventListener('click', function () {
    dbg('CLICK', 'btn-new-session');
    newSession();
  });

  sessionSearch.addEventListener('input', function () {
    filterSessions(this.value);
  });

  sessionsList.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.dataset.id;
    if (btn.dataset.action === 'rename') renameSession(id);
    if (btn.dataset.action === 'delete') {
      armConfirm(btn, '✕?', function () { deleteSession(id); });
    }
  });

  // Session bar
  btnExportSession.addEventListener('click', function () {
    dbg('CLICK', 'btn-export-session');
    exportSession(S.activeSession);
  });
  btnExportClose.addEventListener('click', function () {
    exportOverlay.classList.add('hidden');
  });
  exportOverlay.addEventListener('click', function (e) {
    if (e.target === exportOverlay) exportOverlay.classList.add('hidden');
  });
  btnExportCopy.addEventListener('click', function () {
    navigator.clipboard.writeText(exportContent.textContent).then(function () {
      btnExportCopy.textContent = 'Copied ✓';
      setTimeout(function () { btnExportCopy.textContent = 'Copy'; }, 1800);
    }).catch(function () {
      exportContent.select && exportContent.select();
    });
  });
  btnDeleteSession.addEventListener('click', function () {
    dbg('CLICK', 'btn-delete-session');
    if (!S.activeSession) return;
    armConfirm(btnDeleteSession, '✕ Sure?', function () {
      deleteSession(S.activeSession.id);
    });
  });
  sessionNameEl.addEventListener('dblclick', function () {
    if (S.activeSession) renameSession(S.activeSession.id);
  });

  // File chips (delegation)
  fileChipsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.file-chip-del');
    if (!btn) return;
    var idx = parseInt(btn.dataset.idx);
    removeAttachment(idx);
  });

  // Drag and drop — full-app drop target with overlay
  var dragOverlay = document.getElementById('drag-overlay');
  var dragCounter = 0;

  app.addEventListener('dragenter', function (e) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter++;
    dbg('FILE', 'drag enter', { counter: dragCounter });
    dragOverlay.classList.remove('hidden');
  });

  app.addEventListener('dragleave', function (e) {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dragOverlay.classList.add('hidden');
    }
  });

  app.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  app.addEventListener('drop', function (e) {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.add('hidden');
    var files = Array.from(e.dataTransfer.files);
    dbg('FILE', 'files dropped', { count: files.length, names: files.map(function(f){ return f.name; }) });
    var images = files.filter(function (f) { return f.type.startsWith('image/'); });
    var docs   = files.filter(function (f) { return !f.type.startsWith('image/'); });
    if (images.length && docs.length) {
      dbg('FILE', 'mixed drop — images and documents', { images: images.length, docs: docs.length });
    }
    if (images.length) handleImages(images);
    if (docs.length)   handleFiles(docs);
  });

  document.getElementById('btn-attach-file').addEventListener('click', function () {
    dbg('FILE', 'attach button clicked', {
      showOpenFilePicker: typeof window.showOpenFilePicker !== 'undefined'
    });

    if (typeof window.showOpenFilePicker !== 'undefined') {
      // Chrome path — native file picker
      window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Text & data files',
            accept: {
              'text/plain':       ['.txt', '.md'],
              'text/csv':         ['.csv'],
              'application/pdf':  ['.pdf']
            }
          },
          {
            description: 'Images',
            accept: {
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/png':  ['.png'],
              'image/webp': ['.webp'],
              'image/gif':  ['.gif']
            }
          }
        ]
      }).then(function (handles) {
        dbg('FILE', 'showOpenFilePicker returned', { count: handles.length });
        return Promise.all(handles.map(function (h) { return h.getFile(); }));
      }).then(function (files) {
        var images = files.filter(function (f) { return f.type.startsWith('image/'); });
        var docs   = files.filter(function (f) { return !f.type.startsWith('image/'); });
        if (images.length) handleImages(images);
        if (docs.length)   handleFiles(docs);
      }).catch(function (e) {
        if (e.name !== 'AbortError') {
          dbg('ERROR', 'showOpenFilePicker failed', { error: e.message });
          appendSystemMsg('Could not open file picker: ' + e.message);
        } else {
          dbg('FILE', 'file picker cancelled by user');
        }
      });

    } else {
      // Orion path — picker not available, remind user to drag and drop
      dbg('FILE', 'attach button clicked — showOpenFilePicker unavailable, drag and drop required');
      appendSystemMsg('File picker unavailable in this browser. Drag and drop files directly onto the chat.');
    }
  });

  // Page context
  btnPageContext.addEventListener('click', function () {
    dbg('CLICK', 'btn-page-context');
    togglePageContext();
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
    dbg('CLICK', 'btn-templates-open');
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
    S.templates = S.templates.filter(function (t) { return t.id !== id || t.builtin; });
    saveTemplates();
    renderTmplOverlay();
  });

  // Compare toggle
  btnCompare.addEventListener('click', function () {
    dbg('CLICK', 'btn-compare');
    toggleCompare();
  });

  modelSelectB.addEventListener('change', function () {
    dbg('MODEL', 'model-select-b changed', { model: this.value });
  });

  // Persona button
  document.getElementById('btn-persona').addEventListener('click', function () {
    dbg('CLICK', 'btn-persona');
    renderPersonaOverlay();
    personaOverlay.classList.remove('hidden');
  });

  // Persona overlay
  btnPersonaOverlayClose.addEventListener('click', function () {
    personaOverlay.classList.add('hidden');
  });
  personaOverlay.addEventListener('click', function (e) {
    if (e.target === personaOverlay) personaOverlay.classList.add('hidden');
  });
  btnPersonaAdd.addEventListener('click', function () {
    var name   = personaNewName.value.trim();
    var prompt = personaNewPrompt.value.trim();
    if (!name || !prompt) return;
    S.personas.push({ id: genId(), name: name, prompt: prompt });
    savePersonas();
    personaNewName.value = ''; personaNewPrompt.value = '';
    renderPersonaOverlay();
  });

  // Send (also acts as stop during streaming via onclick set in setSendEnabled)
  btnSend.addEventListener('click', function () {
    if (S.isStreaming) return; // handled by the onclick set in setSendEnabled
    dbg('CLICK', 'btn-send');
    sendChat();
  });

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

  document.addEventListener('keydown', function(e) {
    var tag = document.activeElement && document.activeElement.tagName;
    var inField = (tag === 'TEXTAREA' || tag === 'INPUT');

    if (e.key === 'Escape') {
      templateDropdown.classList.add('hidden');
      tmplOverlay.classList.add('hidden');
      personaOverlay.classList.add('hidden');
      exportOverlay.classList.add('hidden');
      helpOverlay.classList.add('hidden');
      closePanels();
      return;
    }
    if (inField) return;

    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      newSession();
    }
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      if (S.isStreaming) return;
      if (_ctrlLPending) {
        clearTimeout(_ctrlLTimer);
        _ctrlLPending = false;
        var toast = document.getElementById('ctrl-l-toast');
        if (toast) toast.remove();
        if (S.activeSession) { S.activeSession.messages = []; saveSession(S.activeSession); }
        renderAllMessages();
        dbg('CLICK', 'Ctrl+L clear confirmed');
      } else {
        _ctrlLPending = true;
        dbg('CLICK', 'Ctrl+L clear — awaiting confirmation');
        var t = document.createElement('div');
        t.id = 'ctrl-l-toast';
        t.className = 'ctrlL-toast';
        t.textContent = 'Press Ctrl+L again to clear conversation';
        var dismiss = document.createElement('button');
        dismiss.className = 'sys-msg-dismiss';
        dismiss.innerHTML = '&#10005;';
        dismiss.addEventListener('click', function () {
          clearTimeout(_ctrlLTimer);
          _ctrlLPending = false;
          t.remove();
        });
        t.appendChild(dismiss);
        messagesEl.appendChild(t);
        scrollToBottom();
        _ctrlLTimer = setTimeout(function () {
          _ctrlLPending = false;
          if (t.parentNode) t.remove();
        }, 3000);
      }
    }
    if (e.ctrlKey && e.key === '/') {
      e.preventDefault();
      renderTmplOverlay();
      tmplOverlay.classList.remove('hidden');
    }
    if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    }
    if (e.ctrlKey && e.key === '?') {
      e.preventDefault();
      toggleHelp();
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadAllData(async function () {
  dbg('INFO', 'sidepanel init', {
    browser:    navigator.userAgent,
    url:        S.settings.url,
    theme:      S.theme,
    sessions:   S.sessions.length,
    showOpenFilePicker: typeof window.showOpenFilePicker !== 'undefined'
  });
  renderSession();
  initEventHandlers();
  var ok = await fetchModels();
  if (ok) populateModels();
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  var reconnect = false;
  if (changes.ollamaSidebarUrl)   { S.settings.url   = changes.ollamaSidebarUrl.newValue   || 'http://localhost:11434'; reconnect = true; }
  if (changes.ollamaSidebarToken) { S.settings.token  = changes.ollamaSidebarToken.newValue || ''; reconnect = true; }
  if (changes.ollamaSidebarTheme) applyTheme(changes.ollamaSidebarTheme.newValue || 'dark');
  if (changes.ollamaSidebarParams) S.storedParams = changes.ollamaSidebarParams.newValue || {};
  if (changes.ollamaSidebarDefaultModel) { S.defaultModel = changes.ollamaSidebarDefaultModel.newValue || ''; }
  if (changes.ollamaSidebarSystemPrompt) { S.defaultSystemPrompt = changes.ollamaSidebarSystemPrompt.newValue || ''; }
  if (changes.ollamaSidebarLanguage) {
    S.language = changes.ollamaSidebarLanguage.newValue || '';
    dbg('INFO', 'language lock updated', { language: S.language });
  }
  if (changes.ollamaSidebarEmbedModel) S.embedModel = changes.ollamaSidebarEmbedModel.newValue || '';
  if (changes.ollamaSidebarAutoScroll !== undefined) S.autoScroll = changes.ollamaSidebarAutoScroll.newValue !== false;
  if (changes.ollamaSidebarCompact) {
    applyCompact(changes.ollamaSidebarCompact.newValue || false);
    var btnCompact = document.getElementById('btn-compact');
    if (btnCompact) btnCompact.classList.toggle('active', S.compact);
  }
  if (reconnect) fetchModels().then(function (ok) { if (ok) populateModels(); });
});

})();
