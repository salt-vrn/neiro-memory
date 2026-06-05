/**
 * Memory Viewer — API Server (Hono)
 *
 * Provides REST endpoints for browsing, reading, editing, and searching
 * Markdown files, plus a WebSocket channel that pushes live file-change
 * notifications to connected clients.
 */
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import fs from "fs";
import path from "path";
import os from "os";
import { exec as execCallback, execSync } from "child_process";
import util from "util";
import { watch } from "chokidar";
import type { WSContext } from "hono/ws";
import { authMiddleware, handleLogin, handleLogout, handleAuthStatus, handleChangePassword } from "./auth";
import { parse as parseYaml } from "yaml";

const exec = util.promisify(execCallback);

// ---------------------------------------------------------------------------
// Agent Config Types
// ---------------------------------------------------------------------------
interface AgentConfig {
  id: string;
  name: string;
  workspace?: string;
  agentDir?: string;
  identity?: {
    name?: string;
    emoji?: string;
  };
  skills?: string[];
}

interface AgentsConfig {
  defaults: {
    workspace?: string;
  };
  list: AgentConfig[];
}

interface OpenClawConfig {
  agents?: AgentsConfig;
}

interface AgentInfo {
  id: string;
  name: string;
  type: "hermes" | "openclaw";
  workspace: string;
  extraPaths: string[];  // cwd paths outside main workspace
  emoji: string;
  skills?: string[];
}


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3001;
const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR || path.join(os.homedir(), "clawd");
const STATIC_DIR = process.env.STATIC_DIR || path.join(import.meta.dirname, "..", "dist");

const app = new Hono();
export { app }; // Export for testing
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("*", compress());
app.use("*", cors({ origin: ["http://localhost:8901", "https://zolotarev215.neirohost.ru"] }));

// Auth middleware — protects all routes when AUTH_HASH is set
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (process.env.DEBUG_AUTH) {
    console.log(`[AUTH] ${c.req.method} ${url.pathname} | cookie: ${c.req.header('cookie') || 'NONE'}`);
  }
  return authMiddleware(c, next);
});

// Auth routes
app.post("/api/login", handleLogin);
app.post("/api/logout", handleLogout);
app.get("/api/auth/status", handleAuthStatus);
app.post("/api/change-password", handleChangePassword);

// ---------------------------------------------------------------------------
// Agent Management — Auto-discovery
// ---------------------------------------------------------------------------
const HOME = os.homedir();
const HERMES_HOME = path.join(HOME, ".hermes");
const OPENCLAW_HOME = path.join(HOME, ".openclaw");
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");

// Extract terminal.cwd from a Hermes config.yaml (simple regex, no YAML dep)
function extractCwdFromConfig(configPath: string): string | null {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    // Match "cwd: <value>" under the terminal section
    const m = raw.match(/^(?:  |\t)*terminal:\s*\n(?:[ \t]+.+\n)*?[ \t]+cwd:\s*["']?([^"'\n#]+)["']?/m);
    if (m && m[1]) {
      const val = m[1].trim();
      if (val && val !== "." && val !== "auto" && val !== "cwd") {
        return val;
      }
    }
  } catch {}
  return null;
}

// Resolve cwd to absolute path
function resolveCwd(cwd: string): string {
  if (cwd.startsWith("~")) return path.join(HOME, cwd.slice(1));
  if (path.isAbsolute(cwd)) return cwd;
  return path.resolve(HOME, cwd);
}

// Check if a path is inside another
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Discover Hermes default agent
function discoverHermesDefault(): AgentInfo | null {
  const hermesDir = HERMES_HOME;
  if (!fs.existsSync(hermesDir)) return null;

  const configPath = path.join(hermesDir, "config.yaml");
  const cwd = extractCwdFromConfig(configPath);
  const extraPaths: string[] = [];

  if (cwd) {
    const resolved = resolveCwd(cwd);
    if (!isInside(resolved, hermesDir)) {
      extraPaths.push(resolved);
    }
  }

  return {
    id: "hermes:default",
    name: "Hermes (default)",
    type: "hermes",
    workspace: hermesDir,
    extraPaths,
    emoji: "🧠",
  };
}

// Discover Hermes profiles
function discoverHermesProfiles(): AgentInfo[] {
  const profilesDir = path.join(HERMES_HOME, "profiles");
  if (!fs.existsSync(profilesDir)) return [];

  const agents: AgentInfo[] = [];
  try {
    const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profileDir = path.join(profilesDir, entry.name);
      const configPath = path.join(profileDir, "config.yaml");
      const cwd = extractCwdFromConfig(configPath);
      const extraPaths: string[] = [];

      if (cwd) {
        const resolved = resolveCwd(cwd);
        if (!isInside(resolved, profileDir)) {
          extraPaths.push(resolved);
        }
      }

      agents.push({
        id: `hermes:${entry.name}`,
        name: `Hermes (${entry.name})`,
        type: "hermes",
        workspace: profileDir,
        extraPaths,
        emoji: "🧠",
      });
    }
  } catch (e) {
    console.error("Failed to scan Hermes profiles:", e);
  }
  return agents;
}

