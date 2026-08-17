import fs from 'node:fs';
import { PORTFOLIO_PATH, ensureDataDir } from './config.js';
import { filterTrackableLots } from './items.js';
import { roundMoney } from './utils.js';
import type { HoldingRecord, InventoryLot, PortfolioFile } from './types.js';

const EMPTY_PORTFOLIO: PortfolioFile = {
  updatedAt: null,
  lastSteamSyncAt: null,
  lastPriceSyncAt: null,
  holdings: {},
  inventory: [],
};

export function loadPortfolio(): PortfolioFile {
  try {
    const raw = fs.readFileSync(PORTFOLIO_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PortfolioFile>;
    return {
      updatedAt: parsed.updatedAt ?? null,
      lastSteamSyncAt: parsed.lastSteamSyncAt ?? null,
      lastPriceSyncAt: parsed.lastPriceSyncAt ?? null,
      holdings: parsed.holdings ?? {},
      inventory: parsed.inventory ?? [],
    };
  } catch {
    return structuredClone(EMPTY_PORTFOLIO);
  }
}

export function savePortfolio(portfolio: PortfolioFile): void {
  ensureDataDir();
  const next: PortfolioFile = {
    ...portfolio,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PORTFOLIO_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function syncInventory(inventory: InventoryLot[], steamSynced = true): PortfolioFile {
  const portfolio = loadPortfolio();
  const now = new Date().toISOString();
  const discovered: string[] = [];
  const trackable = filterTrackableLots(inventory);

  for (const lot of trackable) {
    if (!portfolio.holdings[lot.market_hash_name]) {
      portfolio.holdings[lot.market_hash_name] = {
        buyPrice: 0,
        addedAt: now,
      };
      discovered.push(lot.market_hash_name);
    }
  }

  portfolio.inventory = trackable;
  if (steamSynced) portfolio.lastSteamSyncAt = now;
  savePortfolio(portfolio);

  if (discovered.length > 0) {
    console.log(`Added ${discovered.length} new holding(s) with default buy price $0.00:`);
    for (const name of discovered.sort()) {
      console.log(`  + ${name}`);
    }
  }

  return loadPortfolio();
}

export function markPriceSync(): PortfolioFile {
  const portfolio = loadPortfolio();
  portfolio.lastPriceSyncAt = new Date().toISOString();
  savePortfolio(portfolio);
  return portfolio;
}

export function resolveHoldingKey(portfolio: PortfolioFile, marketHashName: string): string {
  const names = Object.keys(portfolio.holdings);
  return (
    names.find((name) => name === marketHashName) ??
    names.find((name) => name.toLowerCase() === marketHashName.toLowerCase()) ??
    names.find((name) => name.toLowerCase().includes(marketHashName.toLowerCase())) ??
    marketHashName
  );
}

export function quantityOwned(portfolio: PortfolioFile, marketHashName: string): number {
  return portfolio.inventory
    .filter((lot) => lot.market_hash_name === marketHashName)
    .reduce((sum, lot) => sum + lot.quantity, 0);
}

export function weightedAverageBuyPrice(options: {
  currentQty: number;
  currentBuyPrice: number;
  addQty: number;
  addPrice: number;
  alreadyInInventory: boolean;
}): number {
  const { currentQty, currentBuyPrice, addQty, addPrice, alreadyInInventory } = options;
  const baseQty = alreadyInInventory ? Math.max(0, currentQty - addQty) : currentQty;
  const denom = alreadyInInventory ? Math.max(currentQty, baseQty + addQty) : currentQty + addQty;
  if (denom <= 0) return roundMoney(addPrice);
  return roundMoney((baseQty * currentBuyPrice + addQty * addPrice) / denom);
}

export function setBuyPrice(marketHashName: string, buyPrice: number): HoldingRecord {
  const portfolio = loadPortfolio();
  const key = resolveHoldingKey(portfolio, marketHashName);
  const previous = portfolio.holdings[key];
  const record: HoldingRecord = {
    buyPrice: roundMoney(buyPrice),
    addedAt: previous?.addedAt ?? new Date().toISOString(),
    purchases: previous?.purchases,
  };
  portfolio.holdings[key] = record;
  savePortfolio(portfolio);
  return record;
}

export function addPurchase(
  marketHashName: string,
  quantity: number,
  unitPrice: number,
  alreadyInInventory = true,
): HoldingRecord {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Purchase quantity must be greater than 0.');
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('Purchase price must be a number >= 0.');
  }

  const portfolio = loadPortfolio();
  const key = resolveHoldingKey(portfolio, marketHashName);
  const now = new Date().toISOString();
  const previous = portfolio.holdings[key] ?? { buyPrice: 0, addedAt: now, purchases: [] };
  const currentQty = quantityOwned(portfolio, key);
  const buyPrice = weightedAverageBuyPrice({
    currentQty,
    currentBuyPrice: previous.buyPrice ?? 0,
    addQty: quantity,
    addPrice: unitPrice,
    alreadyInInventory,
  });

  const record: HoldingRecord = {
    buyPrice,
    addedAt: previous.addedAt ?? now,
    purchases: [
      ...(previous.purchases ?? []),
      { quantity, unitPrice: roundMoney(unitPrice), at: now },
    ],
  };
  portfolio.holdings[key] = record;
  savePortfolio(portfolio);
  return record;
}

export function buyPriceFor(portfolio: PortfolioFile, marketHashName: string): number {
  return portfolio.holdings[marketHashName]?.buyPrice ?? 0;
}

export function applyMissingBuyPrices(prices: Map<string, number>): number {
  const portfolio = loadPortfolio();
  const owned = new Set(portfolio.inventory.map((lot) => lot.market_hash_name));
  let updated = 0;

  for (const name of owned) {
    const current = portfolio.holdings[name]?.buyPrice ?? 0;
    if (current > 0) continue;
    const price = prices.get(name);
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
    const qty = quantityOwned(portfolio, name);
    portfolio.holdings[name] = {
      buyPrice: roundMoney(price),
      addedAt: portfolio.holdings[name]?.addedAt ?? new Date().toISOString(),
      purchases: [
        ...(portfolio.holdings[name]?.purchases ?? []),
        { quantity: Math.max(1, qty), unitPrice: roundMoney(price), at: new Date().toISOString() },
      ],
    };
    updated += 1;
  }

  if (updated > 0) savePortfolio(portfolio);
  return updated;
}
