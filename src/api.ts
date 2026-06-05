/** API client for Memory Viewer backend. */

// Derive base path from Vite's base config (e.g. '/memory-viewer/')
const _basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
let _baseUrl = "";
let _currentAgent: string | null = null;

// Token management
const TOKEN_KEY = "mv_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export function getCurrentAgent(): string | null { return _currentAgent; }
export function setCurrentAgent(agentId: string | null) { _currentAgent = agentId; }

function buildUrl(endpoint: string, params?: Record<string, string>): string {
  const base = _baseUrl || (window.location.origin + _basePath);
  const url = new URL(`${base}${endpoint}`);
  if (_currentAgent) url.searchParams.set("agent", _currentAgent);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// --- Types ---
export interface FileNode { name: string; type: "file" | "dir"; path: string; children?: FileNode[]; }
export interface FileData { content: string; mtime: string; size: number; }
export interface SystemInfo { uptime: number; memTotal: number; memFree: number; memUsed: number; load: number[]; platform: string; hostname: string; totalFiles: number; }
export interface SearchResult { path: string; matches: { line: number; text: string }[]; }
export interface SkillInfo { id: string; name: string; description: string; path: string; }
export interface AgentInfo { id: string; name: string; type: "hermes" | "openclaw"; workspace: string; extraPaths: string[]; emoji: string; skills?: string[]; }
export interface SaveResult { ok: boolean; mtime: string; }
export interface ConflictResult { error: "conflict"; message: string; serverMtime: string; serverContent: string; }
export interface RecentFile { path: string; mtime: number; size: number; }
export interface TagInfo { name: string; count: number; files: string[]; }
export interface FileWithTags { path: string; title: string; preview: string; date: string; tags: string[]; }
export interface AgentStatus { config: any; gateway: any; heartbeat: any; }
export interface CronJob { id: string; name: string; enabled: boolean; schedule: string; scheduleRaw: any; nextRun: string | null; lastRun: string | null; lastStatus: string | null; sessionTarget: string; wakeMode: string; payloadKind: string; deliveryMode: string; }
export interface SystemCron { id: string; name: string; type: string; schedule: string; enabled: boolean; description: string; agents?: { id: string; name: string; heartbeat: string; enabled: boolean }[]; }

// --- API Functions ---

export async function fetchAgents(): Promise<AgentInfo[]> {
  const r = await fetch(buildUrl("/api/agents"), { headers: authHeaders() });
  if (!r.ok) throw new Error("Failed to load agents");
  return r.json();
}

export async function fetchSkills(): Promise<SkillInfo[]> {
  const r = await fetch(buildUrl("/api/skills"), { headers: authHeaders() });
  return r.json();
}

export async function fetchFiles(): Promise<FileNode[]> {
  const r = await fetch(buildUrl("/api/files"), { headers: authHeaders() });
  return r.json();
}

export async function fetchFile(path: string): Promise<FileData> {
  const r = await fetch(buildUrl("/api/file", { path }), { headers: authHeaders() });
  if (!r.ok) throw new Error("Failed to load file");
  return r.json();
}

export async function saveFile(path: string, content: string, expectedMtime?: string): Promise<SaveResult | ConflictResult> {
  const r = await fetch(buildUrl("/api/file"), {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path, content, expectedMtime }),
  });
  return r.json();
}

export async function fetchSystem(): Promise<SystemInfo> {
  const r = await fetch(buildUrl("/api/system"), { headers: authHeaders() });
  return r.json();
}

export async function searchFiles(query: string): Promise<SearchResult[]> {
  const r = await fetch(buildUrl("/api/search", { q: query }), { headers: authHeaders() });
  return r.json();
}

export async function fetchTags(): Promise<TagInfo[]> {
  const r = await fetch(buildUrl("/api/tags"), { headers: authHeaders() });
  return r.json();
}

export async function fetchFilesByTag(tag: string): Promise<FileWithTags[]> {
  const r = await fetch(buildUrl(`/api/files-by-tag/${encodeURIComponent(tag)}`), { headers: authHeaders() });
  return r.json();
}

export async function fetchRecent(limit = 10): Promise<RecentFile[]> {
  const r = await fetch(buildUrl("/api/recent", { limit: String(limit) }), { headers: authHeaders() });
  return r.json();
}

export async function fetchAgentStatus(): Promise<AgentStatus> {
  const r = await fetch(buildUrl("/api/agent/status"), { headers: authHeaders() });
  return r.json();
}

// --- Cron API ---

export async function fetchSystemCrons(): Promise<SystemCron[]> {
  const r = await fetch(buildUrl("/api/system-crons"), { headers: authHeaders() });
  const data = await r.json();
  return data.systemCrons || [];
}

export async function fetchCronJobs(): Promise<CronJob[]> {
  const r = await fetch(buildUrl("/api/crons"), { headers: authHeaders() });
  const data = await r.json();
  return data.crons || [];
}

export async function toggleCronJob(jobId: string, enabled: boolean): Promise<{ success: boolean }> {
  const r = await fetch(buildUrl(`/api/crons/${jobId}/toggle`), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ enabled }),
  });
  return r.json();
}

export async function runCronJob(jobId: string): Promise<{ success: boolean; result?: string; error?: string }> {
  const r = await fetch(buildUrl(`/api/crons/${jobId}/run`), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
  });
  return r.json();
}


