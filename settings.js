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

var PARAM_META = [
  { key: 'temperature',    label: 'Temperature',       min: 0,    max: 2,      step: 0.05 },
  { key: 'top_p',          label: 'Top-P',             min: 0,    max: 1,      step: 0.05 },
  { key: 'top_k',          label: 'Top-K',             min: 1,    max: 200,    step: 1    },
  { key: 'repeat_penalty', label: 'Repeat Penalty',    min: 0.5,  max: 2,      step: 0.05 },
  { key: 'seed',           label: 'Seed (-1 = rand)',  min: -1,   max: 999999, step: 1    },
  { key: 'num_ctx',        label: 'Context (tokens)',  min: 512,  max: 131072, step: 512  },
  { key: 'num_predict',    label: 'Max Tokens (-1=∞)', min: -1,   max: 8192,   step: 1    }
];

var DEFAULT_SYSTEM_PROMPT =
  'Be concise and detailed. Give the most information in the fewest words unless the topic requires a longer explanation.';

// ── DOM refs ──────────────────────────────────────────────────────────────────

var app               = document.getElementById('app');
var inputUrl          = document.getElementById('input-url');
var inputToken        = document.getElementById('input-token');
var btnShowToken      = document.getElementById('btn-show-token');
var btnTest           = document.getElementById('btn-test');
var testStatus        = document.getElementById('test-status');
var selectTitleModel  = document.getElementById('select-title-model');
var selectDefaultModel = document.getElementById('select-default-model');
var selectEmbedModel  = document.getElementById('select-embed-model');
var inputSystemPrompt = document.getElementById('input-system-prompt');
var inputLanguage     = document.getElementById('input-language');
var paramsGrid        = document.getElementById('params-grid');
var btnThemeDark      = document.getElementById('btn-theme-dark');
var btnThemeLight     = document.getElementById('btn-theme-light');
var btnAutoscrollOn   = document.getElementById('btn-autoscroll-on');
var btnAutoscrollOff  = document.getElementById('btn-autoscroll-off');
var btnCompactOn      = document.getElementById('btn-compact-on');
var btnCompactOff     = document.getElementById('btn-compact-off');
var btnSave           = document.getElementById('btn-save');
var saveStatus        = document.getElementById('save-status');

// ── State ─────────────────────────────────────────────────────────────────────

var S = { theme: 'dark', autoScroll: true, compact: false, models: [] };

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return b + ' B';
}

function getHeaders() {
  var h = { 'Content-Type': 'application/json' };
  var tok = inputToken.value.trim();
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  return h;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function setTheme(t) {
  S.theme = t;
  app.setAttribute('data-theme', t);
  btnThemeDark.classList.toggle('active', t === 'dark');
  btnThemeLight.classList.toggle('active', t === 'light');
}

function setAutoScroll(on) {
  S.autoScroll = on;
  btnAutoscrollOn.classList.toggle('active', on);
  btnAutoscrollOff.classList.toggle('active', !on);
}

function setCompact(on) {
  S.compact = on;
  btnCompactOn.classList.toggle('active',  on);
  btnCompactOff.classList.toggle('active', !on);
}

// ── Model dropdowns ───────────────────────────────────────────────────────────

function populateModelSelects(models) {
  S.models = models;
  var titleVal   = selectTitleModel.value;
  var defaultVal = selectDefaultModel.value;
  var embedVal   = selectEmbedModel.value;

  [selectTitleModel, selectDefaultModel].forEach(function (sel) {
    sel.innerHTML = '<option value="">— select model —</option>';
    models.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.name;
      var lbl = m.name;
      if (m.paramSize) lbl += ' (' + m.paramSize + ')';
      if (m.sizeLabel) lbl += ' · ' + m.sizeLabel;
      opt.textContent = lbl;
      sel.appendChild(opt);
    });
  });

  selectEmbedModel.innerHTML = '<option value="">— disable semantic RAG —</option>';
  models.forEach(function (m) {
    var opt = document.createElement('option');
    opt.value = m.name;
    var lbl = m.name;
    if (m.paramSize) lbl += ' (' + m.paramSize + ')';
    if (m.sizeLabel) lbl += ' · ' + m.sizeLabel;
    opt.textContent = lbl;
    selectEmbedModel.appendChild(opt);
  });

  selectTitleModel.value   = titleVal;
  selectDefaultModel.value = defaultVal;
  selectEmbedModel.value   = embedVal;
}

