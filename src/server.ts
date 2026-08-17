import http from 'node:http';
import { exec } from 'node:child_process';
import express from 'express';
import { PUBLIC_DIR, ROOT_DIR, config, hasSteamCredentials, isPackaged } from './config.js';
import { lookupPrices } from './csfloat.js';
import { applyMissingBuyPrices, addPurchase, markPriceSync, setBuyPrice, syncInventory } from './portfolio.js';
import { buildSnapshot } from './snapshot.js';
import { fetchSteamInventory } from './steam.js';
import type { SteamGuardInfo } from './types.js';

interface JobState {
  running: boolean;
  kind: 'idle' | 'steam' | 'prices';
  message: string;
  error: string | null;
  steamGuard: SteamGuardInfo | null;
}

const job: JobState = {
  running: false,
  kind: 'idle',
  message: '',
  error: null,
  steamGuard: null,
};

const sseClients = new Set<express.Response>();
let steamGuardWaiter: {
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
} | null = null;

function broadcast(event: Record<string, unknown> = {}): void {
  const payload = JSON.stringify({
    running: job.running,
    kind: job.kind,
    message: job.message,
    error: job.error,
    steamGuard: job.steamGuard,
    ...event,
  });
  for (const client of sseClients) {
    client.write(`data: ${payload}\n\n`);
  }
}

function setJob(partial: Partial<JobState>): void {
  Object.assign(job, partial);
  broadcast();
}

function requestSteamGuardFromUi(info: SteamGuardInfo): Promise<string> {
  if (steamGuardWaiter) {
    steamGuardWaiter.reject(new Error('Steam Guard prompt replaced by a newer request.'));
    clearTimeout(steamGuardWaiter.timer);
    steamGuardWaiter = null;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      steamGuardWaiter = null;
      job.steamGuard = null;
      reject(new Error('Timed out waiting for a Steam Guard code.'));
    }, 180_000);

    steamGuardWaiter = { resolve, reject, timer };
    setJob({ steamGuard: info, message: info.domain ? `Enter the email code sent to ${info.domain}` : 'Enter your Steam Guard mobile code' });
  });
}

async function runSteamSync(): Promise<void> {
  setJob({ running: true, kind: 'steam', message: 'Starting Steam sync…', error: null, steamGuard: null });

  try {
    const inventory = await fetchSteamInventory({
      onProgress: (message) => setJob({ message }),
      requestSteamGuard: requestSteamGuardFromUi,
    });
    syncInventory(inventory, true);
    setJob({ running: true, kind: 'prices', message: 'Inventory saved. Refreshing CSFloat prices…' });
    await lookupPrices(
      inventory.map((lot) => lot.market_hash_name),
      (event) => setJob({ message: event.message }),
      true,
    );
    markPriceSync();
    setJob({ running: false, kind: 'idle', message: `Synced ${inventory.length} lots from Steam.`, error: null, steamGuard: null });
    broadcast({ snapshot: buildSnapshot({ recordHistory: true }) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setJob({ running: false, kind: 'idle', message: '', error: message, steamGuard: null });
    throw err;
  } finally {
    if (steamGuardWaiter) {
      clearTimeout(steamGuardWaiter.timer);
      steamGuardWaiter = null;
    }
  }
}

async function runPriceRefresh(force = true): Promise<void> {
  const snapshot = buildSnapshot();
  if (snapshot.portfolio.inventory.length === 0) {
    throw new Error('No inventory yet. Sync from Steam first.');
  }

  setJob({ running: true, kind: 'prices', message: 'Refreshing CSFloat prices…', error: null, steamGuard: null });
  try {
    await lookupPrices(
      snapshot.portfolio.inventory.map((lot) => lot.market_hash_name),
      (event) => setJob({ message: event.message }),
      force,
    );
    markPriceSync();
    setJob({ running: false, kind: 'idle', message: 'Prices updated.', error: null });
    broadcast({ snapshot: buildSnapshot({ recordHistory: true }) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setJob({ running: false, kind: 'idle', message: '', error: message });
    throw err;
  }
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command);
}

export function startServer(): http.Server {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  app.get('/api/portfolio', (_req, res) => {
    res.json({ job, ...buildSnapshot() });
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ ...job, snapshot: buildSnapshot() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  app.post('/api/sync-steam', (_req, res) => {
    if (job.running) {
      res.status(409).json({ error: 'Another job is already running.' });
      return;
    }
    void runSteamSync().catch(() => undefined);
    res.json({ ok: true });
  });

  app.post('/api/refresh-prices', (_req, res) => {
    if (job.running) {
      res.status(409).json({ error: 'Another job is already running.' });
      return;
    }
    if (buildSnapshot().portfolio.inventory.length === 0) {
      res.status(400).json({ error: 'No inventory yet. Sync from Steam first.' });
      return;
    }
    void runPriceRefresh(true).catch(() => undefined);
    res.json({ ok: true });
  });

  app.post('/api/steam-guard', (req, res) => {
    const code = String(req.body?.code ?? '').trim();
    if (!steamGuardWaiter) {
      res.status(400).json({ error: 'No Steam Guard code is being requested.' });
      return;
    }
    if (!code) {
      res.status(400).json({ error: 'Enter a Steam Guard code.' });
      return;
    }
    const waiter = steamGuardWaiter;
    steamGuardWaiter = null;
    clearTimeout(waiter.timer);
    job.steamGuard = null;
    job.message = 'Submitting Steam Guard code…';
    broadcast();
    waiter.resolve(code);
    res.json({ ok: true });
  });

  app.patch('/api/holdings', (req, res) => {
    const name = String(req.body?.marketHashName ?? '').trim();
    const buyPrice = Number(req.body?.buyPrice);
    if (!name) {
      res.status(400).json({ error: 'marketHashName is required.' });
      return;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      res.status(400).json({ error: 'buyPrice must be a number >= 0.' });
      return;
    }
    setBuyPrice(name, buyPrice);
    res.json(buildSnapshot());
  });

  app.post('/api/holdings/purchase', (req, res) => {
    const name = String(req.body?.marketHashName ?? '').trim();
    const quantity = Number(req.body?.quantity);
    const unitPrice = Number(req.body?.unitPrice);
    const alreadyInInventory = req.body?.alreadyInInventory !== false;
    if (!name) {
      res.status(400).json({ error: 'marketHashName is required.' });
      return;
    }
    try {
      addPurchase(name, quantity, unitPrice, alreadyInInventory);
      res.json(buildSnapshot());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/holdings/from-csfloat', (_req, res) => {
    const snapshot = buildSnapshot();
    const prices = new Map<string, number>();
    for (const item of snapshot.summary.rollups) {
      if (typeof item.unitPrice === 'number' && item.unitPrice > 0) {
        prices.set(item.marketHashName, item.unitPrice);
      }
    }
    const updated = applyMissingBuyPrices(prices);
    res.json({ updated, ...buildSnapshot() });
  });

  const server = app.listen(config.port, () => {
    const url = `http://localhost:${config.port}`;
    console.log(`CS2 Inventory Tracker running at ${url}`);
    if (isPackaged()) {
      console.log(`Data folder: ${ROOT_DIR}`);
      console.log('Keep this window open while you use the tracker.');
    }
    if (!hasSteamCredentials()) {
      console.log('Steam login is not set yet. Edit .env, then restart.');
    }
    openBrowser(url);
  });

  return server;
}

const isDirect = process.argv[1]?.includes('server');
if (isDirect) startServer();
