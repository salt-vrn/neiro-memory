/**
 * Auth middleware for Memory Viewer
 * 
 * Uses bcrypt hash stored in AUTH_HASH env var.
 * Token-based auth: login returns a bearer token stored in localStorage.
 * Sessions stored in-memory (Map) with 24h TTL.
 */
import type { Context, Next } from "hono";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const AUTH_FILE = path.join(os.homedir(), ".hermes", ".memory-viewer-auth");

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ATTEMPTS = 3;
const BAN_WINDOW = 5 * 60 * 1000; // 5 minutes

// In-memory session store: token -> expiry timestamp
const sessions = new Map<string, number>();

// Rate limiting: IP -> { attempts, firstAttempt, bannedUntil }
const loginAttempts = new Map<string, { attempts: number; firstAttempt: number; bannedUntil: number }>();

function checkRateLimit(ip: string): { blocked: boolean; retryAfter?: number } {
  const entry = loginAttempts.get(ip);
  if (!entry) return { blocked: false };

  // Ban expired? Reset
  if (entry.bannedUntil && Date.now() > entry.bannedUntil) {
    loginAttempts.delete(ip);
    return { blocked: false };
  }

  // Currently banned
  if (entry.bannedUntil && Date.now() <= entry.bannedUntil) {
    return { blocked: true, retryAfter: Math.ceil((entry.bannedUntil - Date.now()) / 1000) };
  }

  // Window expired? Reset
  if (Date.now() - entry.firstAttempt > BAN_WINDOW) {
    loginAttempts.delete(ip);
    return { blocked: false };
  }

  return { blocked: false };
}

function recordFailure(ip: string) {
  const entry = loginAttempts.get(ip);
  if (!entry) {
    loginAttempts.set(ip, { attempts: 1, firstAttempt: Date.now(), bannedUntil: 0 });
    return;
  }
  entry.attempts++;
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.bannedUntil = Date.now() + BAN_WINDOW;
  }
}

function clearAttempts(ip: string) {
  loginAttempts.delete(ip);
}

// Clean expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  sessions.forEach((expiry, token) => {
    if (now > expiry) sessions.delete(token);
  });
}, 10 * 60 * 1000);

/**
 * Returns the bcrypt hash — from file first, then env var, or null if auth is disabled.
 */
function getAuthHash(): string | null {
  // File takes priority (written by password change)
  if (fs.existsSync(AUTH_FILE)) {
    try {
      return fs.readFileSync(AUTH_FILE, "utf-8").trim() || null;
    } catch { /* fall through */ }
  }
  return process.env.AUTH_HASH || null;
}

/**
 * Creates a new session and returns the token.
 */
export function createSession(): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

/**
 * Validates a session token.
 */
function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function now(): number { return Date.now(); }

/**
 * Extracts token from Authorization header or query param.
 */
function extractToken(c: Context): string | undefined {
  // Check Authorization header first
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  // Fallback to query param (for WebSocket etc.)
  const url = new URL(c.req.url);
  return url.searchParams.get("token") || undefined;
}

/**
 * Auth middleware — protects all routes except /api/login and static assets.
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHash = getAuthHash();

  // If no AUTH_HASH set, skip auth entirely (open mode)
  if (!authHash) {
    return next();
  }

  const url = new URL(c.req.url);
  const pathname = url.pathname;

  // Public routes: login endpoint and auth status
  if (
    pathname === "/api/login" ||
    pathname === "/api/auth/status"
  ) {
    return next();
  }

  // Allow static assets to load without auth
  if (
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".woff") ||
    pathname.endsWith(".woff2")
  ) {
    return next();
  }

  // Check token from Authorization header
  const token = extractToken(c);
  if (isValidSession(token)) {
    return next();
  }

  // For API and WebSocket requests, return 401 JSON
  if (pathname.startsWith("/api/") || pathname === "/ws") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // For page requests, serve the SPA — the frontend handles the rest
  return next();
}

/**
 * Login route handler.
 */
export async function handleLogin(c: Context) {
  const authHash = getAuthHash();
  if (!authHash) {
    return c.json({ error: "Auth not configured" }, 400);
  }

  // Rate limiting
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
  const limit = checkRateLimit(ip);
  if (limit.blocked) {
    return c.json({ error: `Too many attempts. Try again in ${limit.retryAfter}s` }, 429);
  }

  const body = await c.req.json<{ password: string }>();
  if (!body.password) {
    return c.json({ error: "Password required" }, 400);
  }

  const valid = bcrypt.compareSync(body.password, authHash);
  if (!valid) {
    recordFailure(ip);
    return c.json({ error: "Invalid password" }, 401);
  }

  // Success — clear failed attempts
  clearAttempts(ip);
  const token = createSession();

  return c.json({ success: true, token });
}

/**
 * Logout route handler.
 */
export async function handleLogout(c: Context) {
  const token = extractToken(c);
  if (token) sessions.delete(token);
  return c.json({ success: true });
}

/**
 * Auth status route handler.
 */
export async function handleAuthStatus(c: Context) {
  const authHash = getAuthHash();
  if (!authHash) {
    return c.json({ authRequired: false, authenticated: true });
  }

  const token = extractToken(c);
  const authenticated = isValidSession(token);

  return c.json({ authRequired: true, authenticated });
}

/**
 * Change password route handler.
 * Requires current password, saves new bcrypt hash to file.
 */
export async function handleChangePassword(c: Context) {
  const authHash = getAuthHash();
  if (!authHash) {
    return c.json({ error: "Auth not configured" }, 400);
  }

  const body = await c.req.json<{ currentPassword: string; newPassword: string }>();
  if (!body.currentPassword || !body.newPassword) {
    return c.json({ error: "Both currentPassword and newPassword required" }, 400);
  }

  if (body.newPassword.length < 8) {
    return c.json({ error: "New password must be at least 8 characters" }, 400);
  }

  // Verify current password
  const valid = bcrypt.compareSync(body.currentPassword, authHash);
  if (!valid) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  // Hash new password and write to file
  const newHash = bcrypt.hashSync(body.newPassword, 12);
  try {
    fs.writeFileSync(AUTH_FILE, newHash, "utf-8");
  } catch (e: any) {
    return c.json({ error: `Failed to save: ${e.message}` }, 500);
  }

  return c.json({ success: true });
}
