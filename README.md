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

# Run server
AUTH_HASH='your-hash-here' PORT=8901 HOST=0.0.0.0 npx tsx server/index.ts
```

Open `http://your-ip:8901` in browser.

See [PROJECT.md](./PROJECT.md) for architecture, env vars, systemd unit, and agent collaboration guide.

## License

MIT
