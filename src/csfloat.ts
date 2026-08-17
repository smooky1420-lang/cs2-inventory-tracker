import fs from 'node:fs';
import axios, { AxiosError } from 'axios';
import { PRICE_CACHE_PATH, config, ensureDataDir } from './config.js';
import { priceLookupName } from './items.js';
import { sleep } from './utils.js';
import type { PriceCacheFile, PriceProgressEvent, PriceQuote } from './types.js';

const CSFLOAT_LISTINGS_URL = 'https://csfloat.com/api/v1/listings';
const CSFLOAT_PRICE_LIST_URL = 'https://csfloat.com/api/v1/listings/price-list';
const FALLBACK_CONCURRENCY = 8;

type ProgressFn = (event: PriceProgressEvent) => void;

function csfloatHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Origin: 'https://csfloat.com',
    Referer: 'https://csfloat.com/',
    'User-Agent': 'cs2-portfolio-tracker/1.0',
  };
  if (config.csfloatApiKey) headers.Authorization = config.csfloatApiKey;
  return headers;
}

function loadCache(): PriceCacheFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(PRICE_CACHE_PATH, 'utf8')) as PriceCacheFile;
    return { quotes: parsed.quotes ?? {} };
  } catch {
    return { quotes: {} };
  }
}

function saveCache(cache: PriceCacheFile): void {
  ensureDataDir();
  fs.writeFileSync(PRICE_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function isFresh(fetchedAt: string): boolean {
  const age = Date.now() - new Date(fetchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < config.priceCacheTtlMs;
}

function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

function extractListings(payload: unknown): Array<{ price?: number }> {
  if (Array.isArray(payload)) return payload as Array<{ price?: number }>;
  if (payload && typeof payload === 'object') {
    const record = payload as { data?: unknown; listings?: unknown };
    if (Array.isArray(record.data)) return record.data as Array<{ price?: number }>;
    if (Array.isArray(record.listings)) return record.listings as Array<{ price?: number }>;
  }
  return [];
}

function extractPriceIndex(payload: unknown): Array<{ market_hash_name?: string; min_price?: number }> {
  if (Array.isArray(payload)) return payload as Array<{ market_hash_name?: string; min_price?: number }>;
  if (payload && typeof payload === 'object') {
    const record = payload as { data?: unknown };
    if (Array.isArray(record.data)) {
      return record.data as Array<{ market_hash_name?: string; min_price?: number }>;
    }
  }
  return [];
}

function cachedQuote(cache: PriceCacheFile, name: string) {
  const alt = priceLookupName(name);
  const altQuote = alt !== name ? cache.quotes[alt] : undefined;
  if (altQuote && altQuote.priceUsd !== null) return altQuote;
  return cache.quotes[name];
}

export function quotesFromCache(marketHashNames: string[], allowStale = true): Map<string, PriceQuote> {
  const cache = loadCache();
  const quotes = new Map<string, PriceQuote>();
  for (const name of new Set(marketHashNames)) {
    const cached = cachedQuote(cache, name);
    if (!cached) continue;
    if (!allowStale && !isFresh(cached.fetchedAt)) continue;
    quotes.set(name, {
      marketHashName: name,
      priceUsd: cached.priceUsd,
      fetchedAt: cached.fetchedAt,
      source: 'cache',
    });
  }
  return quotes;
}

async function fetchPriceIndex(): Promise<Map<string, number>> {
  const { data, status } = await axios.get(CSFLOAT_PRICE_LIST_URL, {
    headers: csfloatHeaders(),
    timeout: 60_000,
    validateStatus: (code) => code < 500,
  });

  if (status === 401 || status === 403) {
    throw new Error('CSFloat price index requires a valid CSFLOAT_API_KEY in .env.');
  }
  if (status !== 200) {
    throw new Error(`CSFloat price index returned HTTP ${status}`);
  }

  const index = new Map<string, number>();
  for (const row of extractPriceIndex(data)) {
    if (!row.market_hash_name || typeof row.min_price !== 'number') continue;
    index.set(row.market_hash_name, centsToUsd(row.min_price));
  }
  return index;
}

async function fetchLowestListing(marketHashName: string): Promise<number | null> {
  let attempt = 0;
  while (attempt < 3) {
    attempt += 1;
    try {
      const { data, status } = await axios.get(CSFLOAT_LISTINGS_URL, {
        params: {
          market_hash_name: marketHashName,
          sort_by: 'lowest_price',
          type: 'buy_now',
          limit: 1,
        },
        headers: csfloatHeaders(),
        timeout: 20_000,
        validateStatus: (code) => code < 500,
      });

      if (status === 429) {
        await sleep(2_000 * attempt);
        continue;
      }
      if (status === 401 || status === 403) {
        throw new Error(
          'CSFloat rejected the listings request. Add CSFLOAT_API_KEY to .env (Developer tab on your CSFloat profile).',
        );
      }
      if (status !== 200) {
        throw new Error(`CSFloat returned HTTP ${status} for ${marketHashName}`);
      }

      const listings = extractListings(data);
      const priceCents = listings[0]?.price;
      return typeof priceCents === 'number' ? centsToUsd(priceCents) : null;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 429 && attempt < 3) {
        await sleep(2_000 * attempt);
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function lookupRemaining(
  names: string[],
  cache: PriceCacheFile,
  quotes: Map<string, PriceQuote>,
  onProgress?: ProgressFn,
): Promise<void> {
  let done = 0;
  let cursor = 0;
  const total = names.length;

  const worker = async () => {
    while (cursor < names.length) {
      const index = cursor;
      cursor += 1;
      const name = names[index];
      try {
        const priceUsd = await fetchLowestListing(priceLookupName(name));
        const quote: PriceQuote = {
          marketHashName: name,
          priceUsd,
          fetchedAt: new Date().toISOString(),
          source: priceUsd === null ? 'none' : 'csfloat',
        };
        quotes.set(name, quote);
        cache.quotes[name] = { priceUsd: quote.priceUsd, fetchedAt: quote.fetchedAt };
      } catch {
        quotes.set(name, {
          marketHashName: name,
          priceUsd: cache.quotes[name]?.priceUsd ?? null,
          fetchedAt: cache.quotes[name]?.fetchedAt ?? new Date().toISOString(),
          source: cache.quotes[name] ? 'cache' : 'none',
        });
      }
      done += 1;
      if (done % 5 === 0 || done === total) {
        onProgress?.({ message: `Looked up remaining listings ${done}/${total}`, done, total });
        saveCache(cache);
      }
    }
  };

  const pool = Math.min(FALLBACK_CONCURRENCY, names.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  saveCache(cache);
}

export async function lookupPrices(
  marketHashNames: string[],
  onProgress?: ProgressFn,
  forceRefresh = false,
): Promise<Map<string, PriceQuote>> {
  const unique = [...new Set(marketHashNames)].sort();
  const cache = loadCache();
  const quotes = new Map<string, PriceQuote>();
  const missing: string[] = [];

  for (const name of unique) {
    const cached = cachedQuote(cache, name);
    const usable = cached && isFresh(cached.fetchedAt) && (cached.priceUsd !== null || priceLookupName(name) === name);
    if (!forceRefresh && usable && cached) {
      quotes.set(name, {
        marketHashName: name,
        priceUsd: cached.priceUsd,
        fetchedAt: cached.fetchedAt,
        source: 'cache',
      });
    } else {
      missing.push(name);
    }
  }

  onProgress?.({
    message: `CSFloat: ${quotes.size} cached, ${missing.length} to refresh`,
    done: quotes.size,
    total: unique.length,
  });

  if (missing.length === 0) return quotes;

  let matchedFromIndex = 0;
  try {
    onProgress?.({ message: 'Downloading CSFloat price index…' });
    const index = await fetchPriceIndex();
    const fetchedAt = new Date().toISOString();
    const stillMissing: string[] = [];

    for (const name of missing) {
      const priceUsd = index.get(name) ?? index.get(priceLookupName(name));
      if (typeof priceUsd === 'number') {
        const quote: PriceQuote = {
          marketHashName: name,
          priceUsd,
          fetchedAt,
          source: 'index',
        };
        quotes.set(name, quote);
        cache.quotes[name] = { priceUsd, fetchedAt };
        matchedFromIndex += 1;
      } else {
        stillMissing.push(name);
      }
    }

    saveCache(cache);
    onProgress?.({
      message: `Matched ${matchedFromIndex} item(s) from CSFloat index` +
        (stillMissing.length ? `, ${stillMissing.length} need a direct lookup` : ''),
      done: quotes.size,
      total: unique.length,
    });

    if (stillMissing.length > 0) {
      await lookupRemaining(stillMissing, cache, quotes, onProgress);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.({ message: `Price index unavailable (${message}). Falling back to parallel listings.` });
    await lookupRemaining(missing.filter((name) => !quotes.has(name)), cache, quotes, onProgress);
  }

  return quotes;
}
