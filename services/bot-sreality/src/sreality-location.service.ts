import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

// One shared client for the undocumented Sreality "suggest" endpoint
// that powers the locality autocomplete on sreality.cz. Used in two
// places:
//   - parse-url: resolve (region-id, region-typ) from a pasted search
//     URL to {lat, lon} so the matcher can do a radius filter
//   - /suggest:  forward autocomplete queries from the configure form
//
// We intentionally keep this as a thin proxy. The Sreality response
// schema (`userData.*`) is opaque to the rest of the bot.
interface SrealitySuggestRaw {
  count: number;
  data: Array<{
    category: string;
    userData: {
      id: number;
      entityType: string; // 'municipality' | 'ward' | 'district' | ...
      latitude: number;
      longitude: number;
      municipality?: string;
      district?: string;
      region?: string;
      suggestFirstRow?: string;
      suggestSecondRow?: string;
      country?: string;
    };
  }>;
}

export interface SrealityRegionHit {
  id: number;
  entityType: string;
  label: string;
  lat: number;
  lon: number;
}

const SUGGEST_URL = 'https://www.sreality.cz/api/cs/v2/suggest';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

function buildLabel(d: SrealitySuggestRaw['data'][number]): string {
  const u = d.userData;
  const first = u.suggestFirstRow?.trim();
  const second = u.suggestSecondRow?.trim();
  if (first && second) return `${first} — ${second}`;
  if (first) return first;
  const parts = [u.municipality, u.district, u.region].filter(Boolean);
  return parts.length ? parts.join(', ') : `${u.entityType} #${u.id}`;
}

@Injectable()
export class SrealityLocationService {
  private readonly logger = new Logger(SrealityLocationService.name);

  /** Free-text autocomplete. Returns up to `limit` region candidates. */
  async suggest(phrase: string, limit = 8): Promise<SrealityRegionHit[]> {
    const q = phrase.trim();
    if (!q) return [];
    const { data } = await axios.get<SrealitySuggestRaw>(SUGGEST_URL, {
      params: { phrase: q },
      headers: HEADERS,
      timeout: 8_000,
    });
    const hits = (data?.data ?? [])
      .filter((d) => d?.userData && Number.isFinite(d.userData.latitude) && Number.isFinite(d.userData.longitude))
      .slice(0, limit)
      .map<SrealityRegionHit>((d) => ({
        id: d.userData.id,
        entityType: d.userData.entityType,
        label: buildLabel(d),
        lat: d.userData.latitude,
        lon: d.userData.longitude,
      }));
    return hits;
  }

  /**
   * Resolve a (region-name, region-id, region-typ) triple coming from
   * a sreality.cz search URL to its centre coordinates. We call the
   * same autocomplete the website uses and pick the entry whose `id`
   * AND `entityType` match — that's how the website disambiguates
   * homonymous places (e.g. multiple villages called "Lhota").
   *
   * Returns `null` only when the suggest call returned a result list
   * that just didn't contain our (id, typ) pair. Network / API errors
   * are propagated up so the caller can fail-loud (per repo policy:
   * no silent fallbacks).
   */
  async resolveRegion(
    name: string,
    regionId: number,
    regionTyp: string,
  ): Promise<SrealityRegionHit | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const hits = await this.suggest(trimmed, 20);
    const exact = hits.find(
      (h) => h.id === regionId && h.entityType === regionTyp,
    );
    if (exact) return exact;
    // Same id, any type — Sreality URLs occasionally carry a slightly
    // different `region-typ` than the suggest API returns for the same
    // entity. The id is authoritative.
    const byId = hits.find((h) => h.id === regionId);
    if (byId) {
      this.logger.warn(
        `resolveRegion: id ${regionId} matched but entityType differs (url=${regionTyp}, api=${byId.entityType})`,
      );
      return byId;
    }
    return null;
  }
}
