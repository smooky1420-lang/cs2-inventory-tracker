import { CSFLOAT_FEE, MAIN_INVENTORY_LABEL } from './config.js';
import { classifyItem } from './items.js';
import { buyPriceFor } from './portfolio.js';
import { roundMoney } from './utils.js';
import type { BreakdownRow, InventoryLot, ItemRollup, PortfolioFile, PortfolioSummary, PriceQuote, ValuedLot } from './types.js';

function breakdown(lots: ValuedLot[], keyFn: (lot: ValuedLot) => string): BreakdownRow[] {
  const grouped = new Map<string, BreakdownRow>();
  for (const lot of lots) {
    const label = keyFn(lot);
    const existing = grouped.get(label);
    if (existing) {
      existing.quantity += lot.quantity;
      existing.invested = roundMoney(existing.invested + lot.invested);
      existing.marketValue = roundMoney(existing.marketValue + lot.marketValue);
      existing.netLiquidated = roundMoney(existing.netLiquidated + lot.netLiquidated);
      existing.profitUsd = roundMoney(existing.netLiquidated - existing.invested);
    } else {
      grouped.set(label, {
        label,
        quantity: lot.quantity,
        invested: lot.invested,
        marketValue: lot.marketValue,
        netLiquidated: lot.netLiquidated,
        profitUsd: lot.profitUsd,
      });
    }
  }

  return [...grouped.values()].sort((a, b) => b.marketValue - a.marketValue);
}

export function valuePortfolio(
  inventory: InventoryLot[],
  portfolio: PortfolioFile,
  quotes: Map<string, PriceQuote>,
): PortfolioSummary {
  const lots: ValuedLot[] = inventory.map((lot) => {
    const buyPrice = buyPriceFor(portfolio, lot.market_hash_name);
    const unitPrice = quotes.get(lot.market_hash_name)?.priceUsd ?? null;
    const invested = roundMoney(lot.quantity * buyPrice);
    const marketValue = roundMoney(lot.quantity * (unitPrice ?? 0));
    const netLiquidated = roundMoney(marketValue * (1 - CSFLOAT_FEE));
    const profitUsd = roundMoney(netLiquidated - invested);
    const profitPct = invested > 0 ? (profitUsd / invested) * 100 : null;

    return {
      ...lot,
      buyPrice,
      itemType: classifyItem(lot.market_hash_name),
      invested,
      unitPrice,
      marketValue,
      netLiquidated,
      profitUsd,
      profitPct,
    };
  });

  const rollupMap = new Map<string, ItemRollup>();
  for (const lot of lots) {
    const existing = rollupMap.get(lot.market_hash_name);
    if (existing) {
      existing.quantity += lot.quantity;
      existing.invested = roundMoney(existing.invested + lot.invested);
      existing.marketValue = roundMoney(existing.marketValue + lot.marketValue);
      existing.netLiquidated = roundMoney(existing.netLiquidated + lot.netLiquidated);
      existing.profitUsd = roundMoney(existing.netLiquidated - existing.invested);
      existing.profitPct = existing.invested > 0 ? (existing.profitUsd / existing.invested) * 100 : null;
      if (!existing.locations.includes(lot.location)) existing.locations.push(lot.location);
    } else {
      rollupMap.set(lot.market_hash_name, {
        marketHashName: lot.market_hash_name,
        itemType: lot.itemType,
        quantity: lot.quantity,
        buyPrice: lot.buyPrice,
        invested: lot.invested,
        unitPrice: lot.unitPrice,
        marketValue: lot.marketValue,
        netLiquidated: lot.netLiquidated,
        profitUsd: lot.profitUsd,
        profitPct: lot.profitPct,
        locations: [lot.location],
        purchases: portfolio.holdings[lot.market_hash_name]?.purchases ?? [],
      });
    }
  }

  const rollups = [...rollupMap.values()].sort((a, b) => b.marketValue - a.marketValue);
  const totalInvested = roundMoney(lots.reduce((sum, lot) => sum + lot.invested, 0));
  const totalMarketValue = roundMoney(lots.reduce((sum, lot) => sum + lot.marketValue, 0));
  const totalNetLiquidated = roundMoney(lots.reduce((sum, lot) => sum + lot.netLiquidated, 0));
  const totalProfitUsd = roundMoney(totalNetLiquidated - totalInvested);
  const locations = [...new Set(lots.map((lot) => lot.location))].sort((a, b) => {
    if (a === MAIN_INVENTORY_LABEL) return -1;
    if (b === MAIN_INVENTORY_LABEL) return 1;
    return a.localeCompare(b);
  });

  return {
    lots,
    rollups,
    locations,
    byType: breakdown(lots, (lot) => lot.itemType),
    byLocation: breakdown(lots, (lot) => lot.location),
    unpriced: rollups
      .filter((item) => item.unitPrice === null)
      .sort((a, b) => b.quantity - a.quantity || a.marketHashName.localeCompare(b.marketHashName)),
    totalQuantity: lots.reduce((sum, lot) => sum + lot.quantity, 0),
    totalInvested,
    totalMarketValue,
    totalNetLiquidated,
    totalProfitUsd,
    overallRoiPct: totalInvested > 0 ? (totalProfitUsd / totalInvested) * 100 : null,
    pricedItems: rollups.filter((item) => item.unitPrice !== null).length,
    unpricedItems: rollups.filter((item) => item.unitPrice === null).length,
  };
}
