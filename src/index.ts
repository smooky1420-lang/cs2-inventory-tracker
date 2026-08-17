import chalk from 'chalk';
import path from 'node:path';
import { config, ensureDataDir, hasSteamCredentials, isPackaged, USER_DIR } from './config.js';
import { lookupPrices } from './csfloat.js';
import { printReport } from './display.js';
import { loadPortfolio, savePortfolio, setBuyPrice, syncInventory } from './portfolio.js';
import { startServer } from './server.js';
import { fetchSteamInventory } from './steam.js';
import { parseArgs } from './utils.js';
import { valuePortfolio } from './valuation.js';

function printHelp(): void {
  console.log(`
${chalk.bold('CS2 Inventory Tracker')}

${chalk.bold('Web app (default)')}
  npm start

${chalk.bold('CLI')}
  npm run cli
  npm run cli -- --offline
  npm run cli -- --skip-prices
  npm run cli -- --set-price "Kilowatt Case" 0.45
`);
}

async function runCli(): Promise<void> {
  const flags = parseArgs(process.argv);

  if (flags.help) {
    printHelp();
    return;
  }

  if (flags.setPrice) {
    const record = setBuyPrice(flags.setPrice.name, flags.setPrice.price);
    console.log(`Set buy price for matching holding to ${chalk.bold(`$${record.buyPrice.toFixed(2)}`)}.`);
    flags.offline = true;
  }

  let portfolio = loadPortfolio();
  if (!flags.offline) {
    const inventory = await fetchSteamInventory();
    portfolio = syncInventory(inventory, true);
  } else if (portfolio.inventory.length === 0) {
    if (flags.setPrice) {
      console.log('Buy price saved. Run a Steam sync to populate inventory.');
      return;
    }
    throw new Error('No saved inventory. Run a Steam sync first.');
  } else {
    console.log(`Using last Steam sync (${portfolio.lastSteamSyncAt ?? 'unknown'}).`);
    portfolio = syncInventory(portfolio.inventory, false);
  }

  const quotes = flags.skipPrices
    ? new Map()
    : await lookupPrices(
        portfolio.inventory.map((lot) => lot.market_hash_name),
        (event) => console.log(event.message),
      );

  savePortfolio(portfolio);
  printReport(valuePortfolio(portfolio.inventory, portfolio, quotes));

  if (!config.csfloatApiKey && !flags.skipPrices) {
    console.log(chalk.dim('Tip: add CSFLOAT_API_KEY to .env if listings start returning 403s.'));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantsCli = args.includes('--cli') || args.includes('--offline') || args.includes('--set-price') || args.includes('--skip-prices');
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  ensureDataDir();
  if (isPackaged()) {
    console.log(`CS2 Inventory Tracker`);
    console.log(`Settings: ${path.join(USER_DIR, '.env')}`);
  }
  if (wantsCli) {
    await runCli();
    return;
  }
  if (!hasSteamCredentials()) {
    console.log('\nAdd STEAM_ACCOUNT_NAME and STEAM_PASSWORD to .env before Sync Steam.\n');
  }
  startServer();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`\n${message}\n`));
  process.exitCode = 1;
});
