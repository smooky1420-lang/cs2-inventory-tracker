import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatUsd(value: number | null | undefined, fallback = 'N/A'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-$${abs}` : `$${abs}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export function parseArgs(argv: string[]): {
  offline: boolean;
  skipPrices: boolean;
  help: boolean;
  setPrice: { name: string; price: number } | null;
} {
  const args = argv.slice(2);
  const flags = {
    offline: args.includes('--offline'),
    skipPrices: args.includes('--skip-prices'),
    help: args.includes('--help') || args.includes('-h'),
    setPrice: null as { name: string; price: number } | null,
  };

  const setIndex = args.findIndex((arg) => arg === '--set-price');
  if (setIndex !== -1) {
    const name = args[setIndex + 1];
    const priceRaw = args[setIndex + 2];
    if (!name || priceRaw === undefined) {
      throw new Error('Usage: --set-price "Market Hash Name" 1.25');
    }
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('Buy price must be a number >= 0');
    }
    flags.setPrice = { name, price };
  }

  return flags;
}
