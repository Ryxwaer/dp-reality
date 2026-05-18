import axios, { AxiosError } from 'axios';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  Listing,
  ListingSchema,
  type ListingDocument,
} from '../src/listing.schema';
import {
  SREALITY_CATEGORIES,
  SREALITY_HEADERS,
  parseEstate,
  type ListingData,
  type SrealityEstate,
} from '../src/sreality-parser';

const API_URL = 'https://www.sreality.cz/api/cs/v2/estates';
const PER_PAGE = 500;
const PER_REQUEST_DELAY_MS = 300;
const RETRY_LIMIT = 5;
const RETRY_BASE_MS = 2_000;
const REQUEST_TIMEOUT_MS = 60_000;

interface FetchPageResult {
  estates: SrealityEstate[];
  resultSize: number;
}

async function fetchPage(
  catMain: number,
  catType: number,
  page: number,
  attempt = 0,
): Promise<FetchPageResult> {
  try {
    const { data } = await axios.get<{
      result_size?: number;
      _embedded?: { estates?: SrealityEstate[] };
    }>(API_URL, {
      params: {
        category_main_cb: catMain,
        category_type_cb: catType,
        per_page: PER_PAGE,
        page,
      },
      headers: SREALITY_HEADERS,
      timeout: REQUEST_TIMEOUT_MS,
    });
    return {
      estates: data?._embedded?.estates ?? [],
      resultSize: data?.result_size ?? 0,
    };
  } catch (err) {
    const ax = err as AxiosError;
    if (attempt >= RETRY_LIMIT) {
      throw new Error(
        `giving up on ${catMain}/${catType} page ${page} after ${RETRY_LIMIT} attempts (status=${ax.response?.status ?? '-'})`,
      );
    }
    const wait = RETRY_BASE_MS * (attempt + 1);
    process.stderr.write(
      `  retry ${catMain}/${catType} page ${page} (attempt ${attempt + 1}/${RETRY_LIMIT}, status=${ax.response?.status ?? '-'}) after ${wait}ms\n`,
    );
    await new Promise((r) => setTimeout(r, wait));
    return fetchPage(catMain, catType, page, attempt + 1);
  }
}

async function flushPage(
  model: mongoose.Model<ListingDocument>,
  listings: ListingData[],
  runId: string,
): Promise<{ upserted: number; modified: number }> {
  if (!listings.length) return { upserted: 0, modified: 0 };
  const now = new Date();
  const ops = listings.map((l) => {
    const { _id, ...rest } = l;
    return {
      updateOne: {
        filter: { _id },
        update: {
          $setOnInsert: { _id, first_seen: now, run_id: runId },
          $set: { ...rest, last_seen: now },
        },
        upsert: true,
      },
    };
  });
  const result = await model.bulkWrite(ops, { ordered: false });
  return {
    upserted: result.upsertedCount ?? 0,
    modified: result.modifiedCount ?? 0,
  };
}

async function backfillCategory(
  model: mongoose.Model<ListingDocument>,
  cat: (typeof SREALITY_CATEGORIES)[number],
  runId: string,
): Promise<{ scanned: number; upserted: number; modified: number; skipped: number }> {
  let scanned = 0;
  let upserted = 0;
  let modified = 0;
  let skipped = 0;
  let page = 1;
  let totalReported = 0;

  process.stdout.write(
    `\n[${cat.priceType}/${cat.propertyType}] starting backfill\n`,
  );

  while (true) {
    const { estates, resultSize } = await fetchPage(cat.main, cat.type, page);
    if (page === 1) totalReported = resultSize;
    if (estates.length === 0) break;

    const parsed: ListingData[] = [];
    const seen = new Set<string>();
    for (const est of estates) {
      try {
        const listing = parseEstate(est, cat.priceType, cat.propertyType);
        if (!listing) {
          skipped++;
          continue;
        }
        if (seen.has(listing._id)) continue;
        seen.add(listing._id);
        parsed.push(listing);
      } catch (err) {
        skipped++;
        process.stderr.write(
          `  skip estate ${est.hash_id}: ${(err as Error).message}\n`,
        );
      }
    }

    const { upserted: u, modified: m } = await flushPage(model, parsed, runId);
    upserted += u;
    modified += m;
    scanned += estates.length;

    process.stdout.write(
      `  page ${page}: fetched ${estates.length}, parsed ${parsed.length}, +${u} new, ~${m} updated (cumulative scanned ${scanned}/${totalReported})\n`,
    );

    if (estates.length < PER_PAGE) break;
    page++;
    await new Promise((r) => setTimeout(r, PER_REQUEST_DELAY_MS));
  }

  process.stdout.write(
    `[${cat.priceType}/${cat.propertyType}] done — scanned=${scanned} reported=${totalReported} upserted=${upserted} modified=${modified} skipped=${skipped}\n`,
  );
  return { scanned, upserted, modified, skipped };
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  const runId = `backfill-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  process.stdout.write(`run_id=${runId}\n`);

  await mongoose.connect(uri);
  const model = mongoose.model<ListingDocument>(Listing.name, ListingSchema);

  const before = await model.estimatedDocumentCount();
  process.stdout.write(`collection size before: ${before}\n`);

  const totals = { scanned: 0, upserted: 0, modified: 0, skipped: 0 };
  for (const cat of SREALITY_CATEGORIES) {
    const r = await backfillCategory(model, cat, runId);
    totals.scanned += r.scanned;
    totals.upserted += r.upserted;
    totals.modified += r.modified;
    totals.skipped += r.skipped;
  }

  const after = await model.estimatedDocumentCount();
  process.stdout.write(
    `\nSUMMARY: scanned=${totals.scanned} upserted=${totals.upserted} modified=${totals.modified} skipped=${totals.skipped}\n`,
  );
  process.stdout.write(`collection size after: ${after} (delta ${after - before})\n`);

  await mongoose.disconnect();
}

void main().catch((err) => {
  process.stderr.write(`backfill failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
