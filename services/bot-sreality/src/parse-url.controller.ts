import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { SrealityLocationService } from './sreality-location.service.js';

interface ParseBody {
  url?: string;
}

interface ParsedGeo {
  center: { type: 'Point'; coordinates: [number, number] };
  radius_km: number;
  region_label: string;
}

interface Parsed {
  category_main_cb?: 1 | 2;
  category_type_cb?: 1 | 2;
  category_sub_cb?: number[];
  price_min?: number;
  price_max?: number;
  // Set only when the URL had `region` but lacked a usable radius
  // (`vzdalenost` missing or 0). With a radius the geo fields below
  // take over and city_contains stays unset.
  city_contains?: string;
  center?: ParsedGeo['center'];
  radius_km?: number;
  region_label?: string;
}

type ParseResult =
  | { ok: true; parsed: Parsed }
  | { ok: false; reason: string };

const APT_VELIKOST_TO_CB: Record<string, number> = {
  '1+kk': 2, '1+1': 3, '2+kk': 4, '2+1': 5,
  '3+kk': 6, '3+1': 7, '4+kk': 8, '4+1': 9,
  '5+kk': 10, '5+1': 11,
  '6-a-vice': 12, '6+': 12,
  atypicky: 16, 'atypicky-byt': 16,
};

const HOUSE_TYP_TO_CB: Record<string, number> = {
  'rodinny-dum': 37,
  rodinny: 37,
  vila: 39,
  chata: 33,
  chalupa: 43,
  farma: 44,
  'mobilni-dum': 48,
  vicegeneracni: 54,
};

interface SyntacticParse {
  out: Parsed;
  region?: { name: string; id: number; typ: string };
  radiusKm?: number;
}

function parseSyntactic(input: string | undefined): { ok: false; reason: string } | { ok: true; data: SyntacticParse } {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'Paste a sreality.cz search URL.' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'That doesn\u2019t look like a valid URL.' };
  }
  if (!/(^|\.)sreality\.cz$/i.test(url.hostname)) {
    return { ok: false, reason: 'URL must be on sreality.cz.' };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const idx = segments.indexOf('hledani');
  const transaction = idx >= 0 ? segments[idx + 1] : null;
  const property = idx >= 0 ? segments[idx + 2] : null;

  const out: Parsed = {};
  if (transaction === 'prodej') out.category_type_cb = 1;
  else if (transaction === 'pronajem') out.category_type_cb = 2;

  let dispoSource: number[] = [];
  if (property === 'byty') {
    out.category_main_cb = 1;
    const v = url.searchParams.get('velikost');
    if (v) {
      dispoSource = v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .map((s) => APT_VELIKOST_TO_CB[s])
        .filter((n): n is number => Number.isFinite(n));
    }
  } else if (property === 'domy') {
    out.category_main_cb = 2;
    const t = url.searchParams.get('typ');
    if (t) {
      dispoSource = t
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .map((s) => HOUSE_TYP_TO_CB[s])
        .filter((n): n is number => Number.isFinite(n));
    }
  }
  if (dispoSource.length) {
    out.category_sub_cb = Array.from(new Set(dispoSource));
  }

  const min = url.searchParams.get('cena-od');
  const max = url.searchParams.get('cena-do');
  if (min) {
    const n = Number.parseInt(min, 10);
    if (Number.isFinite(n)) out.price_min = n;
  }
  if (max) {
    const n = Number.parseInt(max, 10);
    if (Number.isFinite(n)) out.price_max = n;
  }

  const regionName = url.searchParams.get('region')?.trim();
  const regionIdStr = url.searchParams.get('region-id');
  const regionTyp = url.searchParams.get('region-typ')?.trim();
  const vzdalenostStr = url.searchParams.get('vzdalenost');

  const regionId = regionIdStr ? Number.parseInt(regionIdStr, 10) : NaN;
  const radiusKm = vzdalenostStr ? Number.parseInt(vzdalenostStr, 10) : NaN;

  const data: SyntacticParse = { out };
  if (regionName && Number.isFinite(regionId) && regionTyp) {
    data.region = { name: regionName, id: regionId, typ: regionTyp };
  }
  if (Number.isFinite(radiusKm) && radiusKm > 0) {
    data.radiusKm = radiusKm;
  }
  return { ok: true, data };
}

@Controller('parse-url')
export class ParseUrlController {
  private readonly logger = new Logger(ParseUrlController.name);

  constructor(private readonly location: SrealityLocationService) {}

  // Internal helper, intentionally NOT part of the public bot-service
  // contract — the configure.html template calls this from the same
  // origin as the page it serves so the URL grammar of sreality.cz
  // never has to leak into the BFF or the platform-wide shape.
  @Post()
  @HttpCode(HttpStatus.OK)
  async parse(@Body() body: ParseBody): Promise<ParseResult> {
    const syn = parseSyntactic(body?.url);
    if (!syn.ok) return syn;
    const { out, region, radiusKm } = syn.data;

    // Geo resolution: only if the URL carries BOTH a region triple AND
    // a positive vzdalenost. Without a radius we have no way to do a
    // meaningful $geoWithin so we fall back to a string filter.
    if (region && radiusKm) {
      const hit = await this.location.resolveRegion(region.name, region.id, region.typ);
      if (!hit) {
        return {
          ok: false,
          reason: `Could not resolve "${region.name}" (id ${region.id}, ${region.typ}) on Sreality.`,
        };
      }
      out.center = { type: 'Point', coordinates: [hit.lon, hit.lat] };
      out.radius_km = radiusKm;
      out.region_label = `${hit.label} \u00b7 within ${radiusKm} km`;
    } else if (region) {
      // No radius — best we can do is a name-based filter so the import
      // stays useful (this is the legacy behaviour).
      out.city_contains = region.name;
    }

    if (!Object.keys(out).length) {
      return { ok: false, reason: 'Could not extract any filters from this URL.' };
    }
    return { ok: true, parsed: out };
  }
}
