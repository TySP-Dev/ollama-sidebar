// ── Side panel ───────────────────────────────────────────────────────────────

if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel && tab.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

// ── Active stream registry (for cancellation) ────────────────────────────────

const activeStreams = new Map(); // requestId → AbortController

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OLLAMA_GET') {
    handleGet(message, sendResponse);
    return true;
  }
  if (message.action === 'OLLAMA_FETCH') {
    handleStream(message);
    sendResponse({ started: true });
    return false;
  }
  if (message.action === 'CANCEL_STREAM') {
    const ctrl = activeStreams.get(message.requestId);
    if (ctrl) { ctrl.abort(); activeStreams.delete(message.requestId); }
    sendResponse({ ok: true });
    return false;
  }
  if (message.action === 'GET_PAGE_CONTENT') {
    handleGetPageContent(message.tabId, sendResponse);
    return true;
  }
  if (message.action === 'OLLAMA_FETCH_JSON') {
    handleFetchJson(message, sendResponse);
    return true;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Page content relay ────────────────────────────────────────────────────────

function handleGetPageContent(tabId, sendResponse) {
  chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTENT' }, (response) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
      return;
    }
    sendResponse(response || { error: 'Content script did not respond' });
  });
}

// ── Non-streaming JSON POST ───────────────────────────────────────────────────

async function handleFetchJson(message, sendResponse) {
  try {
    const res = await fetch(message.url, {
      method: 'POST',
      headers: message.headers || {},
      body: message.body
    });
    if (!res.ok) { sendResponse({ ok: false, error: 'HTTP ' + res.status }); return; }
    const data = await res.json();
    sendResponse({ ok: true, data });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

// ── Non-streaming GET ─────────────────────────────────────────────────────────

async function handleGet(message, sendResponse) {
  try {
    const res = await fetch(message.url, { method: 'GET', headers: message.headers || {} });
    if (!res.ok) { sendResponse({ ok: false, status: res.status, error: 'HTTP ' + res.status }); return; }
    const data = await res.json();
    sendResponse({ ok: true, data });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

// ── Streaming POST ────────────────────────────────────────────────────────────
// Requests go through the background service worker so they carry no page
// Origin header — avoiding 403s from reverse proxies that block extension origins.

async function handleStream(message) {
  const { url, headers, body, requestId } = message;
  const controller = new AbortController();
  activeStreams.set(requestId, controller);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers || {},
      body,
      signal: controller.signal
    });

    if (!res.ok) {
      let errBody = '';
      try { errBody = await res.text(); } catch (_) {}
      broadcast({ action: 'STREAM_ERROR', requestId,
        error: 'HTTP ' + res.status + (errBody ? ': ' + errBody.slice(0, 200) : '') });
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk;
        try { chunk = JSON.parse(trimmed); } catch (_) { continue; }

        if (chunk.error) {
          broadcast({ action: 'STREAM_ERROR', requestId, error: chunk.error });
          return;
        }

        if (chunk.message) {
          if (chunk.message.thinking) {
            broadcast({ action: 'STREAM_THINKING', requestId, text: chunk.message.thinking });
          }
          if (chunk.message.content) {
            broadcast({ action: 'STREAM_CHUNK', requestId, text: chunk.message.content });
          }
        }

        if (chunk.done) {
          if (chunk.eval_count || chunk.total_duration) {
            broadcast({
              action: 'STREAM_METRICS', requestId,
              metrics: {
                eval_count:        chunk.eval_count        || 0,
                eval_duration:     chunk.eval_duration     || 0,
                prompt_eval_count: chunk.prompt_eval_count || 0,
                total_duration:    chunk.total_duration    || 0
              }
            });
          }
          broadcast({ action: 'STREAM_DONE', requestId });
          return;
        }
      }
    }

    // Drain remaining buffer
    if (buf.trim()) {
      try {
        const last = JSON.parse(buf.trim());
        if (last.message && last.message.content) {
          broadcast({ action: 'STREAM_CHUNK', requestId, text: last.message.content });
        }
        if (last.error) { broadcast({ action: 'STREAM_ERROR', requestId, error: last.error }); return; }
        if (last.done && (last.eval_count || last.total_duration)) {
          broadcast({ action: 'STREAM_METRICS', requestId,
            metrics: { eval_count: last.eval_count || 0, eval_duration: last.eval_duration || 0,
              prompt_eval_count: last.prompt_eval_count || 0, total_duration: last.total_duration || 0 } });
        }
      } catch (_) {}
    }

    broadcast({ action: 'STREAM_DONE', requestId });

  } catch (e) {
    if (e.name === 'AbortError') {
      broadcast({ action: 'STREAM_DONE', requestId, aborted: true });
    } else {
      broadcast({ action: 'STREAM_ERROR', requestId, error: e.message });
    }
  } finally {
    activeStreams.delete(requestId);
  }
}
