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
npm install
npm run dev
```

See [PROJECT.md](./PROJECT.md) for architecture, conventions, and agent collaboration guide.

## License

MIT
