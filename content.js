console.log('[Ollama Sidebar] content script loaded on', location.href);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'GET_PAGE_CONTENT') return;
  try {
    sendResponse(extractPage());
  } catch (e) {
    sendResponse({ title: document.title, url: location.href, content: '', wordCount: 0 });
  }
  return true;
});

function extractPage() {
  var meta = getMeta();

  // ── 1. Score candidate content roots ───────────────────────────────────────
  var candidates = Array.from(document.querySelectorAll(
    'article, [role="article"], main, [role="main"], ' +
    '.post-content, .entry-content, .article-body, .article__body, ' +
    '.story-body, .page-content, .content-body, #article, #content, #main, #post'
  ));

  Array.from(document.querySelectorAll('div, section')).forEach(function (el) {
    if (el.querySelector('article, main, [role="main"]')) return;
    var score = contentScore(el);
    if (score > 20) candidates.push(el);
  });

  var root = document.body;
  var best = 0;
  candidates.forEach(function (el) {
    var s = contentScore(el);
    if (s > best) { best = s; root = el; }
  });

  // ── 2. Clone and strip noise ────────────────────────────────────────────────
  var clone = root.cloneNode(true);
  var noise = [
    'script','style','noscript','iframe','canvas','template',
    'nav','header','footer','aside',
    '[role="navigation"]','[role="banner"]',
    '[role="complementary"]','[role="contentinfo"]','[role="dialog"]',
    '[aria-hidden="true"]','[hidden]',
    '[class*="cookie"]','[class*="popup"]','[class*="modal"]',
    '[class*="banner"]','[class*="sidebar"]','[class*="widget"]',
    '[class*="advert"]','[class*="sponsor"]','[class*="promo"]',
    '[class*="newsletter"]','[class*="subscribe"]',
    '[class*="share-bar"]','[class*="social"]',
    '[class*="related"]','[class*="recommend"]',
    '[class*="comment"]','[class*="reply"]',
    '[id*="cookie"]','[id*="popup"]','[id*="modal"]',
    '[id*="sidebar"]','[id*="comment"]'
  ].join(',');
  clone.querySelectorAll(noise).forEach(function (el) { el.remove(); });

  // ── 3. Extract structured text ──────────────────────────────────────────────
  var lines = [];
  if (meta.description) lines.push(meta.description + '\n');
  walkNode(clone, lines);

  var content = lines.join('').replace(/\n{3,}/g, '\n\n').trim();
  var wordCount = content.split(/\s+/).length;

  return {
    title:       document.title,
    url:         location.href,
    description: meta.description,
    content:     content,
    wordCount:   wordCount
  };
}

// ── Content scoring (Readability-lite) ────────────────────────────────────────
function contentScore(el) {
  var text = el.innerText || el.textContent || '';
  var textLen = text.trim().length;
  if (textLen < 100) return 0;

  var pCount  = el.querySelectorAll('p').length;
  var links   = el.querySelectorAll('a');
  var linkLen = Array.from(links).reduce(function (n, a) {
    return n + (a.textContent || '').length;
  }, 0);
  var linkDensity = textLen > 0 ? linkLen / textLen : 1;

  var score = pCount * 3 + Math.sqrt(textLen) - (linkDensity * 50);

  var tag = el.tagName;
  if (tag === 'ARTICLE') score += 30;
  if (tag === 'MAIN')    score += 20;
  if (tag === 'SECTION') score += 5;

  return score;
}

// ── DOM walker ─────────────────────────────────────────────────────────────────
function walkNode(node, out) {
  if (node.nodeType === Node.TEXT_NODE) {
    var t = node.textContent.replace(/\s+/g, ' ');
    if (t.trim()) out.push(t);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  var tag = node.tagName;

  var hLevel = { H1:1, H2:2, H3:3, H4:4, H5:5, H6:6 }[tag];
  if (hLevel) {
    var hText = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (hText) out.push('\n' + '#'.repeat(hLevel) + ' ' + hText + '\n\n');
    return;
  }

  if (tag === 'P' || tag === 'BLOCKQUOTE') {
    var before = out.length;
    node.childNodes.forEach(function (c) { walkNode(c, out); });
    if (out.length > before) out.push('\n\n');
    return;
  }

  if (tag === 'LI') {
    var liParts = [];
    node.childNodes.forEach(function (c) { walkNode(c, liParts); });
    var liText = liParts.join('').replace(/\s+/g, ' ').trim();
    if (liText) out.push('- ' + liText + '\n');
    return;
  }

  if (tag === 'UL' || tag === 'OL') {
    node.childNodes.forEach(function (c) { walkNode(c, out); });
    out.push('\n');
    return;
  }

  if (tag === 'PRE' || tag === 'CODE') {
    var code = (node.textContent || '').trim();
    if (code) out.push('\n```\n' + code + '\n```\n\n');
    return;
  }

  if (tag === 'TABLE') {
    node.querySelectorAll('tr').forEach(function (row) {
      var cells = Array.from(row.querySelectorAll('td,th'))
        .map(function (c) { return (c.textContent || '').replace(/\s+/g, ' ').trim(); })
        .filter(Boolean);
      if (cells.length) out.push(cells.join(' | ') + '\n');
    });
    out.push('\n');
    return;
  }

  var BLOCK = { DIV:1, SECTION:1, ARTICLE:1, FIGURE:1, FIGCAPTION:1,
                TD:1, TH:1, DT:1, DD:1, DETAILS:1, SUMMARY:1 };
  if (BLOCK[tag]) {
    var bBefore = out.length;
    node.childNodes.forEach(function (c) { walkNode(c, out); });
    if (out.length > bBefore) {
      var last = out[out.length - 1];
      if (last && !last.endsWith('\n')) out.push('\n');
    }
    return;
  }

  node.childNodes.forEach(function (c) { walkNode(c, out); });
}

// ── Meta extraction ───────────────────────────────────────────────────────────
function getMeta() {
  var desc =
    (document.querySelector('meta[name="description"]')        || {}).content ||
    (document.querySelector('meta[property="og:description"]') || {}).content ||
    (document.querySelector('meta[name="twitter:description"]') || {}).content ||
    '';
  return { description: desc.trim() };
}