// Discover OpenClaw agents
function discoverOpenClawAgents(): AgentInfo[] {
  if (!fs.existsSync(OPENCLAW_HOME)) return [];

  const agents: AgentInfo[] = [];

  // From openclaw.json agents.list
  try {
    if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
      const raw = fs.readFileSync(OPENCLAW_CONFIG_PATH, "utf-8");
      const config: OpenClawConfig = JSON.parse(raw);
      if (config?.agents?.list) {
        const defaults = { workspace: OPENCLAW_HOME, ...config.agents.defaults };
        for (const agent of config.agents.list) {
          agents.push({
            id: `openclaw:${agent.id}`,
            name: agent.name || agent.id,
            type: "openclaw",
            workspace: getAgentWorkspace(agent, defaults),
            extraPaths: [],
            emoji: agent.identity?.emoji || "🐾",
            skills: agent.skills || undefined,
          });
        }
      }
    }
  } catch (e) {
    console.error("Failed to load OpenClaw config:", e);
  }

  // From openclaw/agents/ subdirectories
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  if (fs.existsSync(agentsDir)) {
    try {
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Skip if already discovered from config
        if (agents.some(a => a.id === `openclaw:${entry.name}`)) continue;
        agents.push({
          id: `openclaw:${entry.name}`,
          name: entry.name,
          type: "openclaw",
          workspace: path.join(agentsDir, entry.name),
          extraPaths: [],
          emoji: "🐾",
        });
      }
    } catch {}
  }

  return agents;
}

function getAgentWorkspace(agentConfig: AgentConfig, defaults: { workspace?: string }): string {
  // Priority: workspace > agentDir > defaults.workspace > DEFAULT_WORKSPACE
  if (agentConfig.workspace) {
    return agentConfig.workspace;
  }
  if (agentConfig.agentDir) {
    return agentConfig.agentDir;
  }
  if (defaults.workspace) {
    return defaults.workspace;
  }
  return DEFAULT_WORKSPACE;
}

// Cache agents for 30s to avoid re-scanning on every request
let _agentsCache: { agents: AgentInfo[]; ts: number } | null = null;
const AGENTS_CACHE_TTL = 30_000;

function getAgents(): AgentInfo[] {
  if (_agentsCache && Date.now() - _agentsCache.ts < AGENTS_CACHE_TTL) {
    return _agentsCache.agents;
  }

  const agents: AgentInfo[] = [
    ...(() => { const d = discoverHermesDefault(); return d ? [d] : []; })(),
    ...discoverHermesProfiles(),
    ...discoverOpenClawAgents(),
  ];

  // Fallback if nothing found
  if (agents.length === 0) {
    agents.push({
      id: "default",
      name: "Default",
      type: "hermes",
      workspace: DEFAULT_WORKSPACE,
      extraPaths: [],
      emoji: "🤖",
    });
  }

  _agentsCache = { agents, ts: Date.now() };
  return agents;
}

function getAgentById(agentId: string): AgentInfo | null {
  const agents = getAgents();
  return agents.find((a) => a.id === agentId) || null;
}

// Get workspace (+ extra paths) for a given agent ID
function getWorkspaceForAgent(agentId: string | null | undefined): string {
  if (!agentId || agentId === "default") {
    // Fallback to first available agent
    const agents = getAgents();
    if (agents.length > 0) return agents[0].workspace;
    return DEFAULT_WORKSPACE;
  }

  const agent = getAgentById(agentId);
  if (agent) return agent.workspace;

  return DEFAULT_WORKSPACE;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safePath(filePath: string | undefined | null, workspace: string): string | null {
  if (!filePath || filePath.includes("..") || !filePath.endsWith(".md")) return null;
  const full = path.resolve(workspace, filePath);
  if (!full.startsWith(path.resolve(workspace))) return null;
  return full;
}

interface TreeNode {
  name: string;
  type: "file" | "dir";
  path: string;
  children?: TreeNode[];
}

function scanDir(dir: string, prefix = ""): TreeNode[] {
  const result: TreeNode[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || (prefix === "" && (entry.name === "skills" || entry.name === "profiles" || entry.name === "agents"))) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = scanDir(path.join(dir, entry.name), relPath);
      if (children.length > 0) {
        result.push({ name: entry.name, type: "dir", path: relPath, children });
      }
    } else if (entry.name.endsWith(".md")) {
      result.push({ name: entry.name, type: "file", path: relPath });
    }
  }
  return result;
}

function collectMdFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || (prefix === "" && (entry.name === "skills" || entry.name === "profiles" || entry.name === "agents"))) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectMdFiles(path.join(dir, entry.name), relPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(relPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

// Get agent from query parameter
function getAgentFromQuery(c: any): { agentId: string; workspace: string } {
  const agentId = c.req.query("agent") || "default";
  const workspace = getWorkspaceForAgent(agentId);
  return { agentId, workspace };
}

// Agents API
app.get("/api/agents", (c) => {
  return c.json(getAgents());
});

app.get("/api/skills", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const skillsDir = path.join(workspace, "skills");
  const results: { id: string; name: string; description: string; path: string }[] = [];

  // Recursive scan for SKILL.md up to depth 3
  function scanDir(dir: string, rel: string, depth: number) {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const skillMd = path.join(fullPath, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        const content = fs.readFileSync(skillMd, "utf-8");
        let name = entry.name;
        let description = "";
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const nameMatch = fmMatch[1].match(/^name:\s*(.+)/m);
          const descMatch = fmMatch[1].match(/^description:\s*(.+)/m);
          if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
          if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, "");
        }
        results.push({ id: entry.name, name, description, path: `skills/${relPath}/SKILL.md` });
        // Don't recurse into skill dirs (they contain SKILL.md)
      } else {
        // No SKILL.md here, recurse deeper
        scanDir(fullPath, relPath, depth + 1);
      }
    }
  }

  scanDir(skillsDir, "", 0);
  return c.json(results);
});

app.get("/api/files", (c) => {
  const { workspace } = getAgentFromQuery(c);
  return c.json(scanDir(workspace));
});

app.get("/api/file", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const full = safePath(c.req.query("path"), workspace);
  if (!full) return c.json({ error: "Invalid path" }, 400);
  if (!fs.existsSync(full)) return c.json({ error: "Not found" }, 404);
  const content = fs.readFileSync(full, "utf-8");
  const stat = fs.statSync(full);
  return c.json({ content, mtime: stat.mtime, size: stat.size });
});

app.put("/api/file", async (c) => {
  const { workspace } = getAgentFromQuery(c);
  const { path: filePath, content, expectedMtime } = await c.req.json();
  const full = safePath(filePath, workspace);
  if (!full) return c.json({ error: "Invalid path" }, 400);

  if (expectedMtime && fs.existsSync(full)) {
    const currentMtime = fs.statSync(full).mtime.toISOString();
    if (currentMtime !== expectedMtime) {
      const currentContent = fs.readFileSync(full, "utf-8");
      return c.json({
        error: "conflict",
        message: "File was modified since you started editing",
        serverMtime: currentMtime,
        serverContent: currentContent,
      }, 409);
    }
  }

  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  const stat = fs.statSync(full);
  return c.json({ ok: true, mtime: stat.mtime });
});

app.get("/api/resolve-wikilink", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const link = (c.req.query("link") || "").trim();
  if (!link) return c.json({ error: "Missing link parameter" }, 400);

  const allFiles = collectMdFiles(workspace);

  // Try exact path match first
  const exactPath = link.endsWith(".md") ? link : `${link}.md`;
  if (allFiles.includes(exactPath)) {
    return c.json({ found: true, path: exactPath });
  }

  // Try case-insensitive exact path
  const exactLower = exactPath.toLowerCase();
  const ciMatch = allFiles.find((f) => f.toLowerCase() === exactLower);
  if (ciMatch) {
    return c.json({ found: true, path: ciMatch });
  }

  // Try filename-only match (fuzzy)
  const linkLower = link.toLowerCase();
  const byName = allFiles.find((f) => {
    const name = path.basename(f, ".md");
    return name.toLowerCase() === linkLower;
  });
  if (byName) {
    return c.json({ found: true, path: byName });
  }

  return c.json({ found: false, path: null });
});

app.get("/api/search", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const q = (c.req.query("q") || "").trim().toLowerCase();
  if (!q || q.length < 2) return c.json([]);

  const files = collectMdFiles(workspace);
  const results: { path: string; matches: { line: number; text: string }[] }[] = [];

  for (const relPath of files) {
    const full = path.join(workspace, relPath);
    let content: string;
    try {
      content = fs.readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const matches: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        matches.push({ line: i + 1, text: lines[i].substring(0, 200) });
        if (matches.length >= 5) break;
      }
    }
    if (matches.length > 0) results.push({ path: relPath, matches });
    if (results.length >= 50) break;
  }
  return c.json(results);
});

// ============================================================================
// Tags API - Extract and manage tags from markdown files
// ============================================================================

interface TagInfo {
  name: string;
  count: number;
  files: string[];
}

