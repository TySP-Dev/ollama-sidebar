<div align="center">

[![Main Repo](https://img.shields.io/badge/Main%20Repo-gits.tysstech.com-blue?logo=gitea)](https://git.tysstech.com/TySS-Dev/ollama-sidebar)
[![Mirror Repo](https://img.shields.io/badge/Mirror%20Repo-github.com-blue?logo=github)](https://github.com/TySP-Dev/ollama-sidebar)
[![Chrome WebStore](https://img.shields.io/badge/Chrome%20WebStore-Install%20Now-blue?logo=googlechrome)](https://chromewebstore.google.com/your-extension-link)

<div align="left">

# Ollama Sidebar

A browser sidebar chat extension that connects to a self-hosted Ollama instance. Built for Orion (WebKit) with full Chrome support. No cloud, no accounts, no bundler — loads unpacked directly from disk.

---

## Requirements

- Ollama running locally or on a remote host
- Chrome 114+ or Orion (beta Chrome extension support)
- At least one model pulled in Ollama
- `OLLAMA_ORIGINS=*` set on the Ollama instance if proxied through Nginx or another reverse proxy

---

## Browser Compatibility

| Browser | Status | Notes |
|---|---|---|
| Orion | ✅ Main supported browser | File picker button does not open a picker — drag and drop files onto the chat instead. Under investigation. |
| Chrome | ✅ Fully working | All features including file picker. `sidebar_action` manifest warning is expected and harmless. |
| Firefox | 🔜 Not yet supported | Possible future support. |

---

## Installation

1. Clone or download this repository
2. Open the `icons/` folder — if the PNG files are missing, open `generate_icons.html` in a browser and save the three icons into the `icons/` folder
3. **Chrome:** go to `chrome://extensions`, enable Developer Mode, click **Load unpacked**, select the project folder
4. **Orion:** go to Tools → Extensions → Install from Disk, select the project folder
5. Click the extension icon in the toolbar to open the sidebar

---

## First-time setup

1. Click the ⚙ Settings button in the sidebar header
2. Set your **Ollama Base URL** (default: `http://localhost:11434`)
3. Click **Test Connection** — connected models will appear in the dropdowns
4. Set a **Chat Title Model**
5. Set a **Default Chat Model**
6. (OPTIONAL) Set a **Embedded model**
5. Click **Save Settings**

> [!NOTE]
> If Ollama is behind a reverse proxy with bearer token auth, enter the token in the **Bearer Token** field.

---

## Features

### Chat

- Streaming responses with stop, regenerate, and edit
- Thinking/reasoning block support
- Full markdown rendering with syntax-highlighted code blocks

### Context

- Add the current page as context with the 🌐 button — uses a Readability-style algorithm to extract main content, strips navigation and noise
- Drag and drop files onto the chat to attach (`.txt`, `.md`, `.csv`, `.pdf`, images)
- PDF text extraction via PDF.js
- Image support for vision-capable models (llava, qwen-vl, etc.)
- Keyword and semantic RAG — relevant chunks are selected before being sent, scaled to your model's context window

### Sessions

- Multiple named chat sessions with create, delete, search, and export as Markdown
- Auto-generated session names from the first message
- Session history persisted in browser storage

### Personas

- 8 built-in personas (Assistant, Code Reviewer, Study Buddy, Writing Editor, Rubber Duck, Devil's Advocate, Technical Writer, Be Brief/BLUF)
- Create and save custom personas
- Each session tracks its active persona's system prompt

### Prompt Templates

- 10 built-in templates triggered with `/` in the input
- Create and save custom templates

### Models

- Per-session model selector
- Pull new models from the Settings page without leaving the browser
- Multi-model comparison mode — send the same prompt to two models side by side
- Semantic RAG via Ollama `/api/embed` endpoint (configure embedding model in Settings)

### Settings

- Dark/light theme
- Compact message density
- Auto-scroll during generation
- Response language lock
- Model parameters (temperature, top-p, top-k, repeat penalty, seed, context length, max tokens)
- Default system prompt
- Debug panel with live log, system info, and connection status

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+K` | New chat |
| `Ctrl+L` | Clear conversation (press twice to confirm) |
| `Ctrl+/` | Open templates |
| `Ctrl+,` | Open settings |
| `Ctrl+?` | Show all shortcuts |
| `Esc` | Close panels and overlays |

---

## Project structure

```
├── .gitignore             # gitignore
├── LICENSE.md             # MIT License
├── README.md              # Readme file
├── PrivacyPolicyForWebStore # Privacy Policy to publish to webstores
├── background.js          # Service worker — message routing, stream relay
├── content.js             # Content script — page text extraction
├── sidepanel.html         # Sidebar UI
├── sidepanel.js           # Sidebar logic
├── sidepanel.css          # Sidebar styles
├── settings.html          # Options page
├── settings.js            # Options page logic
├── settings.css           # Options page styles
├── manifest.json          # Extension manifest (MV3)
├── marked.min.js          # Markdown rendering
├── highlight.min.js       # Syntax highlighting
├── hljs-github-dark.min.css  # Highlight.js theme
├── pdf.min.js             # PDF.js v3 — PDF text extraction
├── pdf.worker.min.js      # PDF.js worker
├── pdf-init.js            # PDF.js worker initialisation
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Notes

- **File upload:** Chrome supports the native file picker via the attach button. Orion does not currently open the file picker — drag and drop files directly onto the chat area instead. This is under investigation.
- **Semantic RAG:** Requires an embedding model pulled in Ollama (recommended: `nomic-embed-text-v2-moe`). Configure it under Settings → Models → Embedding Model. If not configured, keyword matching is used.
- **Multi-model comparison:** Results are not saved to session history.
- **Debug panel:** Available in Settings → Debug (collapsed by default). Logs auto-clear after 30 minutes.
- **Ollama CORS:** If requests are blocked, ensure `OLLAMA_ORIGINS=*` is set in your Ollama environment or your reverse proxy passes the correct CORS headers.

---

## License

MIT