// ── Params grid ───────────────────────────────────────────────────────────────

function buildParamsGrid(stored) {
  paramsGrid.innerHTML = '';
  PARAM_META.forEach(function (pm) {
    var val = (stored[pm.key] !== undefined) ? stored[pm.key] : DEF_PARAMS[pm.key];

    var label = document.createElement('label');
    label.className = 'param-label';
    label.htmlFor   = 'param-' + pm.key;
    label.textContent = pm.label;

    var input = document.createElement('input');
    input.type      = 'number';
    input.id        = 'param-' + pm.key;
    input.className = 'param-input';
    input.value     = val;
    input.min       = pm.min;
    input.max       = pm.max;
    input.step      = pm.step;

    var valDisplay = document.createElement('span');
    valDisplay.className  = 'param-val';
    valDisplay.textContent = val;

    input.addEventListener('input', function () {
      valDisplay.textContent = this.value;
    });

    paramsGrid.appendChild(label);
    paramsGrid.appendChild(input);
    paramsGrid.appendChild(valDisplay);
  });
}

function getParamsFromGrid() {
  var result = {};
  PARAM_META.forEach(function (pm) {
    var inp = document.getElementById('param-' + pm.key);
    if (inp) result[pm.key] = parseFloat(inp.value);
  });
  return result;
}

// ── Network ───────────────────────────────────────────────────────────────────

function fetchModels(cb) {
  var baseUrl = inputUrl.value.trim().replace(/\/+$/, '') || 'http://localhost:11434';
  chrome.runtime.sendMessage(
    { action: 'OLLAMA_GET', url: baseUrl + '/api/tags', headers: getHeaders() },
    function (response) {
      if (chrome.runtime.lastError || !response || !response.ok) {
        if (cb) cb([]);
        return;
      }
      var models = (response.data.models || []).map(function (m) {
        return {
          name:      m.name,
          paramSize: (m.details && m.details.parameter_size) || '',
          sizeLabel: m.size ? formatBytes(m.size) : ''
        };
      });
      populateModelSelects(models);
      if (cb) cb(models);
    }
  );
}

// ── Pull model ────────────────────────────────────────────────────────────────

function pullModel(name) {
  if (!name) return;
  var progressEl = document.getElementById('pull-progress');
  progressEl.classList.remove('hidden');
  progressEl.textContent = 'Starting pull…';

  var baseUrl = inputUrl.value.trim().replace(/\/+$/, '') || 'http://localhost:11434';
  var requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var lastPullStatus = '';

  chrome.runtime.sendMessage({
    action:    'OLLAMA_FETCH',
    url:       baseUrl + '/api/pull',
    headers:   getHeaders(),
    body:      JSON.stringify({ name: name, stream: true }),
    requestId: requestId
  });

  var pullListener = function (msg) {
    if (msg.requestId !== requestId) return;
    if (msg.action === 'STREAM_CHUNK' && msg.text) {
      try {
        var parsed    = JSON.parse(msg.text);
        var status    = parsed.status    || '';
        var completed = parsed.completed || 0;
        var total     = parsed.total     || 0;
        var pct = total > 0 ? ' (' + Math.round(completed / total * 100) + '%)' : '';
        progressEl.textContent = status + pct;
        lastPullStatus = status || lastPullStatus;
      } catch (_) {}
    }
    if (msg.action === 'STREAM_DONE') {
      chrome.runtime.onMessage.removeListener(pullListener);
      progressEl.textContent = 'Pull complete — ' + name;
      setTimeout(function () { progressEl.classList.add('hidden'); }, 2000);
      fetchModels();
    }
    if (msg.action === 'STREAM_ERROR') {
      chrome.runtime.onMessage.removeListener(pullListener);
      progressEl.textContent = 'Error: ' + (msg.error || 'pull failed');
    }
  };
  chrome.runtime.onMessage.addListener(pullListener);
}

