// `.env` is the deployment config and ARCHITECTURE §13's source of truth, so the scripts read it
// from disk rather than trusting a shell that may still export an old value — and they patch it in
// place when a run creates something (a DAO address, an X25519 secret) the next run must reuse.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type EnvMap = Record<string, string>;

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const unquote = (raw: string): string => {
  const quote = raw.charAt(0);
  if ((quote === '"' || quote === "'") && raw.length > 1) {
    const end = raw.lastIndexOf(quote);
    return end > 0 ? raw.slice(1, end) : raw.slice(1);
  }
  const comment = raw.indexOf(" #");
  return (comment === -1 ? raw : raw.slice(0, comment)).trimEnd();
};

/** The subset of dotenv the repo's own `.env.example` uses: comments, `export`, quoting, trailing `# …`. */
export const parseDotEnv = (text: string): EnvMap => {
  const parsed: EnvMap = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq);
    if (!KEY.test(key)) continue;
    parsed[key] = unquote(body.slice(eq + 1).trim());
  }
  return parsed;
};

/** Replaces existing lines and appends missing keys; every other byte of the file is preserved. */
export const patchEnvText = (text: string, values: Record<string, string>): string => {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    if (!KEY.test(key)) throw new RangeError(`not an env var name: ${key}`);
    const line = `${key}=${value}`;
    const existing = new RegExp(`^${key}=.*$`, "m");
    out = existing.test(out) ? out.replace(existing, () => line) : `${out.replace(/\n+$/, "")}\n${line}\n`;
  }
  return out.endsWith("\n") ? out : `${out}\n`;
};

/** Walks up to the pnpm workspace root so a linked worktree or an `exec` cwd still finds its own `.env`. */
export const workspaceRoot = (from: string = dirname(fileURLToPath(import.meta.url))): string => {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no pnpm workspace root above ${from}`);
    dir = parent;
  }
};

export interface LoadedEnv {
  readonly path: string;
  readonly env: EnvMap;
}

export const loadEnv = (root: string = workspaceRoot()): LoadedEnv => {
  const path = process.env.ENV_FILE ?? join(root, ".env");
  if (!existsSync(path)) {
    throw new Error(`no .env at ${path} — copy .env.example and fill it in (S-0.9 created the accounts)`);
  }
  return { path, env: parseDotEnv(readFileSync(path, "utf8")) };
};

/** Writes back only the keys that changed, at mode 0600 — this file holds private keys. */
export const saveEnv = (path: string, values: Record<string, string>): string[] => {
  const before = parseDotEnv(readFileSync(path, "utf8"));
  const changed = Object.entries(values).filter(([key, value]) => before[key] !== value);
  if (changed.length > 0) {
    writeFileSync(path, patchEnvText(readFileSync(path, "utf8"), Object.fromEntries(changed)), { mode: 0o600 });
  }
  return changed.map(([key]) => key);
};

export const requireVar = (env: EnvMap, name: string): string => {
  const value = env[name];
  if (value === undefined || value.length === 0) throw new Error(`missing ${name} in .env (see .env.example)`);
  return value;
};

export const optionalVar = (env: EnvMap, name: string, fallback: string): string => {
  const value = env[name];
  return value === undefined || value.length === 0 ? fallback : value;
};

/** AGENTS.md: testnet only. A mainnet run spends real money, so it never gets as far as a prompt. */
export const assertTestnet = (network: string): void => {
  if (network !== "testnet") {
    throw new Error(`refusing to run: NEAR_NETWORK is "${network}" and these scripts are testnet-only (AGENTS.md)`);
  }
};
