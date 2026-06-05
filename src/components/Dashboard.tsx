import { useEffect, useState, useContext } from "react";
import { fetchSystem, fetchRecent, fetchAgents, type SystemInfo, type RecentFile, type AgentInfo, type FileNode } from "../api";
import { SquaresFour, FileText, Clock, Lightning, Robot, Folder } from "@phosphor-icons/react";
import { LocaleContext } from "../hooks/useLocale";


function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  parts.push(`${h}h ${m}m`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
}

function timeAgo(mtime: number, t: (key: string) => string): string {
  const diff = Date.now() - mtime;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t("dashboard.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${t("dashboard.minAgo")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t("dashboard.hAgo")}`;
  const days = Math.floor(hours / 24);
  return `${days}${t("dashboard.dAgo")}`;
}

const PINNED_FILES = ["MEMORY.md", "SOUL.md", "USER.md", "AGENTS.md"];

/** Recursively collect all file paths from the tree */
function collectPaths(nodes: FileNode[]): string[] {
  const result: string[] = [];
  for (const n of nodes) {
    if (n.type === "file") result.push(n.path);
    if (n.children) result.push(...collectPaths(n.children));
  }
  return result;
}

export function Dashboard({ onOpenFile, files }: { onOpenFile: (path: string) => void; files: FileNode[] }) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const { t } = useContext(LocaleContext);

  useEffect(() => {
    fetchSystem().then(setInfo).catch(console.error);
    fetchRecent(10).then(setRecent).catch(console.error);
    fetchAgents().then(setAgents).catch(console.error);
  }, []);

  if (!info) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--text-faint)" }}>
        <div className="w-5 h-5 border-2 border-t-blue-400 rounded-full animate-spin mr-3" style={{ borderColor: "var(--border)" }} />
        {t("dashboard.loading")}
      </div>
    );
  }

  const memPercent = ((info.memUsed / info.memTotal) * 100).toFixed(1);

  // Quick access: pinned + recent files not in pinned
  const recentQuick = recent
    .map((r) => r.path)
    .filter((p) => !PINNED_FILES.includes(p))
    .slice(0, 4);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
        <SquaresFour className="w-7 h-7 text-blue-400" /> {t("dashboard.title")}
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={t("dashboard.uptime")} value={formatUptime(info.uptime)} />
        <StatCard label={t("dashboard.memory")} value={`${memPercent}%`} sub={`${formatBytes(info.memUsed)} / ${formatBytes(info.memTotal)}`} />
        <StatCard label={t("dashboard.load")} value={info.load[0].toFixed(2)} sub={info.load.map((l) => l.toFixed(2)).join(" · ")} />
        <StatCard label={t("dashboard.files")} value={String(info.totalFiles)} sub={t("dashboard.mdTracked")} />
      </div>

      {/* Host info */}
      <div className="text-sm flex items-center gap-2" style={{ color: "var(--text-faint)" }}>
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
        {info.hostname} · {info.platform}
      </div>

      {/* Agents Overview */}
      {agents.length > 1 && (
        <section className="rounded-xl p-5" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4" style={{ color: "var(--text-primary)" }}>
            <Robot className="w-5 h-5 text-blue-400" /> {t("dashboard.agents")}
            <span className="text-sm font-normal opacity-60 ml-2">{agents.length} {t("dashboard.configured")}</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-lg p-3 flex items-center gap-3"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
              >
                <span className="text-2xl">{agent.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {agent.name}
                  </div>
                  <div className="text-xs truncate flex items-center gap-1" style={{ color: "var(--text-faint)" }}>
                    <Folder className="w-3 h-3" />
                    {agent.workspace}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Two-column: Recently Modified + Monthly Stats */}
      <div className="grid grid-cols-1 gap-4">
        {/* Recently Modified */}
        <section className="rounded-xl p-5" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-3" style={{ color: "var(--text-primary)" }}>
            <Clock className="w-5 h-5 text-amber-400" /> {t("dashboard.recentlyModified")}
          </h2>
          <div className="space-y-1">
            {recent.slice(0, 5).map((f) => (
              <button
                key={f.path}
                onClick={() => onOpenFile(f.path)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/5"
                style={{ color: "var(--text-secondary)" }}
              >
                <span className="truncate mr-2" title={f.path}>
                  <FileText className="w-3.5 h-3.5 inline-block mr-1.5 opacity-50" />
                  {f.path}
                </span>
                <span className="text-xs whitespace-nowrap shrink-0" style={{ color: "var(--text-faint)" }}>
                  {timeAgo(f.mtime, t)}
                </span>
              </button>
            ))}
            {recent.length === 0 && (
              <p className="text-sm italic" style={{ color: "var(--text-faint)" }}>{t("dashboard.noFilesYet")}</p>
            )}
          </div>
        </section>
      </div>

      {/* Quick Access */}
      <section>
        <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-2" style={{ color: "var(--text-muted)" }}>
          <Lightning className="w-4 h-4" /> {t("dashboard.quickAccess")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {(() => {
            const allPaths = collectPaths(files);
            const pinned = PINNED_FILES.filter((f) => allPaths.some((p) => p.endsWith(f)));
            return pinned.map((f) => {
              const fullPath = allPaths.find((p) => p.endsWith(f))!;
              return (
                <button
                  key={f}
                  onClick={() => onOpenFile(fullPath)}
                  className="btn-secondary text-sm"
                >
                  📌 {f}
                </button>
              );
            });
          })()}
          {recentQuick.map((f) => (
            <button
              key={f}
              onClick={() => onOpenFile(f)}
              className="btn-secondary text-sm opacity-75"
            >
              🕐 {f.split("/").pop()}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
      <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>{label}</div>
      <div className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>{sub}</div>}
    </div>
  );
}
