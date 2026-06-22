# Neiro Memory

Web UI для просмотра и редактирования памяти AI-агентов (Hermes + OpenClaw). Показывает файлы памяти, навыки, сессии, cron-задачи через единый интерфейс.

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

## Deploy (neirohost.ru)

### Запуск

```bash
cd ~/.hermes/workspace/memory-viewer
AUTH_HASH='...' CHOKIDAR_USEPOLLING=1 WORKSPACE_DIR=/root/.hermes PORT=8901 npx tsx server/index.ts
```

### Nginx (на хосте)

```nginx
location /memory-viewer/ {
    proxy_pass http://127.0.0.1:8901/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### Сборка с base path

```bash
BASE_PATH=/memory-viewer/ npm run build
```

→ Подробнее: [PROJECT.md](./PROJECT.md) (env vars, systemd, архитектура, конвенции)

## Architecture

```
Browser → Hono server (auth + API) → filesystem (workspace dir)
                ↕ WebSocket (live reload via chokidar)
```

**Сервер:** `server/index.ts` (~1700 строк) — Hono API, file scanning, auth, cron, WebSocket
**Фронт:** `src/` — React SPA с хуками, файловым деревом, редактором Markdown

### Ключевые файлы

| Файл | Роль |
|---|---|
| `server/auth.ts` | Auth middleware, login/logout, rate limiting (3 attempts → 5min ban) |
| `src/api.ts` | Frontend API client (buildUrl добавляет `?agent=`) |
| `src/App.tsx` | Main layout, agent selector, sidebar, header buttons |
| `src/i18n.ts` | EN/RU translation dictionary (~120+ keys) |
| `src/components/CronManager.tsx` | Cron UI (agent-aware, system features) |
| `src/components/LoginPage.tsx` | Auth screen with locale toggle |
| `src/hooks/useAgents.ts` | Multi-agent discovery and switching |

## Multi-Agent Discovery

Автообнаружение агентов на файловой системе (без ручной настройки):

1. **Hermes default:** `~/.hermes/` → `config.yaml` → `terminal.cwd`
2. **Hermes profiles:** `~/.hermes/profiles/*/`
3. **OpenClaw config:** `~/.openclaw/openclaw.json` → `agents.list[]`
4. **OpenClaw dirs:** `~/.openclaw/agents/*/`

API: `GET /api/agents` → `[{id, name, type, workspace, extraPaths, emoji}]`. Все эндпоинты принимают `?agent=<agentId>`. Селектор агентов показывается когда `agents.length > 1`.

### Логика cwd

- `terminal.cwd` ведёт **внутрь** `.hermes/` → extraPaths пуст
- `terminal.cwd` ведёт **наружу** → добавляем в `extraPaths`
- Placeholder (`.`, `auto`, `cwd`) игнорируются
- Кэш: 30 сек TTL

## Skills

Рекурсивный поиск до глубины 3 в `{workspace}/skills/*/SKILL.md`. `scanDir` исключает `skills/` на корневом уровне (Quick Access → Skills показывает отдельно).

## Password Change

Кнопка "Сменить пароль" внизу sidebar. Хеш → `~/.hermes/.memory-viewer-auth` (приоритет над env). Восстановление: удалить файл → fallback на `AUTH_HASH` env.

## Hermes System Features (CronManager)

10 пунктов из `config.yaml` + CLI stats:

1. 🤖 Модель и провайдер
2. 📱 Платформы
3. 🗃️ Сессии (auto_prune, retention)
4. 📸 Контрольные точки
5. 🧠 Память (memory_enabled, limits)
6. 🎙️ TTS (provider, voice)
7. 🔀 Делегирование (model, iterations, timeout)
8. 🔒 Безопасность (Tirith, secrets)
9. ⏰ Планировщик кронов
10. 📊 Статистика (live через `hermes sessions stats` CLI)

## План

- [x] Auth, multi-agent, skills, i18n, cron, dashboard, password change
- [x] Header cleanup, rate limiting, rename to "Neiro Memory"
- [ ] Server simplification
- [ ] Tags explanation to user

## Known Issues

- TS lint ошибки pre-existing — не мешают работе через tsx
- `extraPaths` пока не используется фронтендом
- Мёртвый код: `Connections.tsx`, `useConnections.ts`, `cron-trigger.mjs`

## Безопасность

- XSS в FileViewer через `dangerouslySetInnerHTML` — остался
- `safePath()` — предотвращает traversal (отбрасывает `..`, проверяет `.md`, containment)
- Gateway chat proxy убран из кода (был SSRF risk)

## Зависимости окружения

- DNS flaky → `echo "nameserver 8.8.8.8" > /etc/resolv.conf`
- Chokidar EMFILE → `CHOKIDAR_USEPOLLING=1`
- Контейнер за NAT → порты не видны снаружи, только через nginx proxy
- `yaml` npm пакет (парсинг config.yaml)
- Hermes CLI: `/usr/local/lib/hermes-agent/venv/bin/hermes`
- OpenClaw cron: `openclaw cron run <id>` (CLI, не WebSocket)

## Удалённый функционал

В процессе адаптации из upstream (silicondawn/memory-viewer) убрано:

1. Connections (multi-instance) — не нужна, один экземпляр
2. Embedding/Settings/Plugins — семантический поиск не используется
3. Settings dropdown (Zoom, Tesla, Changelog) → 3 прямые кнопки
4. Locale EN/ZH → EN/RU
5. Cron run history → показ prompt content
6. Timeline + Today + Memory by Month — зависели от OpenClaw diary (нет в Hermes)

## Credits

Based on [silicondawn/memory-viewer](https://github.com/silicondawn/memory-viewer) v1.2.0. Adapted for Hermes Agent.

## License

MIT
