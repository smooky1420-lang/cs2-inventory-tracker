import fs from 'node:fs';
import axios from 'axios';
import SteamUser from 'steam-user';
import NodeCS2 from 'node-cs2';
import SteamTotp from 'steam-totp';
import {
  CS2_APP_ID,
  ENV_PATH,
  MAIN_INVENTORY_LABEL,
  REFRESH_TOKEN_PATH,
  STEAM_DATA_DIR,
  config,
  ensureSteamDataDir,
} from './config.js';
import { aggregateLots, filterTrackableLots, isStorageUnit, isTrackableItem, itemId, storageUnitLabel, toLot } from './items.js';
import { prompt, sleep } from './utils.js';
import type { GcItem, InventoryLot, SteamFetchOptions } from './types.js';

type SteamUserInstance = InstanceType<typeof SteamUser>;

interface CommunityAsset {
  assetid?: string;
  classid?: string;
  instanceid?: string;
  amount?: string | number;
}

interface CommunityDescription {
  classid?: string;
  instanceid?: string;
  market_hash_name?: string;
  name?: string;
  marketable?: number;
  type?: string;
  tags?: Array<{ category?: string; localized_tag_name?: string }>;
}

interface CommunityInventoryResponse {
  assets?: CommunityAsset[];
  descriptions?: CommunityDescription[];
  more_items?: number;
  last_assetid?: string;
  success?: number;
}

interface CommunityInventory {
  names: Map<string, string>;
  lots: InventoryLot[];
}

function loadRefreshToken(): string | null {
  try {
    const token = fs.readFileSync(REFRESH_TOKEN_PATH, 'utf8').trim();
    return token || null;
  } catch {
    return null;
  }
}

function saveRefreshToken(token: string): void {
  ensureSteamDataDir();
  fs.writeFileSync(REFRESH_TOKEN_PATH, token, 'utf8');
}

async function steamGuardCode(
  domain: string | null,
  lastCodeWrong: boolean,
  requestSteamGuard?: SteamFetchOptions['requestSteamGuard'],
): Promise<string> {
  if (config.steamSharedSecret) {
    if (lastCodeWrong) {
      console.log('Previous Steam Guard code was rejected. Waiting for the next TOTP window...');
      await sleep(30_000);
    }
    return SteamTotp.generateAuthCode(config.steamSharedSecret);
  }

  if (requestSteamGuard) {
    return requestSteamGuard({ domain, lastCodeWrong });
  }

  const source = domain ? `email (${domain})` : 'mobile authenticator';
  if (lastCodeWrong) {
    console.log('That Steam Guard code was incorrect.');
  }
  return prompt(`Enter Steam Guard code from ${source}: `);
}

function getCasketContents(cs2: InstanceType<typeof NodeCS2>, casketId: string): Promise<GcItem[]> {
  return cs2.getCasketContents(casketId) as unknown as Promise<GcItem[]>;
}

async function fetchCommunityInventory(client: SteamUserInstance, cookies: string[]): Promise<CommunityInventory> {
  const names = new Map<string, string>();
  const lots: InventoryLot[] = [];
  const steamId = client.steamID?.getSteamID64();
  if (!steamId) return { names, lots };

  const cookieHeader = cookies.join('; ');
  let startAssetId: string | undefined;

  try {
    do {
      const url = new URL(`https://steamcommunity.com/inventory/${steamId}/${CS2_APP_ID}/2`);
      url.searchParams.set('l', 'english');
      url.searchParams.set('count', '2000');
      if (startAssetId) url.searchParams.set('start_assetid', startAssetId);

      const { data } = await axios.get<CommunityInventoryResponse>(url.toString(), {
        headers: { Cookie: cookieHeader },
        timeout: 20_000,
        validateStatus: (status) => status < 500,
      });

      if (!data?.assets || !data.descriptions) break;

      const descByClass = new Map<string, CommunityDescription>();
      for (const desc of data.descriptions) {
        descByClass.set(`${desc.classid}_${desc.instanceid}`, desc);
      }

      for (const asset of data.assets) {
        const desc = descByClass.get(`${asset.classid}_${asset.instanceid}`);
        const name = desc?.market_hash_name || desc?.name;
        if (!asset.assetid || !name) continue;
        if (
          !isTrackableItem(name, {
            marketable: desc?.marketable,
            type: desc?.type,
            tags: (desc?.tags ?? []).map((tag) => tag.localized_tag_name ?? '').filter(Boolean),
          })
        ) {
          continue;
        }
        names.set(String(asset.assetid), name);
        lots.push({
          market_hash_name: name,
          quantity: Number(asset.amount ?? 1) || 1,
          location: MAIN_INVENTORY_LABEL,
        });
      }

      startAssetId = data.more_items ? data.last_assetid : undefined;
    } while (startAssetId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`Could not load Steam Community inventory (${message}). Falling back to GC item resolver.`);
  }

  return { names, lots: aggregateLots(lots) };
}