// ── Save ──────────────────────────────────────────────────────────────────────

function showSaved() {
  saveStatus.classList.remove('hidden');
  setTimeout(function () { saveStatus.classList.add('hidden'); }, 2000);
}

// ── Load ──────────────────────────────────────────────────────────────────────

function loadSettings() {
  chrome.storage.local.get([
    'ollamaSidebarUrl', 'ollamaSidebarToken',
    'ollamaSidebarTitleModel', 'ollamaSidebarDefaultModel',
    'ollamaSidebarEmbedModel',
    'ollamaSidebarSystemPrompt', 'ollamaSidebarTheme',
    'ollamaSidebarParams', 'ollamaSidebarLanguage',
    'ollamaSidebarAutoScroll', 'ollamaSidebarCompact'
  ], function (r) {
    inputUrl.value          = r.ollamaSidebarUrl   || 'http://localhost:11434';
    inputToken.value        = r.ollamaSidebarToken  || '';
    inputSystemPrompt.value = r.ollamaSidebarSystemPrompt || DEFAULT_SYSTEM_PROMPT;
    inputLanguage.value     = r.ollamaSidebarLanguage || '';
    setTheme(r.ollamaSidebarTheme || 'dark');
    setAutoScroll(r.ollamaSidebarAutoScroll !== false);
    setCompact(r.ollamaSidebarCompact || false);
    buildParamsGrid(r.ollamaSidebarParams || {});

    fetchModels(function () {
      selectTitleModel.value   = r.ollamaSidebarTitleModel   || '';
      selectDefaultModel.value = r.ollamaSidebarDefaultModel || '';
      selectEmbedModel.value   = r.ollamaSidebarEmbedModel   || '';
    });
  });
}

// ── Event handlers ────────────────────────────────────────────────────────────

btnShowToken.addEventListener('click', function () {
  inputToken.type = inputToken.type === 'password' ? 'text' : 'password';
});

btnTest.addEventListener('click', function () {
  var baseUrl = inputUrl.value.trim().replace(/\/+$/, '') || 'http://localhost:11434';
  testStatus.textContent = 'Testing…';
  testStatus.className   = 'status-text';
  chrome.runtime.sendMessage(
    { action: 'OLLAMA_GET', url: baseUrl + '/api/tags', headers: getHeaders() },
    function (response) {
      if (chrome.runtime.lastError || !response) {
        var e = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No response';
        testStatus.textContent = 'Failed (' + e + ')';
        testStatus.className   = 'status-text err';
        return;
      }
      if (!response.ok) {
        testStatus.textContent = 'Failed (' + (response.status || 'error') + ')';
        testStatus.className   = 'status-text err';
        return;
      }
      var models = (response.data.models || []).map(function (m) {
        return {
          name:      m.name,
          paramSize: (m.details && m.details.parameter_size) || '',
          sizeLabel: m.size ? formatBytes(m.size) : ''
        };
      });
      populateModelSelects(models);
      testStatus.textContent = 'Connected — ' + models.length + ' model(s)';
      testStatus.className   = 'status-text ok';
    }
  );
});

btnThemeDark.addEventListener('click',  function () { setTheme('dark'); });
btnThemeLight.addEventListener('click', function () { setTheme('light'); });

btnAutoscrollOn.addEventListener('click',  function () { setAutoScroll(true); });
btnAutoscrollOff.addEventListener('click', function () { setAutoScroll(false); });

