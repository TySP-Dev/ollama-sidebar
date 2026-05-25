console.log('[Ollama Sidebar] content script loaded on', location.href);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONTENT') {
    try {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, iframe, svg, canvas').forEach((el) => el.remove());
      const text = (clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
      sendResponse({ title: document.title, url: location.href, content: text });
    } catch (e) {
      sendResponse({ title: document.title, url: location.href, content: '' });
    }
    return true;
  }
});
