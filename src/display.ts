import chalk from 'chalk';
import Table from 'cli-table3';
import { MAIN_INVENTORY_LABEL } from './config.js';
import { formatPct, formatUsd } from './utils.js';
import type { PortfolioSummary, ValuedLot } from './types.js';

function colorPnl(value: number, formatted: string): string {
  if (value > 0) return chalk.green(formatted);
  if (value < 0) return chalk.red(formatted);
  return formatted;
}

function locationGroups(lots: ValuedLot[]): Array<[string, ValuedLot[]]> {
  const groups = new Map<string, ValuedLot[]>();
  for (const lot of lots) {
    const list = groups.get(lot.location) ?? [];
    list.push(lot);
    groups.set(lot.location, list);
  }

  const names = [...groups.keys()].sort((a, b) => {
    if (a === MAIN_INVENTORY_LABEL) return -1;
    if (b === MAIN_INVENTORY_LABEL) return 1;
    return a.localeCompare(b);
  });

  return names.map((name) => [name, groups.get(name)!]);
}

function printLotTable(title: string, lots: ValuedLot[]): void {
  console.log(`\n${chalk.bold.cyan(title)}`);
  const table = new Table({
    head: [
      'Item',
      'Qty',
      'Buy',
      'CSFloat',
      'Invested',
      'Value',
      'Net (2%)',
      'P/L $',
      'P/L %',
    ],
    colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    style: { head: ['white'], compact: true },
    wordWrap: true,
    colWidths: [42, 6, 10, 10, 12, 12, 12, 12, 10],
  });

  for (const lot of lots) {
    table.push([
      lot.market_hash_name,
      String(lot.quantity),
      formatUsd(lot.buyPrice),
      formatUsd(lot.unitPrice),
      formatUsd(lot.invested),
      formatUsd(lot.marketValue),
      formatUsd(lot.netLiquidated),
      colorPnl(lot.profitUsd, formatUsd(lot.profitUsd)),
      colorPnl(lot.profitUsd, formatPct(lot.profitPct)),
    ]);
  }

  console.log(table.toString());
}

export function printReport(summary: PortfolioSummary): void {
  console.log(`\n${chalk.bold('CS2 Inventory Tracker')}`);
  console.log(chalk.dim('Prices from CSFloat lowest buy-now listing. Net value assumes a 2% fee.'));

  for (const [location, lots] of locationGroups(summary.lots)) {
    printLotTable(`${location}  (${lots.reduce((sum, lot) => sum + lot.quantity, 0)} items)`, lots);
  }

  console.log(`\n${chalk.bold.cyan('Totals by item')}`);
  const rollupTable = new Table({
    head: ['Item', 'Qty', 'Locations', 'Invested', 'Value', 'Net (2%)', 'P/L $', 'P/L %'],
    colAligns: ['left', 'right', 'left', 'right', 'right', 'right', 'right', 'right'],
    style: { head: ['white'], compact: true },
    wordWrap: true,
    colWidths: [42, 6, 24, 12, 12, 12, 12, 10],
  });

  for (const item of summary.rollups) {
    rollupTable.push([
      item.marketHashName,
      String(item.quantity),
      item.locations.join(', '),
      formatUsd(item.invested),
      formatUsd(item.marketValue),
      formatUsd(item.netLiquidated),
      colorPnl(item.profitUsd, formatUsd(item.profitUsd)),
      colorPnl(item.profitUsd, formatPct(item.profitPct)),
    ]);
  }
  console.log(rollupTable.toString());

  const summaryTable = new Table({
    style: { compact: true },
    colWidths: [32, 18],
  });
  summaryTable.push(
    { 'Total items': String(summary.totalQuantity) },
    { 'Distinct items': String(summary.rollups.length) },
    { 'Priced / unpriced': `${summary.pricedItems} / ${summary.unpricedItems}` },
    { 'Total cost basis': formatUsd(summary.totalInvested) },
    { 'CSFloat market value': formatUsd(summary.totalMarketValue) },
    { 'Net liquidated value (2%)': formatUsd(summary.totalNetLiquidated) },
    {
      'Overall P/L': colorPnl(summary.totalProfitUsd, formatUsd(summary.totalProfitUsd)),
    },
    {
      'Overall ROI': colorPnl(summary.totalProfitUsd, formatPct(summary.overallRoiPct)),
    },
  );

  console.log(`\n${chalk.bold.cyan('Portfolio summary')}`);
  console.log(summaryTable.toString());
  console.log(chalk.dim('\nSet a buy price:  npm start -- --set-price "Kilowatt Case" 0.45'));
  console.log(chalk.dim('Revalue without Steam:  npm start -- --offline\n'));
}