async function collectInventory(
  cs2: InstanceType<typeof NodeCS2>,
  community: CommunityInventory,
  progress: (message: string) => void,
): Promise<InventoryLot[]> {
  const inventory = (cs2.inventory ?? []) as unknown as GcItem[];
  const lots: InventoryLot[] = [];
  const caskets = inventory.filter(isStorageUnit);

  // Steam Community inventory is the source of truth for Main Inventory.
  // The Game Coordinator sometimes reports leftover/schema items that are not
  // actually in the backpack (this is what caused the fake CS:GO Weapon Case).
  if (community.lots.length > 0) {
    lots.push(...community.lots);
    const qty = community.lots.reduce((sum, lot) => sum + lot.quantity, 0);
    progress(`Main inventory (Steam): ${qty} item(s). Storage units: ${caskets.length}.`);
  } else {
    const mainItems = inventory.filter((item) => !isStorageUnit(item) && !item.casket_id);
    for (const item of mainItems) {
      const lot = toLot(item, MAIN_INVENTORY_LABEL, community.names);
      if (lot) lots.push(lot);
    }
    progress(`Main inventory (GC fallback): ${mainItems.length} item(s). Storage units: ${caskets.length}.`);
  }

  for (const [index, casket] of caskets.entries()) {
    const label = storageUnitLabel(casket);
    const id = itemId(casket);
    const contained = Number(casket.casket_contained_item_count ?? 0);
    progress(`Fetching storage unit ${index + 1}/${caskets.length}: "${label}" (${contained} item(s))...`);

    try {
      const contents = await getCasketContents(cs2, id);
      for (const item of contents) {
        const lot = toLot(item, label, community.names);
        if (lot) lots.push(lot);
      }
      progress(`Loaded ${contents.length} item(s) from "${label}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      progress(`Failed to read "${label}": ${message}`);
    }

    if (index < caskets.length - 1) {
      await sleep(400);
    }
  }

  return filterTrackableLots(lots);
}

function loginError(err: Error & { eresult?: number }): Error {
  const name = err.message || '';
  if (name.includes('InvalidPassword') || err.eresult === 5) {
    return new Error(
      `Steam rejected the password (InvalidPassword). If the password is correct, wrap it in double quotes in ${ENV_PATH} — characters like # start a comment unless quoted. Example: STEAM_PASSWORD="p@ss#word"`,
    );
  }
  return err;
}

function logOnWithCredentials(client: SteamUserInstance, progress: (message: string) => void): void {
  if (!config.steamAccountName || !config.steamPassword) {
    throw new Error(`Set STEAM_ACCOUNT_NAME and STEAM_PASSWORD in ${ENV_PATH}, or use --offline with a previous sync.`);
  }
  progress(`Logging into Steam as ${config.steamAccountName}...`);
  client.logOn({
    accountName: config.steamAccountName,
    password: config.steamPassword,
  });
}

async function waitForInventory(cs2: InstanceType<typeof NodeCS2>): Promise<void> {
  const started = Date.now();
  while (!Array.isArray(cs2.inventory) && Date.now() - started < 8_000) {
    await sleep(250);
  }
}

export async function fetchSteamInventory(options: SteamFetchOptions = {}): Promise<InventoryLot[]> {
  const progress = (message: string) => {
    console.log(message);
    options.onProgress?.(message);
  };

  const existingToken = loadRefreshToken();
  if (!existingToken && (!config.steamAccountName || !config.steamPassword)) {
    throw new Error(`Set STEAM_ACCOUNT_NAME and STEAM_PASSWORD in ${ENV_PATH}, or use --offline with a previous sync.`);
  }

  ensureSteamDataDir();

  const client = new SteamUser({
    dataDirectory: STEAM_DATA_DIR,
    renewRefreshTokens: true,
    autoRelogin: false,
  });
  const cs2 = new NodeCS2(client as never);

  const webCookies = new Promise<string[]>((resolve) => {
    client.once('webSession', (_sessionId: string, cookies: string[]) => resolve(cookies));
    setTimeout(() => resolve([]), 15_000);
  });

  const lots = await new Promise<InventoryLot[]>((resolve, reject) => {
    let finished = false;
    let usedRefreshToken = Boolean(existingToken);
    const fail = (err: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };
    const succeed = (value: InventoryLot[]) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(value);
    };

    const gcTimeout = setTimeout(() => {
      fail(new Error('Timed out waiting for the CS2 Game Coordinator. Is Steam / CS2 down?'));
    }, 45_000);

    const cleanup = () => {
      clearTimeout(gcTimeout);
      client.removeAllListeners();
      cs2.removeAllListeners();
    };

    client.on('error', (err: Error & { eresult?: number }) => {
      if (usedRefreshToken && config.steamAccountName && config.steamPassword) {
        usedRefreshToken = false;
        progress(`Refresh token login failed (${err.message}). Retrying with username/password...`);
        try {
          logOnWithCredentials(client, progress);
          return;
        } catch (retryErr) {
          fail(retryErr instanceof Error ? retryErr : err);
          return;
        }
      }
      fail(loginError(err));
    });
    client.on('disconnected', (eresult: number, msg?: string) => {
      if (!finished) fail(new Error(`Disconnected from Steam (${eresult}${msg ? `: ${msg}` : ''})`));
    });

    client.on('steamGuard', (domain: string | null, callback: (code: string) => void, lastCodeWrong: boolean) => {
      progress(domain ? `Steam Guard code needed from email (${domain}).` : 'Steam Guard mobile code needed.');
      steamGuardCode(domain, lastCodeWrong, options.requestSteamGuard)
        .then((code) => callback(code))
        .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
    });

    client.on('refreshToken', (token: string) => {
      saveRefreshToken(token);
      progress('Saved Steam refresh token for future logins.');
    });

    client.on('loggedOn', () => {
      progress(`Logged into Steam as ${client.steamID?.getSteamID64() ?? 'unknown'}. Launching CS2 GC...`);
      client.setPersona(SteamUser.EPersonaState.Online);
      client.gamesPlayed([CS2_APP_ID]);
    });

    client.on('appLaunched', (appid: number) => {
      if (appid === CS2_APP_ID) {
        cs2.helloGC();
      }
    });

    cs2.on('connectedToGC', async () => {
      try {
        progress('Connected to the CS2 Game Coordinator.');
        await waitForInventory(cs2);
        const cookies = await webCookies;
        const community = await fetchCommunityInventory(client, cookies);
        const inventory = await collectInventory(cs2, community, progress);
        succeed(inventory);
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });

    if (existingToken) {
      progress('Logging into Steam with a saved refresh token...');
      client.logOn({ refreshToken: existingToken });
    } else {
      logOnWithCredentials(client, progress);
    }
  });

  try {
    client.gamesPlayed([]);
    client.logOff();
  } catch {
    // Session teardown is best-effort.
  }

  return lots;
}
