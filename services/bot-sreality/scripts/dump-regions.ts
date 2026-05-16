/**
 * Captures every Czech-territory region (kraj, okres, obec, městská
 * část, čtvrť, ulice) that sreality.cz/api/cs/v2/suggest is willing to
 * surface, and writes them to a static JSON file consumed at boot by
 * the seeder. Foreign OSM entries (category endings other than `_cz`)
 * are dropped — they pollute the autocomplete with countries we cannot
 * search anyway.
 *
 * Sreality's suggest API caps each response at ~10 hits and ranks by
 * relevance, so a plain alphabet sweep misses long-tail wards and the
 * lower-ranked kraje. We therefore complement the sweep with a fixed
 * list of well-known phrases (the 14 kraje, the okres-name skeleton,
 * and the major-city `<city>-` ward expansion).
 */
import axios, { AxiosError } from 'axios';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SUGGEST_URL = 'https://www.sreality.cz/api/cs/v2/suggest';
const OUT_PATH = resolve(__dirname, '..', 'data', 'regions.json');
const CONCURRENCY = 2;
const RETRY_LIMIT = 5;
const RETRY_BASE_MS = 2_000;
const PER_REQUEST_DELAY_MS = 120;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const FIRST_LETTERS = [
  'a','á','b','c','č','d','ď','e','é','ě',
  'f','g','h','i','í','j','k','l','m','n','ň',
  'o','ó','p','q','r','ř','s','š','t','ť',
  'u','ú','ů','v','w','x','y','ý','z','ž',
];
const SECOND_LETTERS = [
  'a','á','b','c','č','d','e','é','ě','f',
  'g','h','i','í','j','k','l','m','n','o',
  'ó','p','r','ř','s','š','t','u','ú','ů',
  'v','w','y','ý','z','ž',
];

const KRAJE = [
  'Hlavní město Praha',
  'Středočeský kraj',
  'Jihočeský kraj',
  'Plzeňský kraj',
  'Karlovarský kraj',
  'Ústecký kraj',
  'Liberecký kraj',
  'Královéhradecký kraj',
  'Pardubický kraj',
  'Olomoucký kraj',
  'Moravskoslezský kraj',
  'Jihomoravský kraj',
  'Zlínský kraj',
  'Kraj Vysočina',
];

// Sreality returns districts when their full "Okres <city>" form is
// queried. The 76 CZ okresy follow the kraj-name pattern below; we
// don't enumerate every name, we just probe the high-population okresy
// + every kraj capital, which covers the URLs people actually paste.
const OKRES_SEEDS = [
  'Okres Praha-východ', 'Okres Praha-západ', 'Okres Beroun', 'Okres Kladno',
  'Okres Mělník', 'Okres Mladá Boleslav', 'Okres Nymburk', 'Okres Příbram',
  'Okres České Budějovice', 'Okres Český Krumlov', 'Okres Jindřichův Hradec',
  'Okres Písek', 'Okres Prachatice', 'Okres Strakonice', 'Okres Tábor',
  'Okres Plzeň-město', 'Okres Plzeň-jih', 'Okres Plzeň-sever', 'Okres Domažlice',
  'Okres Klatovy', 'Okres Rokycany', 'Okres Tachov',
  'Okres Cheb', 'Okres Karlovy Vary', 'Okres Sokolov',
  'Okres Děčín', 'Okres Chomutov', 'Okres Litoměřice', 'Okres Louny',
  'Okres Most', 'Okres Teplice', 'Okres Ústí nad Labem',
  'Okres Česká Lípa', 'Okres Jablonec nad Nisou', 'Okres Liberec', 'Okres Semily',
  'Okres Hradec Králové', 'Okres Jičín', 'Okres Náchod', 'Okres Rychnov nad Kněžnou', 'Okres Trutnov',
  'Okres Chrudim', 'Okres Pardubice', 'Okres Svitavy', 'Okres Ústí nad Orlicí',
  'Okres Havlíčkův Brod', 'Okres Jihlava', 'Okres Pelhřimov', 'Okres Třebíč', 'Okres Žďár nad Sázavou',
  'Okres Blansko', 'Okres Brno-město', 'Okres Brno-venkov', 'Okres Břeclav',
  'Okres Hodonín', 'Okres Vyškov', 'Okres Znojmo',
  'Okres Jeseník', 'Okres Olomouc', 'Okres Prostějov', 'Okres Přerov', 'Okres Šumperk',
  'Okres Kroměříž', 'Okres Uherské Hradiště', 'Okres Vsetín', 'Okres Zlín',
  'Okres Bruntál', 'Okres Frýdek-Místek', 'Okres Karviná', 'Okres Nový Jičín',
  'Okres Opava', 'Okres Ostrava-město',
];

// Major cities whose wards/quarters tend to appear as separate entities
// in Sreality URLs. Probing `<city>-` plus a `<city>-<letter>` skeleton
// pulls the autocomplete past the top municipality match.
const MAJOR_CITIES = ['praha', 'brno', 'ostrava', 'plzeň', 'liberec', 'olomouc'];

interface SrealityHit {
  category: string;
  userData: {
    id: number;
    entityType: string;
    latitude: number;
    longitude: number;
    municipality?: string;
    district?: string;
    region?: string;
    suggestFirstRow?: string;
    suggestSecondRow?: string;
    country?: string;
  };
}

export interface RegionRecord {
  // Composite `_id` of the form `<region_typ>:<sreality_id>` because
  // Sreality scopes its numeric IDs by entity type — id=11 is both a
  // region (Středočeský kraj) and a quarter (Brno-střed).
  _id: string;
  sreality_id: number;
  region_typ: string;
  name: string;
  name_normalised: string;
  label: string;
  parents: {
    municipality?: string;
    district?: string;
    region?: string;
    country?: string;
  };
  center: { type: 'Point'; coordinates: [number, number] };
}