interface FileWithTags {
  path: string;
  title: string;
  preview: string;
  date: string;
  tags: string[];
}

// Extract tags from content: ## headers and #hashtags
function extractTags(content: string): string[] {
  const tags = new Set<string>();

  // Extract ## headers
  const headers = content.match(/^##\s+(.+)$/gm) || [];
  headers.forEach(h => {
    const tag = h.replace(/^##\s+/, "").replace(/[*_`]/g, "").trim();
    if (tag.length < 30 && tag.length > 0) tags.add(tag);
  });

  // Extract #hashtags (but not markdown headers)
  const hashtags = content.match(/(?<![#\w])#([\w\u4e00-\u9fa5_-]+)/g) || [];
  hashtags.forEach(h => {
    const tag = h.replace(/^#/, "").trim();
    if (tag.length < 30 && tag.length > 0) tags.add(tag);
  });

  return Array.from(tags);
}

// Scan all markdown files and extract tags
function scanAllTags(workspace: string): Map<string, TagInfo> {
  const tagMap = new Map<string, TagInfo>();
  const mdFiles = collectMdFiles(workspace);

  for (const relPath of mdFiles) {
    const fullPath = path.join(workspace, relPath);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const tags = extractTags(content);

      for (const tag of tags) {
        if (!tagMap.has(tag)) {
          tagMap.set(tag, { name: tag, count: 0, files: [] });
        }
        const info = tagMap.get(tag)!;
        info.count++;
        info.files.push(relPath);
      }
    } catch { /* skip */ }
  }

  return tagMap;
}

app.get("/api/tags", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const tagMap = scanAllTags(workspace);
  const tags = Array.from(tagMap.values()).sort((a, b) => b.count - a.count);
  return c.json(tags);
});

app.get("/api/files-by-tag/:tag", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const tagParam = decodeURIComponent(c.req.param("tag"));
  const tagMap = scanAllTags(workspace);
  const tagInfo = tagMap.get(tagParam);

  if (!tagInfo) {
    return c.json([]);
  }

  const results: FileWithTags[] = [];
  for (const relPath of tagInfo.files) {
    const fullPath = path.join(workspace, relPath);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const clean = content.replace(/^---[\s\S]*?---/, "").trim();
      const titleMatch = clean.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : path.basename(relPath, ".md");
      const lines = clean.split("\n").filter(l => l.trim() && !l.startsWith("#"));
      let preview = lines.slice(0, 2).join(" ").replace(/[*_`\[\]]/g, "").trim();
      if (preview.length > 120) preview = preview.slice(0, 120) + "…";
      const date = relPath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
      const fileTags = extractTags(content);

      results.push({
        path: relPath,
        title,
        preview: preview || "(空)",
        date,
        tags: fileTags,
      });
    } catch { /* skip */ }
  }

  // Sort by date (newest first)
  results.sort((a, b) => b.date.localeCompare(a.date));
  return c.json(results);
});

app.get("/api/recent", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const files = collectMdFiles(workspace);
  const withStats = files.map((relPath) => {
    const full = path.join(workspace, relPath);
    try {
      const stat = fs.statSync(full);
      return { path: relPath, mtime: stat.mtime.getTime(), size: stat.size };
    } catch {
      return null;
    }
  }).filter(Boolean) as { path: string; mtime: number; size: number }[];
  withStats.sort((a, b) => b.mtime - a.mtime);
  const limit = Math.min(Number(c.req.query("limit")) || 10, 50);
  return c.json(withStats.slice(0, limit));
});


app.get("/api/info", (c) => {
  const { workspace } = getAgentFromQuery(c);
  let name = "Unknown Bot";
  let description = "";
  for (const fname of ["IDENTITY.md", "SOUL.md"]) {
    const fpath = path.join(workspace, fname);
    if (fs.existsSync(fpath)) {
      const content = fs.readFileSync(fpath, "utf-8");
      const heading = content.match(/^#\s+(.+)/m);
      if (heading) name = heading[1].trim();
      const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      if (lines.length > 0) description = lines[0].trim().substring(0, 200);
      break;
    }
  }
  return c.json({ name, version: "1.0.0", description });
});

app.get("/api/system", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const uptime = os.uptime();
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const load = os.loadavg();
  const platform = `${os.platform()} ${os.release()}`;
  const hostname = os.hostname();

  const totalFiles = collectMdFiles(workspace).length;

  return c.json({
    uptime, memTotal, memFree, memUsed: memTotal - memFree,
    load, platform, hostname, totalFiles,
  });
});

app.get("/api/agent/status", async (c) => {
  // 1. Config
  const home = os.homedir();
  const configPath = path.join(home, ".openclaw", "openclaw.json");
  let safeConfig: any = {};
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      // Whitelist specific fields
      safeConfig = {
        version: raw.version,
        update: raw.update,
        models: { mode: raw.models?.mode },
        agents: { defaults: raw.agents?.defaults },
        gateway: {
          port: raw.gateway?.port,
          mode: raw.gateway?.mode,
        },
      };
    }
  } catch (e) {
    console.error("Failed to read config", e);
    safeConfig = { error: "Could not read config" };
  }

  // 2. Gateway Status
  let gatewayStatus = null;
  try {
    const { stdout } = await exec("openclaw gateway status --json");
    gatewayStatus = JSON.parse(stdout);
  } catch (e) {
    // console.error("Failed to get gateway status", e);
    // fallback or null
  }

  // 3. Heartbeat
  let heartbeat = null;
  try {
    const hbPath = path.join(DEFAULT_WORKSPACE, "memory", "heartbeat-state.json");
    if (fs.existsSync(hbPath)) {
      heartbeat = JSON.parse(fs.readFileSync(hbPath, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to read heartbeat", e);
  }

  return c.json({
    config: safeConfig,
    gateway: gatewayStatus,
    heartbeat
  });
});

// ---------------------------------------------------------------------------
// WebSocket — Live File Change Notifications
// ---------------------------------------------------------------------------

const wsClients = new Set<WSContext>();

app.get("/ws", upgradeWebSocket(() => ({
  onOpen(_event, ws) {
    wsClients.add(ws);
  },
  onClose(_event, ws) {
    wsClients.delete(ws);
  },
})));

function broadcast(data: object) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    try { ws.send(msg); } catch { /* ignore */ }
  }
}

const watcher = watch(path.join(DEFAULT_WORKSPACE, "**/*.md"), {
  ignoreInitial: true,
  ignored: /(^|[/\\])\.(git|node_modules)/,
  awaitWriteFinish: { stabilityThreshold: 300 },
});

watcher.on("all", (event, filePath) => {
  const rel = path.relative(DEFAULT_WORKSPACE, filePath);
  broadcast({ type: "file-change", event, path: rel });
});

// ---------------------------------------------------------------------------
// Workspace assets (images, SVGs, etc.)
// ---------------------------------------------------------------------------
app.get("/workspace-assets/*", async (c) => {
  const { workspace } = getAgentFromQuery(c);
  const assetPath = c.req.path.replace("/workspace-assets/", "");
  const assetsDir = path.resolve(workspace, "assets");
  const fullPath = path.resolve(assetsDir, assetPath);
  if (!fullPath.startsWith(assetsDir + path.sep) && fullPath !== assetsDir) {
    return c.json({ error: "Invalid path" }, 403);
  }
  if (!fs.existsSync(fullPath)) {
    return c.json({ error: "Not found" }, 404);
  }
  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const content = fs.readFileSync(fullPath);
  c.header("Content-Type", contentType);
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(content);
});

// ---------------------------------------------------------------------------
// Cron API — read cron jobs from agent workspace
// ---------------------------------------------------------------------------
function getCronPaths(workspace: string) {
  return {
    jobsFile: path.join(workspace, "cron", "jobs.json"),
    runsDir: path.join(workspace, "cron", "runs"),
  };
}

interface CronJob {
  id: string;
  name?: string;
  enabled: boolean;
  // OpenClaw format
  schedule?: { kind: string; expr?: string; everyMs?: number; at?: string; minutes?: number };
  payload?: { kind: string; text?: string; message?: string };
  sessionTarget?: string;
  agentId?: string;
  wakeMode?: string;
  state?: { nextRunAtMs?: number; lastRunAtMs?: number; lastStatus?: string };
  delivery?: { mode?: string };
  // Hermes format
  prompt?: string;
  schedule_display?: string;
  next_run_at?: string;
  last_run_at?: string;
  last_status?: string;
  last_error?: string;
  last_delivery_error?: string;
  deliver?: string;
  origin?: any;
  created_at?: string;
  repeat?: { times?: number | null; completed?: number };
}

function readCronJobs(workspace: string): CronJob[] {
  try {
    const { jobsFile } = getCronPaths(workspace);
    const data = fs.readFileSync(jobsFile, "utf-8");
    const json = JSON.parse(data);
    return json.jobs || [];
  } catch {
    return [];
  }
}

function writeCronJobs(workspace: string, jobs: CronJob[]): boolean {
  try {
    const { jobsFile } = getCronPaths(workspace);
    fs.copyFileSync(jobsFile, jobsFile + ".bak");
    fs.writeFileSync(jobsFile, JSON.stringify({ version: 1, jobs }, null, 2));
    return true;
  } catch {
    return false;
  }
}

function formatCronJob(job: CronJob) {
  // Hermes format has schedule_display, OpenClaw has schedule.kind
  let scheduleDisplay = job.schedule_display || "-";
  if (!scheduleDisplay || scheduleDisplay === "-") {
    const s = job.schedule;
    if (s) {
      if (s.kind === "cron" && s.expr) scheduleDisplay = s.expr;
      else if (s.kind === "interval" && s.minutes) scheduleDisplay = `every ${s.minutes}m`;
      else if (s.kind === "every" && s.everyMs) scheduleDisplay = `every ${Math.round(s.everyMs / 60000)}m`;
      else if (s.kind === "at" && s.at) {
        try {
          const d = new Date(s.at);
          const pad = (n: number) => String(n).padStart(2, "0");
          scheduleDisplay = `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
        } catch { scheduleDisplay = s.at; }
      }
    }
  }

  // Next/last run — Hermes uses ISO strings, OpenClaw uses ms timestamps
  const nextRun = job.next_run_at || (job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : null);
  const lastRun = job.last_run_at || (job.state?.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : null);
  const lastStatus = job.last_status || job.state?.lastStatus || null;

  // Prompt/message — Hermes uses "prompt", OpenClaw uses "payload.message"
  const prompt = job.prompt || job.payload?.message || job.payload?.text || null;

  return {
    id: job.id,
    name: job.name || "Unnamed",
    enabled: job.enabled !== false,
    schedule: scheduleDisplay,
    scheduleRaw: job.schedule,
    nextRun,
    lastRun,
    lastStatus,
    sessionTarget: job.sessionTarget || job.agentId || "-",
    wakeMode: job.wakeMode || "next-heartbeat",
    payloadKind: job.payload?.kind || "-",
    deliveryMode: job.deliver || job.delivery?.mode || "-",
    prompt,
    deliver: job.deliver || null,
    origin: job.origin || null,
  };
}

app.get("/api/crons", (c) => {
  const { workspace } = getAgentFromQuery(c);
  const jobs = readCronJobs(workspace);
  return c.json({ crons: jobs.map(formatCronJob) });
});


app.post("/api/crons/:id/toggle", async (c) => {
  const { workspace } = getAgentFromQuery(c);
  const { id } = c.req.param();
  const { enabled } = await c.req.json();
  try {
    const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const port = config.gateway?.port || 18789;
    const token = config.gateway?.auth?.token || "";

    const resp = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "cron.update",
        params: { jobId: id, patch: { enabled } },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await resp.json() as any;
    if (result.error) {
      return c.json({ success: false, error: result.error.message }, 500);
    }
    return c.json({ success: true, job: result.result });
  } catch (e: any) {
    // Fallback to direct file write
    const jobs = readCronJobs(workspace);
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1) return c.json({ error: "Job not found" }, 404);
    jobs[idx].enabled = enabled;
    const ok = writeCronJobs(workspace, jobs);
    return c.json({ success: ok, job: formatCronJob(jobs[idx]) });
  }
});

app.post("/api/crons/:id/run", async (c) => {
  const { id } = c.req.param();
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return c.json({ error: "Invalid cron job id" }, 400);
  }
  const { agentId, workspace } = getAgentFromQuery(c);
  const isHermes = agentId.startsWith("hermes:");

  try {
    const { execSync } = await import("child_process");

    if (isHermes) {
      // Use hermes CLI
      const result = execSync(`hermes cron run ${id}`, {
        timeout: 12000,
        encoding: "utf-8",
      }).trim();
      return c.json({ success: true, result });
    } else {
      // OpenClaw CLI trigger
      const result = execSync(`openclaw cron run ${id}`, {
        timeout: 12000,
        encoding: "utf-8",
      }).trim();
      const parsed = JSON.parse(result) as any;
      return c.json({ success: !!parsed.ok, result: parsed }, parsed.ok ? 200 : 500);
    }
  } catch (e: any) {
    const stderr = e.stderr?.trim() || e.message;
    return c.json({ success: false, error: stderr }, 500);
  }
});

// ---------------------------------------------------------------------------
// Hermes System Features — read config.yaml + CLI stats
// ---------------------------------------------------------------------------
function buildHermesSystemCrons(workspace: string) {
  const systemCrons: any[] = [];
  const hermesHome = os.homedir() + "/.hermes";
  const configPath = path.join(hermesHome, "config.yaml");

  let config: any = {};
  if (fs.existsSync(configPath)) {
    try { config = parseYaml(fs.readFileSync(configPath, "utf-8")); } catch {}
  }

  // 1. Environment / Model
  const model = config.model?.default || "unknown";
  const provider = config.model?.provider || "unknown";
  const baseUrl = config.model?.base_url || "";
  systemCrons.push({
    id: "her-env",
    name: "🤖 Модель и провайдер",
    type: "environment",
    schedule: model,
    enabled: true,
    description: `Провайдер: ${provider}${baseUrl ? " | " + baseUrl : ""}`,
  });

  // 2. Messaging platforms
  const platforms = config.platforms || {};
  const enabledPlatforms = Object.entries(platforms)
    .filter(([_, v]: any) => v.enabled !== false)
    .map(([k]) => k);
  const telegramHome = platforms.telegram?.home || "";
  systemCrons.push({
    id: "her-platforms",
    name: "📱 Платформы",
    type: "platforms",
    schedule: enabledPlatforms.join(", ") || "нет",
    enabled: enabledPlatforms.length > 0,
    description: telegramHome ? `Telegram home: ${telegramHome}` : `Активных: ${enabledPlatforms.length}`,
  });

  // 3. Sessions config
  const sessions = config.sessions || {};
  systemCrons.push({
    id: "her-sessions",
    name: "🗃️ Сессии",
    type: "sessions",
    schedule: sessions.auto_prune ? `Автоочистка (${sessions.retention_days || 90}д)` : "Автоочистка выкл",
    enabled: true,
    description: `Хранение: ${sessions.retention_days || 90} дней | Vacuum: ${sessions.vacuum_after_prune ? "да" : "нет"}`,
  });

  // 4. Checkpoints
  const cp = config.checkpoints || {};
  systemCrons.push({
    id: "her-checkpoints",
    name: "📸 Контрольные точки",
    type: "checkpoints",
    schedule: cp.enabled ? `Макс ${cp.max_snapshots || 50} шт` : "Отключено",
    enabled: cp.enabled !== false,
    description: `Retention: ${cp.retention_days || 7}д | Auto-prune: ${cp.auto_prune ? "да" : "нет"}`,
  });

  // 5. Memory
  const mem = config.memory || {};
  systemCrons.push({
    id: "her-memory",
    name: "🧠 Память",
    type: "memory",
    schedule: mem.memory_enabled !== false ? "Включено" : "Отключено",
    enabled: mem.memory_enabled !== false,
    description: `Лимит: ${mem.memory_char_limit || 2200} симв | Профиль: ${mem.user_char_limit || 1375} симв`,
  });

  // 6. TTS
  const tts = config.tts || {};
  systemCrons.push({
    id: "her-tts",
    name: "🎙️ Озвучка (TTS)",
    type: "tts",
    schedule: tts.provider || "edge",
    enabled: true,
    description: tts.provider === "elevenlabs"
      ? `ElevenLabs: ${tts.elevenlabs?.voice_id || "-"}`
      : tts.provider === "openai"
        ? `OpenAI: ${tts.openai?.voice || "alloy"} (${tts.openai?.model || "gpt-4o-mini-tts"})`
        : `Edge: ${tts.edge?.voice || "en-US-AriaNeural"}`,
  });

  // 7. Delegation
  const deleg = config.delegation || {};
  systemCrons.push({
    id: "her-delegation",
    name: "🔀 Делегирование",
    type: "delegation",
    schedule: deleg.model || "наследует основную",
    enabled: true,
    description: `Макс итераций: ${deleg.max_iterations || 50} | Таймаут: ${deleg.child_timeout_seconds || 600}с | Concurrent: ${deleg.max_concurrent_children || 3}`,
  });

  // 8. Security
  const sec = config.security || {};
  systemCrons.push({
    id: "her-security",
    name: "🔒 Безопасность",
    type: "security",
    schedule: sec.tirith_enabled !== false ? "Tirith вкл" : "Tirith выкл",
    enabled: sec.tirith_enabled !== false,
    description: `Приватные URL: ${sec.allow_private_urls ? "разрешены" : "заблокированы"} | Secrets redact: ${sec.redact_secrets ? "да" : "нет"}`,
  });

  // 9. Cron scheduler
  const cron = config.cron || {};
  systemCrons.push({
    id: "her-cron-scheduler",
    name: "⏰ Планировщик кронов",
    type: "cron-scheduler",
    schedule: `Wrap: ${cron.wrap_response !== false ? "да" : "нет"}`,
    enabled: true,
    description: `Max parallel: ${cron.max_parallel_jobs || "auto"}`,
  });

  // 10. Session stats (live from CLI)
  try {
    const statsRaw = execSync("/usr/local/lib/hermes-agent/venv/bin/hermes sessions stats 2>&1", { timeout: 5000, encoding: "utf-8" });
    const sessionsMatch = statsRaw.match(/Total sessions:\s+(\d+)/);
    const messagesMatch = statsRaw.match(/Total messages:\s+([\d,]+)/);
    const dbSizeMatch = statsRaw.match(/Database size:\s+([\d.]+ \w+)/);
    systemCrons.push({
      id: "her-stats",
      name: "📊 Статистика",
      type: "stats",
      schedule: sessionsMatch ? `${sessionsMatch[1]} сессий` : "-",
      enabled: true,
      description: `Сообщений: ${messagesMatch?.[1] || "-"} | БД: ${dbSizeMatch?.[1] || "-"}`,
    });
  } catch {
    systemCrons.push({
      id: "her-stats",
      name: "📊 Статистика",
      type: "stats",
      schedule: "недоступно",
      enabled: false,
      description: "Не удалось получить данные",
    });
  }

  return systemCrons;
}

// System Crons API — heartbeat, compaction, pruning, session cleanup
// ---------------------------------------------------------------------------
app.get("/api/system-crons", (c) => {
  try {
    const { workspace } = getAgentFromQuery(c);
    // Try agent config — could be OpenClaw or Hermes
    const configPath = path.join(workspace, "openclaw.json");
    if (!fs.existsSync(configPath)) {
      // Hermes agent — read from config.yaml + CLI
      return c.json({ systemCrons: buildHermesSystemCrons(workspace) });
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const defaults = config.agents?.defaults || {};
    const agentList = config.agents?.list || [];

    const systemCrons: any[] = [];

    // Heartbeat
    const hbEvery = defaults.heartbeat?.every || "disabled";
    systemCrons.push({
      id: "sys-heartbeat",
      name: "💓 Heartbeat",
      type: "heartbeat",
      schedule: hbEvery === "disabled" ? "Отключено" : `Каждые ${hbEvery}`,
      enabled: hbEvery !== "disabled",
      description: "Периодически будит агента для проверки HEARTBEAT.md",
      agents: agentList.map((a: any) => ({
        id: a.id,
        name: a.identity?.name || a.name || a.id,
        heartbeat: a.heartbeat?.every || hbEvery,
        enabled: (a.heartbeat?.every || hbEvery) !== "disabled",
      })),
    });

    // Compaction
    const compMode = defaults.compaction?.mode || "off";
    const flushEnabled = defaults.compaction?.memoryFlush?.enabled || false;
    const flushThreshold = defaults.compaction?.memoryFlush?.softThresholdTokens;
    systemCrons.push({
      id: "sys-compaction",
      name: "🗜️ Сжатие контекста",
      type: "compaction",
      schedule: "По запросу",
      enabled: compMode !== "off",
      description: `Режим: ${compMode}${flushEnabled ? ` | Memory flush: ${flushThreshold ? flushThreshold + " tokens" : "вкл"}` : ""}`,
    });

    // Context Pruning
    const pruneMode = defaults.contextPruning?.mode || "off";
    const pruneTTL = defaults.contextPruning?.ttl;
    systemCrons.push({
      id: "sys-context-pruning",
      name: "✂️ Обрезка контекста",
      type: "context-pruning",
      schedule: pruneTTL ? `TTL ${pruneTTL}` : "По запросу",
      enabled: pruneMode !== "off",
      description: `Режим: ${pruneMode}${pruneTTL ? ` | TTL: ${pruneTTL}` : ""}`,
    });

    // Session cleanup
    systemCrons.push({
      id: "sys-session-cleanup",
      name: "🗑️ Очистка сессий",
      type: "session-cleanup",
      schedule: "Авто",
      enabled: true,
      description: "Автоматически удаляет устаревшие сессии",
    });

    // QMD Memory refresh
    const qmd = config.memory?.qmd;
    if (qmd && config.memory?.backend === "qmd") {
      systemCrons.push({
        id: "sys-qmd-refresh",
        name: "🧠 QMD индекс памяти",
        type: "qmd",
        schedule: qmd.update?.interval ? `Каждые ${qmd.update.interval}` : "Вручную",
        enabled: true,
        description: `Фоновое обновление: ${qmd.update?.onBoot ? "при запуске + " : ""}${qmd.update?.interval || "вручную"}`,
      });
    }

    return c.json({ systemCrons });
  } catch (e: any) {
    return c.json({ systemCrons: [] });
  }
});

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
if (fs.existsSync(STATIC_DIR)) {
  app.use("/assets/*", serveStatic({
    root: STATIC_DIR,
    rewriteRequestPath: (p) => p,
  }));
  app.use("*", serveStatic({ root: STATIC_DIR }));
  // SPA fallback
  app.get("*", (c) => {
    const html = fs.readFileSync(path.join(STATIC_DIR, "index.html"), "utf-8");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    return c.html(html);
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== 'test') {
  const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
    console.log(`📝 Memory Viewer running at http://localhost:${info.port}`);
    console.log(`📂 Default Workspace: ${DEFAULT_WORKSPACE}`);
  });
  injectWebSocket(server);
}
