import { resolveItem } from 'cs2-inventory-resolver';
import { MAIN_INVENTORY_LABEL, STORAGE_UNIT_DEF_INDEX } from './config.js';
import type { GcItem, InventoryLot } from './types.js';

const VANILLA_GUNS = new Set([
  'ak-47',
  'm4a4',
  'm4a1-s',
  'awp',
  'aug',
  'sg 553',
  'famas',
  'galil ar',
  'g3sg1',
  'scar-20',
  'ssg 08',
  'glock-18',
  'usp-s',
  'p2000',
  'p250',
  'five-seven',
  'tec-9',
  'cz75-auto',
  'desert eagle',
  'r8 revolver',
  'dual berettas',
  'mac-10',
  'mp9',
  'mp7',
  'mp5-sd',
  'ump-45',
  'p90',
  'pp-bizon',
  'nova',
  'xm1014',
  'sawed-off',
  'mag-7',
  'm249',
  'negev',
  'zeus x27',
]);

export interface TrackableMeta {
  marketable?: boolean | number;
  type?: string;
  tags?: string[];
  entity?: string;
}

export function itemId(item: GcItem): string {
  return String(item.id ?? '');
}

export function defIndex(item: GcItem): number {
  return Number(item.def_index ?? item.defindex ?? 0);
}

export function isStorageUnit(item: GcItem): boolean {
  return defIndex(item) === STORAGE_UNIT_DEF_INDEX || typeof item.casket_contained_item_count === 'number';
}

export function storageUnitLabel(item: GcItem): string {
  const custom = (item.custom_name || item.customname || '').toString().trim();
  if (custom) return custom;
  const shortId = itemId(item).slice(-6) || 'unknown';
  return `Storage Unit ${shortId}`;
}

function textBlob(meta: TrackableMeta): string {
  return `${meta.type ?? ''} ${(meta.tags ?? []).join(' ')} ${meta.entity ?? ''}`.toLowerCase();
}

function isVanillaGun(name: string): boolean {
  const base = name
    .replace(/^★\s+/u, '')
    .replace(/^stattrak™\s+/i, '')
    .replace(/^souvenir\s+/i, '')
    .trim()
    .toLowerCase();
  return !base.includes('|') && VANILLA_GUNS.has(base);
}

function isWearlessWeaponSkin(name: string): boolean {
  if (/^(sticker|sticker slab|charm|patch|music kit|pin|sealed graffiti|graffiti)\b/i.test(name)) return false;
  if (!name.includes('|')) return false;
  if (/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i.test(name)) return false;
  const base = name
    .replace(/^★\s+/u, '')
    .replace(/^stattrak™\s+/i, '')
    .replace(/^souvenir\s+/i, '')
    .trim();
  const weapon = base.split('|')[0].trim().toLowerCase();
  return VANILLA_GUNS.has(weapon);
}

export function stickerNameFromSlab(name: string): string | null {
  if (!name.startsWith('Sticker Slab | ')) return null;
  return `Sticker | ${name.slice('Sticker Slab | '.length)}`;
}

export function priceLookupName(name: string): string {
  return stickerNameFromSlab(name) ?? name;
}

export function classifyItem(name: string): string {
  const n = name.trim();
  if (/^sticker slab \|/i.test(n) || /\bsticker \|/i.test(n)) return 'Sticker';
  if (/\bcharm \|/i.test(n)) return 'Charm';
  if (/\bmusic kit\b/i.test(n)) return 'Music Kit';
  if (/\bpatch \|/i.test(n)) return 'Patch';
  if (/\bpin$/i.test(n)) return 'Pin';
  if (/\b(case key|key)$/i.test(n)) return 'Key';
  if (/\bcapsule\b/i.test(n) && !n.includes('|')) return 'Capsule';
  if (/\b(case|package|terminal)\b/i.test(n) && !n.includes('|')) return 'Case';
  if (n.startsWith('★') || n.includes('|')) return 'Skin';
  return 'Other';
}

