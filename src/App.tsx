import { useEffect, useState, useCallback } from "react";
import { fetchFiles, fetchSkills, getAuthToken, clearAuthToken, type FileNode, type SkillInfo } from "./api";
import { FileTree } from "./components/FileTree";
import { FileViewer } from "./components/FileViewer";
import { Dashboard } from "./components/Dashboard";
import { SearchPanel } from "./components/SearchPanel";
import { LoginPage } from "./components/LoginPage";
import { SkillsPage } from "./components/SkillsPage";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { useSensitiveState, SensitiveProvider } from "./hooks/useSensitive";
import { useAgents } from "./hooks/useAgents";
import { AgentStatusPage } from "./components/AgentStatus";
import { Tags } from "./components/Tags";
import { CronManager } from "./components/CronManager";
import { BookOpen, X, List, MagnifyingGlass, Sun, Moon, Eye, EyeSlash, CaretDown, CaretUp, ArrowsClockwise, PuzzlePiece, CaretRight, SquaresFour, Tag, Timer, SignOut, Key } from "@phosphor-icons/react";
import { useResizableSidebar } from "./hooks/useResizableSidebar";
import { useLocaleState, LocaleContext } from "./hooks/useLocale";

export default function App() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [activeFile, setActiveFile] = useState("");
  const [view, setView] = useState<"dashboard" | "file" | "agent-status" | "skills" | "tags" | "cron">("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null); // null = loading
  const [quickAccessOpen, setQuickAccessOpen] = useState(() => {
    const stored = localStorage.getItem("memory-viewer-quickaccess-open");
    return stored === null ? true : stored === "true";
  });

  const { width: sidebarWidth, onMouseDown: onResizeMouseDown, onTouchStart: onResizeTouchStart } = useResizableSidebar();
  const { theme, toggle: toggleTheme } = useTheme();
  const sensitive = useSensitiveState();
  const localeState = useLocaleState();
  const { t, toggleLocale, locale } = localeState;
  const agentsState = useAgents();

  const loadFiles = useCallback(() => {
    fetchFiles().then(setFiles).catch(console.error);
    fetchSkills().then(setSkills).catch(console.error);
  }, []);

  // Reload files when agent changes or after auth completes
  useEffect(() => { 
    if (authenticated) {
      loadFiles();
      agentsState.refresh();
    }
  }, [loadFiles, agentsState.selectedAgentId, authenticated]);

  // Live reload via WebSocket
  useWebSocket((data: any) => {
    if (data.type === "file-change") {
      loadFiles();
      if (data.path === activeFile) {
        setRefreshKey((k) => k + 1);
      }
    }
  });

  // Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Close agent selector on outside click
  useEffect(() => {
    if (!agentSelectorOpen) return;
    const handler = () => setAgentSelectorOpen(false);
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [agentSelectorOpen]);

  // Check auth status on mount
  useEffect(() => {
    const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch(`${basePath}/api/auth/status`, { headers })
      .then((r) => r.json())
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  // Sync hash → state on load and popstate
  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/file/")) {
        const path = decodeURIComponent(hash.slice(7));
        if (path) {
          setActiveFile(path);
          setView("file");
          return;
        }
      }
      if (hash === "#/agent-status") { setView("agent-status"); return; }

      if (hash === "#/skills") { setView("skills"); return; }
      if (hash === "#/tags") { setView("tags"); return; }
      if (hash === "#/cron") { setView("cron"); return; }
    };
    readHash();
    window.addEventListener("popstate", readHash);
    return () => window.removeEventListener("popstate", readHash);
  }, []);

  const openFile = (path: string) => {
    setActiveFile(path);
    setView("file");
    setSidebarOpen(false);
    window.history.pushState(null, "", `#/file/${encodeURIComponent(path)}`);
  };

  const goHome = () => {
    setView("dashboard");
    setActiveFile("");
    setSidebarOpen(false);
    window.history.pushState(null, "", window.location.pathname);
  };

  const switchAgent = (agentId: string) => {
    agentsState.selectAgent(agentId);
    setAgentSelectorOpen(false);
    setView("dashboard");
    setActiveFile("");
    // Reload files for new agent
    setTimeout(() => loadFiles(), 0);
  };

  // Show agent selector when multiple agents available
  const showAgentSelector = agentsState.agents.length > 1;

  // Logout handler
  const handleLogout = async () => {
    const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    await fetch(`${basePath}/api/logout`, { method: "POST", headers });
    clearAuthToken();
    setAuthenticated(false);
  };

  // Change password
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async () => {
    setPwMsg(null);
    setPwLoading(true);
    try {
      const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
      const token = getAuthToken();
      const res = await fetch(`${basePath}/api/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      const data = await res.json();
      if (data.success) {
        setPwMsg({ type: "ok", text: "Пароль изменён" });
        setPwCurrent("");
        setPwNew("");
      } else {
        setPwMsg({ type: "err", text: data.error || "Ошибка" });
      }
    } catch (e: any) {
      setPwMsg({ type: "err", text: e.message });
    } finally {
      setPwLoading(false);
    }
  };

  // Show loading spinner while checking auth
  if (authenticated === null) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg-primary)" }}><div className="w-6 h-6 border-2 border-t-blue-400 rounded-full animate-spin" style={{ borderColor: "var(--border)" }} /></div>;
  }

  // Show login page if not authenticated
  if (!authenticated) {
    return (
      <LocaleContext.Provider value={localeState}>
      <LoginPage onLogin={() => setAuthenticated(true)} />
      </LocaleContext.Provider>
    );
  }

  return (
    <LocaleContext.Provider value={localeState}>
    <SensitiveProvider value={sensitive}>
    <div className={`flex ${sensitive.hidden ? "" : "sensitive-revealed"}`} style={{ background: "var(--bg-primary)", color: "var(--text-primary)", height: "100vh", overflow: "hidden" }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar - Redesigned */}
      <aside
        className={`sidebar fixed z-40 lg:static lg:z-auto inset-y-0 left-0 w-60 border-r flex flex-col shrink-0 transition-transform duration-200 lg:relative ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        style={{ width: window.innerWidth >= 1024 ? `${sidebarWidth}px` : undefined }}
      >
        {/* Header - Minimal */}
        <div className="sidebar-header px-3 py-2.5 border-b flex items-center justify-between">
          <button onClick={goHome} className="text-sm font-semibold hover:text-blue-400 transition-colors flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
            <BookOpen className="w-4 h-4" /> Neiro Memory
          </button>
          <div className="flex items-center gap-0.5">
            {/* Mobile close */}
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1.5" style={{ color: "var(--text-muted)" }}>
              <X className="w-4 h-4" />
            </button>
            {/* 3 tool buttons directly in header */}
            <button onClick={() => window.location.reload()} className="p-1.5 rounded-md transition-colors hover:bg-white/10" style={{ color: "var(--text-muted)" }} title="Refresh">
              <ArrowsClockwise className="w-4 h-4" />
            </button>
            <button onClick={sensitive.toggle} className="p-1.5 rounded-md transition-colors hover:bg-white/10" style={{ color: "var(--text-muted)" }} title={sensitive.hidden ? t("sidebar.showSensitive") : t("sidebar.hideSensitive")}>
              {sensitive.hidden ? <EyeSlash className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button onClick={toggleTheme} className="p-1.5 rounded-md transition-colors hover:bg-white/10" style={{ color: "var(--text-muted)" }} title={theme === "dark" ? t("sidebar.lightMode") : t("sidebar.darkMode")}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={toggleLocale} className="p-1.5 rounded-md transition-colors hover:bg-white/10 text-[11px] font-bold" style={{ color: "var(--text-muted)" }} title={locale === "en" ? "Переключить на русский" : "Switch to English"}>
              {locale === "en" ? "RU" : "EN"}
            </button>
          </div>
        </div>

        {/* Search - Compact */}
        <button
          onClick={() => setSearchOpen(true)}
          className="search-trigger mx-2 mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors"
        >
          <MagnifyingGlass className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">{t("sidebar.search")}</span>
          <kbd className="text-[10px] px-1 py-0.5 rounded border opacity-60" style={{ background: "var(--bg-hover)", borderColor: "var(--border)" }}>
            ⌘K
          </kbd>
        </button>

        {/* Agent Selector */}
        {showAgentSelector && (
          <div className="mx-2 mt-2 relative">
            <button
              onClick={(e) => { e.stopPropagation(); setAgentSelectorOpen(!agentSelectorOpen); }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors hover:bg-white/5"
              style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
            >
              <span className="text-base">{agentsState.selectedAgent?.emoji || "🤖"}</span>
              <span className="truncate flex-1 text-left text-xs font-medium">{agentsState.selectedAgent?.name || "Select Agent"}</span>
              {agentSelectorOpen ? <CaretUp className="w-3 h-3 shrink-0" /> : <CaretDown className="w-3 h-3 shrink-0" />}
            </button>

            {agentSelectorOpen && (
              <div
                className="absolute left-0 right-0 top-full mt-1 rounded-lg shadow-xl z-50 py-1 max-h-80 overflow-y-auto"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
                onClick={(e) => e.stopPropagation()}
              >
                {agentsState.agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => switchAgent(agent.id)}
                    className="w-full flex flex-col px-3 py-2 text-sm transition-colors hover:bg-white/5"
                    style={{ color: agent.id === agentsState.selectedAgentId ? "#3b82f6" : "var(--text-secondary)" }}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <span className="text-base">{agent.emoji}</span>
                      <span className="truncate flex-1 text-left font-medium">{agent.name}</span>
                      {agent.id === agentsState.selectedAgentId && <span className="text-xs">✓</span>}
                    </div>
                    {agent.skills && agent.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1 ml-7">
                        {agent.skills.map((skill) => (
                          <span
                            key={skill}
                            className="text-[10px] px-1.5 py-0.5 rounded-full"
                            style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quick Access - Collapsible */}
        <div className="mx-2 mt-2">
          <button
            onClick={() => {
              const newState = !quickAccessOpen;
              setQuickAccessOpen(newState);
              localStorage.setItem("memory-viewer-quickaccess-open", String(newState));
            }}
            className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors hover:text-blue-400"
            style={{ color: "var(--text-muted)" }}
          >
            {t("sidebar.quickAccess") || "Quick Access"}
            {quickAccessOpen ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
          </button>
          {quickAccessOpen && (
          <div className="flex flex-col">
            <button
              onClick={goHome}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-white/5"
              style={{
                color: view === "dashboard" ? "var(--link)" : "var(--text-secondary)",
                background: view === "dashboard" ? "var(--bg-active)" : undefined,
              }}
            >
              <SquaresFour className="w-4 h-4 text-blue-400" />
              {t("dashboard.title")}
            </button>
            <button
              onClick={() => { setView("tags"); setSidebarOpen(false); window.history.pushState(null, "", "#/tags"); }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-white/5"
              style={{
                color: view === "tags" ? "var(--link)" : "var(--text-secondary)",
                background: view === "tags" ? "var(--bg-active)" : undefined,
              }}
            >
              <Tag className="w-4 h-4 text-pink-400" />
              {t("sidebar.tags") || "Tags"}
            </button>
            <button
              onClick={() => { setView("cron"); setSidebarOpen(false); window.history.pushState(null, "", "#/cron"); }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-white/5"
              style={{
                color: view === "cron" ? "var(--link)" : "var(--text-secondary)",
                background: view === "cron" ? "var(--bg-active)" : undefined,
              }}
            >
              <Timer className="w-4 h-4 text-indigo-400" />
              {t("sidebar.cron")}
            </button>
            {skills.length > 0 && (
              <button
                onClick={() => { setView("skills"); setSidebarOpen(false); window.history.pushState(null, "", "#/skills"); }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-white/5"
                style={{
                  color: view === "skills" ? "var(--link)" : "var(--text-secondary)",
                  background: view === "skills" ? "var(--bg-active)" : undefined,
                }}
              >
                <PuzzlePiece className="w-4 h-4 text-purple-400" />
                {t("sidebar.skills")}
                <span className="ml-auto text-[10px] opacity-50">{skills.length}</span>
              </button>
            )}
          </div>
          )}
        </div>

        {/* File Browser - Main content area */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <FileTree nodes={files} activeFile={activeFile} onSelect={openFile} />
        </div>

        {/* Change Password + Logout - Bottom */}
        <div className="border-t px-2 py-2" style={{ borderColor: "var(--border)" }}>
          {/* Password toggle */}
          <button
            onClick={() => setPwOpen(!pwOpen)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-white/5"
            style={{ color: "var(--text-secondary)" }}
          >
            <Key className="w-4 h-4" />
            <span className="text-xs">Сменить пароль</span>
            {pwOpen ? <CaretUp className="w-3 h-3 ml-auto opacity-50" /> : <CaretDown className="w-3 h-3 ml-auto opacity-50" />}
          </button>

          {/* Password form */}
          {pwOpen && (
            <div className="mt-1.5 px-1 flex flex-col gap-1.5">
              <input
                type="password"
                placeholder="Текущий пароль"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border bg-transparent outline-none focus:border-blue-400"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
              <input
                type="password"
                placeholder="Новый пароль"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border bg-transparent outline-none focus:border-blue-400"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
              <button
                onClick={handleChangePassword}
                disabled={pwLoading || !pwCurrent || !pwNew}
                className="w-full px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                {pwLoading ? "..." : "Сменить"}
              </button>
              {pwMsg && (
                <div className={`text-[10px] px-1 ${pwMsg.type === "ok" ? "text-green-400" : "text-red-400"}`}>
                  {pwMsg.text}
                </div>
              )}
            </div>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 rounded-md text-sm transition-colors hover:bg-white/5"
            style={{ color: "var(--text-secondary)" }}
          >
            <SignOut className="w-4 h-4" />
            <span className="text-xs">Logout</span>
          </button>
        </div>

        {/* Resize handle - wider touch target on tablet */}
        <div
          className="hidden lg:block absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors touch-none"
          style={{ zIndex: 50 }}
          onMouseDown={onResizeMouseDown}
          onTouchStart={onResizeTouchStart}
        />
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-2.5 border-b backdrop-blur shrink-0" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <button onClick={() => setSidebarOpen(true)} style={{ color: "var(--text-muted)" }}>
            <List className="w-6 h-6" />
          </button>
          <span className="text-sm font-medium truncate">
            {view === "file" ? activeFile : view === "agent-status" ? t("sidebar.agentConfig") : view === "tags" ? t("tags.title") : view === "cron" ? t("cron.title") : t("dashboard.title")}
          </span>
          <button onClick={() => window.location.reload()} className="ml-auto p-1" style={{ color: "var(--text-muted)" }} title="Refresh">
            <ArrowsClockwise className="w-5 h-5" />
          </button>
          <button onClick={sensitive.toggle} className="p-1" style={{ color: "var(--text-muted)" }}>
            {sensitive.hidden ? <EyeSlash className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
          <button onClick={toggleTheme} className="p-1" style={{ color: "var(--text-muted)" }}>
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button onClick={() => setSearchOpen(true)} style={{ color: "var(--text-muted)" }}>
            <MagnifyingGlass className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {view === "agent-status" ? (
            <AgentStatusPage />
          ) : view === "skills" ? (
            <SkillsPage skills={skills} onOpenFile={openFile} />
          ) : view === "tags" ? (
            <div className="h-full overflow-auto">
              <Tags onOpenFile={openFile} />
            </div>
          ) : view === "cron" ? (
            <CronManager />
          ) : view === "dashboard" ? (
            <div className="h-full overflow-auto">
              <Dashboard onOpenFile={openFile} files={files} />
            </div>
          ) : (
            <FileViewer filePath={activeFile} refreshKey={refreshKey} onOpenFile={openFile} />
          )}
        </div>
      </main>

      {/* Search modal */}
      {searchOpen && (
        <SearchPanel onSelect={openFile} onClose={() => setSearchOpen(false)} />
      )}
    </div>
    </SensitiveProvider>
    </LocaleContext.Provider>
  );
}
