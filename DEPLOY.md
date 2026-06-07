# Neiro Memory — Deploy Guide for neirohost.ru Containers

## Context

Neiro Memory is a web UI for browsing/editing AI agent memory files. It runs as a Node.js server (Hono framework) on a local port inside an LXC container. Containers are behind NAT — the server is NOT directly accessible from the internet. Nginx reverse proxy on the host must forward external requests into the container.

---

## Part 1: Container Setup (agent inside the container)

### 1.1 Clone and Build

```bash
cd ~
git clone https://github.com/salt-vrn/neiro-memory.git
cd neiro-memory
npm install

# Build with the correct base path for nginx proxy
# The BASE_PATH must match the URL prefix where nginx will serve the app
BASE_PATH=/memory-viewer/ npm run build
```

**Important:** `BASE_PATH` must end with `/` and match the nginx location block prefix exactly.

### 1.2 Set Auth Password

```bash
# Generate bcrypt hash of your password
node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('YOUR_PASSWORD_HERE', 10))"
```

Save the hash to the auth file:

```bash
echo '$2a$10$HASH_HERE' > ~/.hermes/.memory-viewer-auth
chmod 600 ~/.hermes/.memory-viewer-auth
```

Or let the app auto-create it on first login (it will hash the entered password and save it).

### 1.3 Run the Server

```bash
cd ~/neiro-memory
AUTH_HASH=$(cat ~/.hermes/.memory-viewer-auth) \
CHOKIDAR_USEPOLLING=1 \
WORKSPACE_DIR=/root/.hermes \
HOST=127.0.0.1 \
PORT=8901 \
npx tsx server/index.ts
```

**Environment variables:**
- `PORT` — local port (default: 8901)
- `HOST` — bind address (default: 127.0.0.1; use `0.0.0.0` only if no nginx)
- `WORKSPACE_DIR` — path to agent's memory root (usually `/root/.hermes`)
- `AUTH_HASH` — bcrypt hash for login (or omit + set `ALLOW_NO_AUTH=1` for dev)
- `CHOKIDAR_USEPOLLING=1` — required in LXC containers (EMFILE workaround)
- `BASE_PATH` — **build-time only**, not a runtime env var
- `CORS_ORIGINS` — comma-separated allowed origins (default: `*` for private tools)

### 1.4 Systemd Service (auto-start)

Create `/etc/systemd/system/neiro-memory.service`:

```ini
[Unit]
Description=Neiro Memory — Web UI for AI agent memory
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/neiro-memory
Environment=AUTH_HASH=%h/.hermes/.memory-viewer-auth
Environment=CHOKIDAR_USEPOLLING=1
Environment=WORKSPACE_DIR=/root/.hermes
Environment=HOST=127.0.0.1
Environment=PORT=8901
ExecStart=/usr/bin/env npx tsx server/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> **Note:** `ExecStart=/usr/bin/env npx` — NOT `/usr/bin/npx` (the latter may not exist).
> For AUTH_HASH, read the hash from file in ExecStart or use `EnvironmentFile`:
> ```ini
> EnvironmentFile=/root/.hermes/.memory-viewer-auth-env
> ```
> Where `.memory-viewer-auth-env` contains: `AUTH_HASH=$2a$10$...`

```bash
systemctl daemon-reload
systemctl enable neiro-memory
systemctl start neiro-memory
systemctl status neiro-memory
```

### 1.5 Verify It Works Locally

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8901/
# Should return 200

curl -s http://127.0.0.1:8901/api/auth/status
# Should return {"authenticated":false,"configured":true}
```

---

## Part 2: Nginx Configuration (on the HOST server)

The container is behind NAT. The host's nginx must proxy requests to the container's localhost.

### 2.1 Find the Container's Internal IP or Use Port Forwarding

If the container has a private IP (e.g., `10.0.3.100`), nginx can proxy directly to it.
If not, the host must have port forwarding: `host:8901 → container:8901`.