export function csfloatSearchUrl(name: string): string {
  return `https://csfloat.com/search?market_hash_name=${encodeURIComponent(priceLookupName(name))}`;
}

export function isTrackableItem(name: string, meta: TrackableMeta = {}): boolean {
  const n = name.trim();
  if (!n || n.startsWith('Unknown Item')) return false;

  const blob = `${n} ${textBlob(meta)}`.toLowerCase();
  if (blob.includes('graffiti')) return false;
  if (/charm detach/i.test(n)) return false;
  if (/^storage unit\b/i.test(n)) return false;
  if (/\b(service medal|veteran coin|global offensive badge|premier season .+ medal)\b/i.test(n)) return false;
  if (/\bmedal\b/i.test(n) && !n.includes('|')) return false;
  if (/\bbadge\b/i.test(n) && !n.includes('|')) return false;
  if (/^valve,/i.test(n)) return false;
  if (isVanillaGun(n)) return false;
  if (isWearlessWeaponSkin(n)) return false;
  if (n === 'P250 | X-Ray') return false;
  if (meta.entity === 'graffiti') return false;
  if (meta.entity === 'tool' && /charm detach|storage unit|stattrak™ swap/i.test(n)) return false;

  const marketable = meta.marketable;
  if (marketable === 0 || marketable === false) {
    const keepDespiteHold =
      n.includes('|') ||
      /\b(case|capsule|package|key|pin|music kit|patch|charm|terminal|sticker slab)\b/i.test(n);
    if (!keepDespiteHold) return false;
  }

  return true;
}

export function resolveGcItem(item: GcItem) {
  try {
    return resolveItem({
      def_index: defIndex(item),
      paint_index: Number(item.paint_index ?? item.paintindex ?? 0) || undefined,
      quality: typeof item.quality === 'number' ? item.quality : undefined,
      paint_wear: Number(item.paint_wear ?? item.paintwear ?? 0) || undefined,
      stickers: item.stickers,
      attribute: item.attribute,
    });
  } catch {
    return null;
  }
}

export function resolveMarketHashName(item: GcItem, communityNames: Map<string, string> = new Map()): string {
  const id = itemId(item);
  const fromCommunity = id ? communityNames.get(id) : undefined;
  if (fromCommunity) return fromCommunity;

  const resolved = resolveGcItem(item);
  if (resolved?.name) return resolved.name;

  const paint = Number(item.paint_index ?? item.paintindex ?? 0);
  return paint > 0
    ? `Unknown Item (def ${defIndex(item)}, paint ${paint})`
    : `Unknown Item (def ${defIndex(item)})`;
}

export function aggregateLots(lots: InventoryLot[]): InventoryLot[] {
  const grouped = new Map<string, InventoryLot>();
  for (const lot of lots) {
    const key = `${lot.market_hash_name}\0${lot.location}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += lot.quantity;
    } else {
      grouped.set(key, { ...lot });
    }
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.location === MAIN_INVENTORY_LABEL && b.location !== MAIN_INVENTORY_LABEL) return -1;
    if (b.location === MAIN_INVENTORY_LABEL && a.location !== MAIN_INVENTORY_LABEL) return 1;
    const locationCmp = a.location.localeCompare(b.location);
    if (locationCmp !== 0) return locationCmp;
    return a.market_hash_name.localeCompare(b.market_hash_name);
  });
}

export function filterTrackableLots(lots: InventoryLot[]): InventoryLot[] {
  return aggregateLots(lots.filter((lot) => isTrackableItem(lot.market_hash_name)));
}

export function toLot(item: GcItem, location: string, communityNames: Map<string, string>): InventoryLot | null {
  const resolved = resolveGcItem(item);
  const name = resolveMarketHashName(item, communityNames);
  if (
    !isTrackableItem(name, {
      marketable: resolved?.marketable,
      entity: resolved?.entity,
    })
  ) {
    return null;
  }
  return { market_hash_name: name, quantity: 1, location };
}
