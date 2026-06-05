import { useState, useContext } from "react";
import { Lock, Eye, EyeSlash } from "@phosphor-icons/react";
import { setAuthToken } from "../api";
import { LocaleContext } from "../hooks/useLocale";

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { locale, toggleLocale, t } = useContext(LocaleContext);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError("");

    try {
      const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
      const res = await fetch(`${basePath}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.token) {
        setAuthToken(data.token);
        onLogin();
      } else if (res.status === 429) {
        setError(t("login.tooManyAttempts"));
        setPassword("");
      } else {
        setError(t("login.invalidPassword"));
        setPassword("");
      }
    } catch {
      setError(t("login.connectionError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: "var(--bg-primary)" }}
    >
      <div
        className="w-full max-w-sm rounded-xl shadow-2xl p-8"
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        <div className="flex justify-center mb-6">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "var(--accent-bg, rgba(59,130,246,0.15))" }}
          >
            <Lock size={28} style={{ color: "var(--accent, #3b82f6)" }} />
          </div>
        </div>

        <h1
          className="text-xl font-semibold text-center mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          Neiro Memory
        </h1>
        <p
          className="text-sm text-center mb-6"
          style={{ color: "var(--text-faint)" }}
        >
          {t("login.enterPassword")}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="relative mb-4">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder={t("login.password")}
              autoFocus
              className="w-full px-4 py-3 pr-12 rounded-lg text-base outline-none transition-shadow"
              style={{
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                border: error
                  ? "1px solid #ef4444"
                  : "1px solid var(--border)",
              }}
              onFocus={(e) =>
                (e.currentTarget.style.boxShadow =
                  "0 0 0 2px rgba(59,130,246,0.3)")
              }
              onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
              style={{ color: "var(--text-faint)" }}
              tabIndex={-1}
            >
              {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {error && (
            <div className="text-sm text-red-400 mb-4 text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 rounded-lg text-sm font-medium transition-all"
            style={{
              background: loading
                ? "var(--bg-tertiary)"
                : "var(--accent, #3b82f6)",
              color: loading ? "var(--text-faint)" : "#fff",
              cursor: loading || !password ? "not-allowed" : "pointer",
              opacity: loading || !password ? 0.6 : 1,
            }}
          >
            {loading ? t("login.checking") : t("login.unlock")}
          </button>
        </form>

        {/* Locale toggle */}
        <div className="flex justify-center mt-4">
          <button
            onClick={toggleLocale}
            className="px-3 py-1 text-xs rounded transition-colors"
            style={{ color: "var(--text-faint)", background: "var(--bg-primary)" }}
          >
            {locale === "en" ? "RU" : "EN"}
          </button>
        </div>
      </div>
    </div>
  );
}