### 2.2 Nginx Location Block

Add to the server block for the container's domain:

```nginx
# In the server block for sonic-v.neirohost.ru (or shared domain)
location /memory-viewer/ {
    proxy_pass http://127.0.0.1:8901/;  # trailing slash strips prefix!
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket support (required for live reload)
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Timeouts for long operations
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
}
```

**Critical:** The trailing slash in `proxy_pass http://127.0.0.1:8901/;` tells nginx to strip `/memory-viewer/` before forwarding. This is how Hono server receives requests at `/` instead of `/memory-viewer/`.

### 2.3 SSL (if not already configured)

The container domain should already have SSL via Let's Encrypt or shared cert. If not:

```bash
certbot --nginx -d sonic-v.neirohost.ru
```

### 2.4 Reload Nginx

```bash
nginx -t && systemctl reload nginx
```

### 2.5 Verify

```bash
curl -s -o /dev/null -w "%{http_code}" https://sonic-v.neirohost.ru/memory-viewer/
# Should return 200
```

---

## Part 3: Checklist

| Step | Where | What | Verify |
|------|-------|------|--------|
| 1 | Container | `npm install` + `BASE_PATH=/memory-viewer/ npm run build` | `dist/` exists |
| 2 | Container | Auth file created with mode 600 | `ls -la ~/.hermes/.memory-viewer-auth` |
| 3 | Container | Server running on `127.0.0.1:8901` | `curl localhost:8901` → 200 |
| 4 | Container | systemd service enabled | `systemctl is-enabled neiro-memory` |
| 5 | Host | Nginx location block added | `nginx -t` passes |
| 6 | Host | Nginx reloaded | `systemctl reload nginx` |
| 7 | Internet | HTTPS access works | Browser: `https://sonic-v.neirohost.ru/memory-viewer/` |
| 8 | Internet | Login works | Enter password → see Dashboard |

---

## Common Issues

### "404 Not Found" from nginx
- Check `BASE_PATH` was set at build time: `grep -r "base:" dist/assets/*.js`
- Ensure nginx `proxy_pass` has trailing slash: `proxy_pass http://127.0.0.1:8901/;`

### "WebSocket connection failed"
- Nginx needs `Upgrade` and `Connection` headers (see config above)
- Without WebSocket, the app works but no live reload

### "EMFILE: too many open files"
- Set `CHOKIDAR_USEPOLLING=1` environment variable

### Login loop / "Invalid password"
- Check `AUTH_HASH` env var matches the bcrypt hash
- Or delete `~/.hermes/.memory-viewer-auth` and restart to re-enter password

### Server won't start: "npx not found"
- Use `/usr/bin/env npx` in systemd ExecStart, not `/usr/bin/npx`

### CORS errors in browser console
- Set `CORS_ORIGINS=https://sonic-v.neirohost.ru` or leave default `*`

---

## Architecture Diagram

```
Internet
    │
    ▼
┌──────────────────────────────┐
│  HOST: nginx (port 443)      │
│  SSL termination             │
│                              │
│  location /memory-viewer/ {  │
│    proxy_pass → :8901/;      │  ← strips prefix
│    WebSocket upgrade headers │
│  }                           │
└──────────────┬───────────────┘
               │ NAT
               ▼
┌──────────────────────────────┐
│  CONTAINER (LXC)             │
│                              │
│  Neiro Memory (Hono)         │
│  127.0.0.1:8901              │
│  BASE_PATH=/memory-viewer/   │
│  WORKSPACE_DIR=/root/.hermes │
└──────────────────────────────┘
```

---

## Security Notes

- Password is bcrypt-hashed, stored with mode 0600
- Rate limiting: 3 failed attempts → 5 min ban per IP
- Global limit: 30 attempts/minute across all IPs
- Server listens on `127.0.0.1` only (not exposed without nginx)
- `.md` files only — no arbitrary file access
- No public API — this is a private tool behind authentication
