import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

type PackagedProcess = NodeJS.Process & { pkg?: unknown };

const CODE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function isPackaged(): boolean {
  if (typeof (process as PackagedProcess).pkg === 'object') return true;
  const execName = path.basename(process.execPath).toLowerCase();
  return execName !== 'node.exe' && execName !== 'node';
}

/** Bundled app files (public UI, .env.example). Snapshot path when packaged. */
export const APP_DIR = path.resolve(CODE_DIR, '..');

/** Writable files (.env, data/). Next to the .exe when packaged. */
export const USER_DIR = isPackaged() ? path.dirname(process.execPath) : APP_DIR;

export const ROOT_DIR = USER_DIR;
export const PUBLIC_DIR = path.join(APP_DIR, 'public');
export const DATA_DIR = path.join(USER_DIR, 'data');
export const STEAM_DATA_DIR = path.join(DATA_DIR, 'steam');
export const PORTFOLIO_PATH = path.join(DATA_DIR, 'portfolio.json');
export const PRICE_CACHE_PATH = path.join(DATA_DIR, 'price-cache.json');
export const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
export const REFRESH_TOKEN_PATH = path.join(DATA_DIR, 'refresh.token');

function resolveEnvPath(): string {
  if (!isPackaged()) return path.join(USER_DIR, '.env');
  const visible = path.join(USER_DIR, 'config.env');
  const hidden = path.join(USER_DIR, '.env');
  if (fs.existsSync(visible)) return visible;
  if (fs.existsSync(hidden)) return hidden;
  return visible;
}

export const ENV_PATH = resolveEnvPath();

function ensureEnvFile(): void {
  if (fs.existsSync(ENV_PATH)) return;
  const examplePath = path.join(APP_DIR, '.env.example');
  try {
    fs.copyFileSync(examplePath, ENV_PATH);
    console.log(`Created ${ENV_PATH}`);
    console.log('Add your Steam login there, then restart this app.\n');
  } catch {
    // Source checkout without .env.example is fine.
  }
}

ensureEnvFile();
dotenv.config({ path: ENV_PATH });

export const CS2_APP_ID = 730;
export const STORAGE_UNIT_DEF_INDEX = 1201;
export const CSFLOAT_FEE = 0.02;
export const DEFAULT_PRICE_CACHE_TTL_MS = 30 * 60 * 1000;
export const MAIN_INVENTORY_LABEL = 'Main Inventory';

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function ensureSteamDataDir(): void {
  ensureDataDir();
  fs.mkdirSync(STEAM_DATA_DIR, { recursive: true });
}

export function envString(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  steamAccountName: envString('STEAM_ACCOUNT_NAME'),
  steamPassword: envString('STEAM_PASSWORD'),
  steamSharedSecret: envString('STEAM_SHARED_SECRET'),
  csfloatApiKey: envString('CSFLOAT_API_KEY'),
  priceCacheTtlMs: envNumber('PRICE_CACHE_TTL_MS', DEFAULT_PRICE_CACHE_TTL_MS),
  port: envNumber('PORT', 3000),
};

export function hasSteamCredentials(): boolean {
  const name = config.steamAccountName;
  const password = config.steamPassword;
  if (!name || !password) return false;
  if (name === 'your_steam_username') return false;
  if (password === 'your_steam_password') return false;
  return true;
}