btnCompactOn.addEventListener('click',  function () {
  setCompact(true);
  chrome.storage.local.set({ ollamaSidebarCompact: true });
});
btnCompactOff.addEventListener('click', function () {
  setCompact(false);
  chrome.storage.local.set({ ollamaSidebarCompact: false });
});

btnSave.addEventListener('click', function () {
  var url = inputUrl.value.trim().replace(/\/+$/, '') || 'http://localhost:11434';
  chrome.storage.local.set({
    ollamaSidebarUrl:          url,
    ollamaSidebarToken:        inputToken.value,
    ollamaSidebarTitleModel:   selectTitleModel.value,
    ollamaSidebarDefaultModel: selectDefaultModel.value,
    ollamaSidebarEmbedModel:   selectEmbedModel.value,
    ollamaSidebarSystemPrompt: inputSystemPrompt.value,
    ollamaSidebarLanguage:     inputLanguage.value.trim(),
    ollamaSidebarTheme:        S.theme,
    ollamaSidebarAutoScroll:   S.autoScroll,
    ollamaSidebarCompact:      S.compact,
    ollamaSidebarParams:       getParamsFromGrid()
  }, function () {
    showSaved();
    renderSysinfo();
  });
});

document.getElementById('btn-pull').addEventListener('click', function () {
  pullModel(document.getElementById('pull-model-input').value.trim());
});

document.getElementById('pull-model-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') pullModel(this.value.trim());
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadSettings();

// ── Debug panel ───────────────────────────────────────────────────────────────

var DBG_KEY        = 'ollama_debug_log';
var AUTOCLEAR_MS   = 30 * 60 * 1000;
var debugLog       = document.getElementById('debug-log');
var debugSysinfo   = document.getElementById('debug-sysinfo');
var debugCount     = document.getElementById('debug-log-count');
var debugAutoclear = document.getElementById('debug-autoclear');

var TYPE_COLORS = {
  CLICK:   '#7c3aed',
  FILE:    '#2563eb',
  OLLAMA:  '#059669',
  STREAM:  '#0891b2',
  PERSONA: '#db2777',
  MODEL:   '#d97706',
  ERROR:   '#dc2626',
  INFO:    '#6b7280',
  SESSION: '#7c3aed'
};

