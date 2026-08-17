export interface GcItem {
  id?: string | number;
  def_index?: number;
  defindex?: number;
  quality?: number;
  paint_index?: number;
  paintindex?: number;
  paint_wear?: number;
  paintwear?: number;
  paint_seed?: number;
  custom_name?: string;
  customname?: string | null;
  casket_id?: string;
  casket_contained_item_count?: number;
  stickers?: Array<{ sticker_id?: number; slot?: number }>;
  attribute?: Array<{ def_index: number; value_bytes?: Buffer }>;
  [key: string]: unknown;
}

export interface InventoryLot {
  market_hash_name: string;
  quantity: number;
  location: string;
}

export interface PurchaseLot {
  quantity: number;
  unitPrice: number;
  at: string;
}

export interface HoldingRecord {
  buyPrice: number;
  addedAt: string;
  purchases?: PurchaseLot[];
}

export interface PortfolioFile {
  updatedAt: string | null;
  lastSteamSyncAt: string | null;
  lastPriceSyncAt: string | null;
  holdings: Record<string, HoldingRecord>;
  inventory: InventoryLot[];
}

export interface PriceQuote {
  marketHashName: string;
  priceUsd: number | null;
  fetchedAt: string;
  source: 'csfloat' | 'index' | 'cache' | 'none';
}

export interface PriceCacheFile {
  quotes: Record<string, { priceUsd: number | null; fetchedAt: string }>;
}

export interface ValuedLot extends InventoryLot {
  buyPrice: number;
  itemType: string;
  invested: number;
  unitPrice: number | null;
  marketValue: number;
  netLiquidated: number;
  profitUsd: number;
  profitPct: number | null;
}

export interface ItemRollup {
  marketHashName: string;
  itemType: string;
  quantity: number;
  buyPrice: number;
  invested: number;
  unitPrice: number | null;
  marketValue: number;
  netLiquidated: number;
  profitUsd: number;
  profitPct: number | null;
  locations: string[];
  purchases: PurchaseLot[];
}

export interface BreakdownRow {
  label: string;
  quantity: number;
  invested: number;
  marketValue: number;
  netLiquidated: number;
  profitUsd: number;
}

export interface HistoryPoint {
  at: string;
  marketValue: number;
  netLiquidated: number;
  invested: number;
  profitUsd: number;
}

export interface PortfolioSummary {
  lots: ValuedLot[];
  rollups: ItemRollup[];
  locations: string[];
  byType: BreakdownRow[];
  byLocation: BreakdownRow[];
  unpriced: ItemRollup[];
  totalQuantity: number;
  totalInvested: number;
  totalMarketValue: number;
  totalNetLiquidated: number;
  totalProfitUsd: number;
  overallRoiPct: number | null;
  pricedItems: number;
  unpricedItems: number;
}

export interface PriceProgressEvent {
  message: string;
  done?: number;
  total?: number;
}

export interface SteamGuardInfo {
  domain: string | null;
  lastCodeWrong: boolean;
}

export interface SteamFetchOptions {
  onProgress?: (message: string) => void;
  requestSteamGuard?: (info: SteamGuardInfo) => Promise<string>;
}
