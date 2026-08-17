import { quotesFromCache } from './csfloat.js';
import { ensureHistoryBaseline, recordValuePoint } from './history.js';
import { filterTrackableLots } from './items.js';
import { loadPortfolio, savePortfolio } from './portfolio.js';
import { valuePortfolio } from './valuation.js';
import type { HistoryPoint, PortfolioFile, PortfolioSummary } from './types.js';

export interface PortfolioSnapshot {
  portfolio: PortfolioFile;
  summary: PortfolioSummary;
  history: HistoryPoint[];
}

export function buildSnapshot(options: { recordHistory?: boolean } = {}): PortfolioSnapshot {
  const portfolio = loadPortfolio();
  const inventory = filterTrackableLots(portfolio.inventory);
  if (inventory.length !== portfolio.inventory.length) {
    portfolio.inventory = inventory;
    savePortfolio(portfolio);
  }
  const quotes = quotesFromCache(inventory.map((lot) => lot.market_hash_name), true);
  const summary = valuePortfolio(inventory, portfolio, quotes);
  const history = options.recordHistory ? recordValuePoint(summary) : ensureHistoryBaseline(summary);
  return {
    portfolio,
    summary,
    history,
  };
}
