# Neiro Memory

Web UI for browsing and editing AI agent memory files (Hermes + OpenClaw).

## Features

- 📁 File browser with Markdown viewer/editor (CodeMirror 6)
- 🤖 Multi-agent auto-discovery (Hermes profiles + OpenClaw)
- 🔐 Token-based auth with bcrypt password hashing
- 🏷️ Tag extraction from `## headers` and `#hashtags`
- ⏰ Cron job management (Hermes + OpenClaw formats)
- 🧩 Skills browser (recursive scan, depth 3)
- 🌐 EN/RU i18n with locale toggle
- 🎨 Dark/Light themes with Inter (default) and serif options
- 🔒 Sensitive data masking for tokens/secrets
- 🔍 Full-text search across workspace files
- 📡 WebSocket live file change notifications

## Quick Start

```bash
git clone https://github.com/salt-vrn/neiro-memory.git
cd neiro-memory
npm install
npm run build
```

Set password and run:
```bash
# Generate password hash
node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 12))"

# Run server (direct access)
AUTH_HASH='your-hash-here' PORT=8901 HOST=0.0.0.0 npx tsx server/index.ts
```

Open `http://your-ip:8901` in browser.

## Behind Reverse Proxy

If deploying behind nginx with a path prefix:

```bash
BASE_PATH=/memory-viewer/ npm run build
```

Nginx config:
```nginx
location /memory-viewer/ {
    proxy_pass http://127.0.0.1:8901/;
}
```

See [PROJECT.md](./PROJECT.md) for architecture, env vars, systemd unit, and agent collaboration guide.

## Architecture

```
Browser → Hono server (auth + API) → filesystem (workspace dir)
                ↕ WebSocket (live reload via chokidar)
```

- **Frontend:** React 19, Vite 7, Tailwind CSS 4, CodeMirror 6
- **Backend:** Hono (Node.js), TypeScript, tsx
- **Discovery:** auto-detects Hermes profiles (`~/.hermes/profiles/`) and OpenClaw agents (`~/.openclaw/`)

## Credits

Based on [silicondawn/memory-viewer](https://github.com/silicondawn/memory-viewer) v1.2.0 — a memory file browser for OpenClaw. Adapted for Hermes Agent with multi-agent support, cron management, skills browser, and i18n.

## License

MIT