function renderSysinfo() {
  chrome.storage.local.get(['ollamaSidebarUrl', 'ollamaSidebarToken'], function (r) {
    var url = r.ollamaSidebarUrl || 'http://localhost:11434';
    var ua = navigator.userAgent;
    var browser = 'Unknown';
    if (/OPR\//.test(ua))     browser = 'Opera';
    else if (/Orion/.test(ua))  browser = 'Orion';
    else if (/Edg\//.test(ua))  browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';

    var supportsFilePicker = typeof window.showOpenFilePicker !== 'undefined';

    debugSysinfo.innerHTML =
      '<div class="debug-sys-grid">' +
        '<span class="debug-sys-label">Browser</span><span class="debug-sys-val">' + browser + '</span>' +
        '<span class="debug-sys-label">User Agent</span><span class="debug-sys-val debug-ua">' + ua + '</span>' +
        '<span class="debug-sys-label">Ollama URL</span><span class="debug-sys-val">' + url + '</span>' +
        '<span class="debug-sys-label">showOpenFilePicker</span><span class="debug-sys-val" style="color:' + (supportsFilePicker ? 'var(--ok)' : 'var(--err)') + '">' + (supportsFilePicker ? 'supported' : 'NOT supported') + '</span>' +
      '</div>';

    var tok = r.ollamaSidebarToken || '';
    var hdrs = { 'Content-Type': 'application/json' };
    if (tok) hdrs['Authorization'] = 'Bearer ' + tok;
    chrome.runtime.sendMessage({ action: 'OLLAMA_GET', url: url + '/api/tags', headers: hdrs }, function (res) {
      var statusEl = debugSysinfo.querySelector('.debug-connection') || document.createElement('div');
      statusEl.className = 'debug-connection';
      if (res && res.ok) {
        var modelNames = (res.data.models || []).map(function (m) { return m.name; }).join(', ');
        statusEl.innerHTML = '<span style="color:var(--ok)">● Connected</span> — ' +
          (res.data.models || []).length + ' model(s): ' + (modelNames || '(none)');
      } else {
        statusEl.innerHTML = '<span style="color:var(--err)">● Disconnected</span> — ' + (res ? res.error : 'no response');
      }
      if (!debugSysinfo.contains(statusEl)) debugSysinfo.appendChild(statusEl);
    });
  });
}

function updateAutoclearLabel(entries) {
  if (!debugAutoclear) return;
  if (!entries || !entries.length) {
    debugAutoclear.textContent = '';
    return;
  }

  var oldest = entries.reduce(function (min, e) {
    return e.ts < min ? e.ts : min;
  }, entries[0].ts);

  var expiresAt = oldest + AUTOCLEAR_MS;
  var remaining = expiresAt - Date.now();

  if (remaining <= 0) {
    debugAutoclear.textContent = 'Oldest entry clearing on next log write';
    debugAutoclear.style.color = 'var(--err)';
    return;
  }

  var totalSecs = Math.ceil(remaining / 1000);
  var mins      = Math.floor(totalSecs / 60);
  var secs      = totalSecs % 60;
  var label     = mins > 0
    ? 'Oldest clears in ' + mins + 'm ' + secs + 's'
    : 'Oldest clears in ' + secs + 's';

  debugAutoclear.textContent = label;
  debugAutoclear.style.color = mins < 5 ? 'var(--warn)' : 'var(--fg3)';
}

var _lastLogEntries = [];

function renderLog(entries) {
  _lastLogEntries = entries;
  debugCount.textContent = entries.length + ' entries';
  updateAutoclearLabel(entries);
  if (!entries.length) {
    debugLog.innerHTML = '<div style="padding:12px;color:var(--fg3);font-size:12px;">No log entries yet. Interact with the sidebar to generate logs.</div>';
    return;
  }
  var rows = entries.slice().reverse().map(function (e) {
    var color  = TYPE_COLORS[e.type] || '#6b7280';
    var time   = new Date(e.ts).toLocaleTimeString();
    var detail = e.detail ? '<div class="debug-detail">' + JSON.stringify(e.detail, null, 2) + '</div>' : '';
    return '<div class="debug-row">' +
      '<span class="debug-ts">' + time + '</span>' +
      '<span class="debug-badge" style="background:' + color + '">' + e.type + '</span>' +
      '<span class="debug-msg">' + e.msg + '</span>' +
      detail +
    '</div>';
  }).join('');
  debugLog.innerHTML = rows;
}

function loadLog() {
  chrome.storage.local.get(DBG_KEY, function (r) {
    renderLog(r[DBG_KEY] || []);
  });
}

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes[DBG_KEY]) {
    renderLog(changes[DBG_KEY].newValue || []);
  }
});

document.getElementById('btn-debug-clear').addEventListener('click', function () {
  chrome.storage.local.set({ [DBG_KEY]: [] }, loadLog);
});

document.getElementById('btn-debug-export').addEventListener('click', function () {
  chrome.storage.local.get(DBG_KEY, function (r) {
    var text = JSON.stringify(r[DBG_KEY] || [], null, 2);
    navigator.clipboard.writeText(text).then(function () {
      document.getElementById('btn-debug-export').textContent = 'Copied ✓';
      setTimeout(function () { document.getElementById('btn-debug-export').textContent = 'Copy Log'; }, 2000);
    });
  });
});

setInterval(function () {
  updateAutoclearLabel(_lastLogEntries);
}, 30000);

renderSysinfo();
loadLog();

})();