function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function buildLabel(u: SrealityHit['userData']): string {
  const first = u.suggestFirstRow?.trim();
  const second = u.suggestSecondRow?.trim();
  if (first && second) return `${first} — ${second}`;
  if (first) return first;
  const parts = [u.municipality, u.district, u.region].filter(Boolean) as string[];
  return parts.length ? parts.join(', ') : `${u.entityType} #${u.id}`;
}

function buildName(u: SrealityHit['userData']): string {
  const first = u.suggestFirstRow?.trim();
  if (first) {
    return first
      .replace(/^(obec|m[ěe]stsk[áa] [čc][áa]st|m[ěe]stsk[ýy] obvod|[čc]tvr[ťt]|okres|kraj|ulice)\s+/i, '')
      .trim();
  }
  return u.municipality?.trim() || u.district?.trim() || u.region?.trim() || `id ${u.id}`;
}

function isCzechHit(hit: SrealityHit): boolean {
  return /(_cz)$/i.test(hit.category);
}

function toRecord(hit: SrealityHit): RegionRecord | null {
  if (!isCzechHit(hit)) return null;
  const u = hit.userData;
  if (!u || !Number.isFinite(u.id) || !u.entityType) return null;
  if (!Number.isFinite(u.latitude) || !Number.isFinite(u.longitude)) return null;
  const name = buildName(u);
  if (!name) return null;
  return {
    _id: `${u.entityType}:${u.id}`,
    sreality_id: u.id,
    region_typ: u.entityType,
    name,
    name_normalised: normalise(name),
    label: buildLabel(u),
    parents: {
      municipality: u.municipality?.trim() || undefined,
      district: u.district?.trim() || undefined,
      region: u.region?.trim() || undefined,
      country: u.country?.trim() || undefined,
    },
    center: { type: 'Point', coordinates: [u.longitude, u.latitude] },
  };
}

async function fetchPhrase(phrase: string, attempt = 0): Promise<SrealityHit[]> {
  try {
    const { data } = await axios.get<{ data?: SrealityHit[] }>(SUGGEST_URL, {
      params: { phrase },
      headers: HEADERS,
      timeout: 8_000,
    });
    return data?.data ?? [];
  } catch (err) {
    const ax = err as AxiosError;
    const status = ax.response?.status;
    // Sreality answers "no dictionary match" with HTTP 400 + the body
    // `{ message: "Server error. Please step away from the device..." }`.
    // Treat that pair as an empty result rather than retrying.
    if (status === 400) return [];
    if (attempt >= RETRY_LIMIT) {
      process.stderr.write(
        `  giving up on "${phrase}" after ${RETRY_LIMIT} attempts (last status=${status ?? '-'})\n`,
      );
      throw err;
    }
    const wait = RETRY_BASE_MS * (attempt + 1);
    process.stderr.write(
      `  retry "${phrase}" (attempt ${attempt + 1}/${RETRY_LIMIT}, status=${status ?? '-'}) after ${wait}ms\n`,
    );
    await new Promise((r) => setTimeout(r, wait));
    return fetchPhrase(phrase, attempt + 1);
  }
}

async function runPool<T>(
  inputs: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  const next = async (): Promise<void> => {
    while (i < inputs.length) {
      const idx = i++;
      await worker(inputs[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, next));
}

function buildPrefixes(): string[] {
  const out: string[] = [];

  // 1- and 2-letter alphabet sweep (incl. diacritics).
  for (const a of FIRST_LETTERS) {
    out.push(a);
    for (const b of SECOND_LETTERS) out.push(a + b);
  }

  // Kraje by exact name (the autocomplete returns only the matching
  // kraj for a fully-spelled phrase).
  for (const name of KRAJE) out.push(name);

  // Okresy by skeleton.
  for (const name of OKRES_SEEDS) out.push(name);

  // Major-city ward expansion: `praha-a`, `praha-b`, …
  for (const city of MAJOR_CITIES) {
    out.push(city + '-');
    for (const a of FIRST_LETTERS) out.push(city + '-' + a);
    // Praha's wards include numeric IDs (Praha 1 … Praha 22).
    if (city === 'praha') {
      for (let i = 1; i <= 22; i++) out.push(`praha ${i}`);
    }
  }

  return Array.from(new Set(out));
}

async function main(): Promise<void> {
  const prefixes = buildPrefixes();
  const records = new Map<string, RegionRecord>();
  let processed = 0;

  await runPool(prefixes, CONCURRENCY, async (phrase) => {
    const hits = await fetchPhrase(phrase);
    for (const hit of hits) {
      const rec = toRecord(hit);
      if (rec) records.set(rec._id, rec);
    }
    processed++;
    if (processed % 100 === 0 || processed === prefixes.length) {
      process.stdout.write(
        `  swept ${processed}/${prefixes.length} prefixes, ${records.size} unique CZ regions\n`,
      );
    }
    if (PER_REQUEST_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, PER_REQUEST_DELAY_MS));
    }
  });

  if (records.size === 0) {
    throw new Error('Sreality suggest returned 0 CZ regions across the entire prefix sweep — refusing to write empty regions.json');
  }

  const sorted = Array.from(records.values()).sort((a, b) =>
    a.region_typ.localeCompare(b.region_typ) || a.sreality_id - b.sreality_id,
  );
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(sorted, null, 0) + '\n', 'utf-8');

  const byType = sorted.reduce<Record<string, number>>((acc, r) => {
    acc[r.region_typ] = (acc[r.region_typ] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byType)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  process.stdout.write(`Wrote ${sorted.length} regions to ${OUT_PATH}\n  ${summary}\n`);
}

void main();
