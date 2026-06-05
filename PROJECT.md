# Memory Viewer — Project Guide

Web UI for browsing and editing AI agent memory files. Originally built for OpenClaw (silicondawn/memory-viewer v1.2.0), adapted for Hermes Agent multi-agent support.

## Stack

- **Frontend:** React 19, Vite 7, Tailwind CSS 4, Phosphor Icons, CodeMirror 6
- **Backend:** Hono (Node.js), TypeScript, tsx
- **Auth:** bcryptjs, token-based (bearer in localStorage `mv_token`)
- **Live reload:** WebSocket + chokidar file watcher
- **Languages:** EN/RU i18n (toggle in header + login page)

## Quick Start

```bash
npm install
npm run dev          # Vite + tsx watch (dev mode)
npm run build        # Production build → dist/
```

Production server:
```bash
AUTH_HASH='<bcrypt hash>' \
CHOKIDAR_USEPOLLING=1 \
WORKSPACE_DIR=/path/to/agent/workspace \
PORT=8901 \
npx tsx server/index.ts
```

> **Pitfall:** `CHOKIDAR_USEPOLLING=1` is required in some environments (EMFILE limit).

## Architecture

```
server/
  index.ts        # Hono API server (~1255 lines) — REST endpoints, WebSocket, file watching
  auth.ts         # Login/logout/password-change, rate limiting (3 attempts → 5min ban)

src/
  App.tsx         # Main layout: sidebar, header, content views
  api.ts          # Frontend API client (buildUrl adds ?agent=)
  i18n.ts         # EN/RU translation dictionary (~85 keys)
  main.tsx        # Entry point

  components/
    FileTree.tsx      # Sidebar file tree (excludes skills/, profiles/, agents/)
    FileViewer.tsx    # Markdown viewer/editor with CodeMirror
    Dashboard.tsx     # System info, recent files, pinned files, quick access
    CronManager.tsx   # Cron job management (Hermes + OpenClaw formats)
    Tags.tsx          # Tag extraction from ## headers and #hashtags
    SkillsPage.tsx    # Agent skills browser (recursive depth 3)
    AgentStatus.tsx   # OpenClaw agent status display
    LoginPage.tsx     # Auth screen with locale toggle
    SearchPanel.tsx   # Full-text search across workspace
    SensitiveMask.tsx # Hide secrets/tokens in display
    MarkdownEditor.tsx # CodeMirror markdown editor

  hooks/
    useAgents.ts        # Multi-agent discovery and switching
    useLocale.ts        # EN/RU locale context
    useTheme.ts         # Dark/light theme toggle
    useSensitive.ts     # Sensitive data mask toggle
    useWebSocket.ts     # Live file change notifications
    useResizableSidebar.ts

  themes/
    registry.ts       # Theme registry (default = "default" sans-serif/Inter)
    apply.ts          # Inline style injection for medium theme
    builtin/          # default.ts (CSS), medium.ts (inline serif)
```

## Multi-Agent Discovery

Server auto-discovers agents from filesystem. No manual config needed.

1. **Hermes default:** `~/.hermes/` → reads `config.yaml` → extracts `terminal.cwd`
2. **Hermes profiles:** `~/.hermes/profiles/*/`
3. **OpenClaw config:** `~/.openclaw/openclaw.json` → `agents.list[]`
4. **OpenClaw dirs:** `~/.openclaw/agents/*/`

Frontend shows agent selector when `agents.length > 1`. All API endpoints accept `?agent=<agentId>`.

## Key Conventions

### i18n (EN/RU)
1. Add keys to `src/i18n.ts` — check for duplicates first
2. Import `LocaleContext` via `useContext`, use `t("section.key")`
3. Wrap early-return components in `<LocaleContext.Provider>`
4. Helper functions that produce strings need `t` as parameter
5. **Always `npm run build` after i18n changes** — duplicate keys cause TS1117 only at compile time

### Themes
- Default theme is `"default"` (Inter sans-serif), not `"medium"` (serif)
- `localStorage("mv-md-theme")` stores user preference
- `applyThemeStyles()` injects inline styles for medium theme only

### File Tree Exclusions
`scanDir` skips at root level: hidden dirs (`.`), `node_modules`, `skills/`, `profiles/`, `agents/`

### Cron
- Hermes: `hermes cron run <id>` (full path: `/usr/local/lib/hermes-agent/venv/bin/hermes`)
- OpenClaw: `openclaw cron run <id>`
- "at" format: `HH:MM DD.MM.YYYY` (Russian format, not ISO)

## Known Pitfalls

- **DNS flaky** in container: `echo "nameserver 8.8.8.8" > /etc/resolv.conf`
- **Mobile browser cache** after deploy: long-press reload → "Clear cache and reload"
- **Auth hash corruption** after restart: verify with `curl -s -X POST http://localhost:8901/api/login -H 'Content-Type: application/json' -d '{"password":"Yybe-FkF"}'`
- **execSync + ESM**: `require()` doesn't work in function bodies under tsx/ESM — use top-level imports
- **Branding**: "Neiro Memory" in `index.html`, `LoginPage.tsx`, `App.tsx`
- **vite build blocked** by terminal tool detecting it as long-lived process — use `background=true` + `process wait`

## Security

- `safePath()` prevents directory traversal (strips `..`, checks `.md`, containment)
- XSS risk in `FileViewer` via `dangerouslySetInnerHTML` — known, acceptable for local use
- Rate limiting on login: 3 failed attempts → 5min IP ban
- Password hash stored in `~/.hermes/.memory-viewer-auth` (file) or `AUTH_HASH` env var

## Branding

Title is "Neiro Memory". Update in 3 places if renaming:
1. `<title>` in `index.html`
2. Login page `<h1>` in `src/components/LoginPage.tsx`
3. Sidebar header in `src/App.tsx`
