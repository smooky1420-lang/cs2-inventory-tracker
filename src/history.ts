import fs from 'node:fs';
import { HISTORY_PATH, ensureDataDir } from './config.js';
import { roundMoney } from './utils.js';
import type { HistoryPoint, PortfolioSummary } from './types.js';

const MAX_POINTS = 500;
const REPLACE_WINDOW_MS = 10 * 60 * 1000;

interface HistoryFile {
  points: HistoryPoint[];
}

function isPoint(value: unknown): value is HistoryPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as HistoryPoint;
  return (
    typeof point.at === 'string' &&
    typeof point.marketValue === 'number' &&
    typeof point.netLiquidated === 'number' &&
    typeof point.invested === 'number' &&
    typeof point.profitUsd === 'number'
  );
}

export function loadHistory(): HistoryPoint[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) as Partial<HistoryFile>;
    return Array.isArray(parsed.points) ? parsed.points.filter(isPoint) : [];
  } catch {
    return [];
  }
}

export function saveHistory(points: HistoryPoint[]): HistoryPoint[] {
  ensureDataDir();
  const trimmed = points.slice(-MAX_POINTS);
  fs.writeFileSync(HISTORY_PATH, `${JSON.stringify({ points: trimmed }, null, 2)}\n`, 'utf8');
  return trimmed;
}

export function pointFromSummary(summary: PortfolioSummary, at = new Date().toISOString()): HistoryPoint {
  return {
    at,
    marketValue: roundMoney(summary.totalMarketValue),
    netLiquidated: roundMoney(summary.totalNetLiquidated),
    invested: roundMoney(summary.totalInvested),
    profitUsd: roundMoney(summary.totalProfitUsd),
  };
}

export function ensureHistoryBaseline(summary: PortfolioSummary): HistoryPoint[] {
  const points = loadHistory();
  if (points.length > 0 || summary.totalQuantity === 0) return points;
  return saveHistory([pointFromSummary(summary)]);
}

export function recordValuePoint(summary: PortfolioSummary): HistoryPoint[] {
  const points = loadHistory();
  const next = pointFromSummary(summary);
  const last = points[points.length - 1];
  if (last) {
    const age = Date.parse(next.at) - Date.parse(last.at);
    if (Number.isFinite(age) && age >= 0 && age < REPLACE_WINDOW_MS) {
      points[points.length - 1] = next;
      return saveHistory(points);
    }
  }
  points.push(next);
  return saveHistory(points);
}
