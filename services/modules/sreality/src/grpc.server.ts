import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { Logger } from '@nestjs/common';
import path from 'path';
import { MANIFEST } from './manifest.js';
import { config } from './config.js';

const logger = new Logger('GrpcServer');
const PROTO_PATH = path.resolve('/proto/bot_module.proto');
const SOURCE = 'sreality';

const TRANSACTION: Record<string, string> = {
  prodej: 'sale',
  pronajem: 'rent',
};

const PROPERTY_TYPE: Record<string, string> = {
  byty: 'apartment',
  byt: 'apartment',
  domy: 'house',
  dum: 'house',
  pozemky: 'land',
  pozemek: 'land',
  komercni: 'commercial',
};

const CAT_MAIN: Record<string, string> = {
  '1': 'apartment',
  '2': 'house',
  '3': 'land',
  '4': 'commercial',
};

const CAT_TYPE: Record<string, string> = {
  '1': 'sale',
  '2': 'rent',
};

const CONFIG_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Bot name' },
    cities: { type: 'array', items: { type: 'string' }, title: 'Cities' },
    property_types: {
      type: 'array',
      items: { type: 'string', enum: ['apartment', 'house', 'land', 'commercial'] },
      title: 'Property types',
    },
    price_types: {
      type: 'array',
      items: { type: 'string', enum: ['sale', 'rent'] },
      title: 'Transaction type',
    },
    min_price: { type: 'integer', title: 'Min price (CZK)', minimum: 0 },
    max_price: { type: 'integer', title: 'Max price (CZK)', minimum: 0 },
    dispositions: {
      type: 'array',
      items: { type: 'string' },
      title: 'Dispositions (e.g. 2+kk)',
    },
  },
  required: ['name'],
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getManifest(
  _call: grpc.ServerUnaryCall<unknown, unknown>,
  callback: grpc.sendUnaryData<unknown>,
) {
  callback(null, {
    id: MANIFEST.module_id,
    display_name: MANIFEST.display_name,
    description: MANIFEST.description,
    icon_url: MANIFEST.icon_url,
    url_patterns: MANIFEST.url_patterns,
  });
}

function parseUrl(
  call: grpc.ServerUnaryCall<{ url: string }, unknown>,
  callback: grpc.sendUnaryData<unknown>,
) {
  const raw = call.request.url ?? '';
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid URL' });
    return;
  }

  const qs = parsed.searchParams;
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');

  const warnings: string[] = [];
  let cities: string[] = [];
  let propertyTypes: string[] = [];
  let priceTypes: string[] = [];
  let minPrice: number | undefined;
  let maxPrice: number | undefined;

  let dispositions: string[] = [];

  if (segments[0] === 'hledani') {
    const tx = TRANSACTION[segments[1]];
    const pt = PROPERTY_TYPE[segments[2]];
    if (tx) priceTypes = [tx];
    else warnings.push(`Unknown transaction "${segments[1]}"`);
    if (pt) propertyTypes = [pt];
    else warnings.push(`Unknown property type "${segments[2]}"`);
    if (segments[3]) cities = [capitalize(segments[3].replace(/-/g, ' '))];
  } else if (segments[0] === 'api') {
    const cm = CAT_MAIN[qs.get('category_main_cb') ?? ''];
    const ct = CAT_TYPE[qs.get('category_type_cb') ?? ''];
    if (cm) propertyTypes = [cm];
    if (ct) priceTypes = [ct];
    warnings.push('City cannot be extracted from API URL — fill it in manually');
  }

  // ?region=Brno overrides city from path segment
  const regionName = qs.get('region');
  if (regionName) {
    cities = [capitalize(regionName)];
  }

  // ?velikost=1+1,1+kk → dispositions
  const velikost = qs.get('velikost');
  if (velikost) {
    dispositions = decodeURIComponent(velikost)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  // Price: prefer explicit ?cena-od / ?cena-do, fall back to czk_price_summary_order2
  const cenaOd = qs.get('cena-od');
  const cenaDo = qs.get('cena-do');
  if (cenaOd) {
    const v = parseInt(cenaOd, 10);
    if (v > 0) minPrice = v;
  }
  if (cenaDo) {
    const v = parseInt(cenaDo, 10);
    if (v > 0) maxPrice = v;
  }
  if (minPrice === undefined && maxPrice === undefined) {
    const priceParam = qs.get('czk_price_summary_order2');
    if (priceParam) {
      const [lo, hi] = decodeURIComponent(priceParam).split('|');
      const loN = parseInt(lo, 10);
      const hiN = parseInt(hi, 10);
      if (loN > 0) minPrice = loN;
      if (hiN > 0) maxPrice = hiN;
    }
  }

  const parts = [cities.join(', '), propertyTypes.join('/'), priceTypes.join('/')].filter(Boolean);
  callback(null, {
    name: parts.join(' — ') || 'Sreality bot',
    cities,
    property_types: propertyTypes,
    price_types: priceTypes,
    min_price: minPrice,
    max_price: maxPrice,
    dispositions,
    warnings,
  });
}

function getConfigSchema(
  _call: grpc.ServerUnaryCall<unknown, unknown>,
  callback: grpc.sendUnaryData<unknown>,
) {
  callback(null, { json_schema: CONFIG_SCHEMA });
}

function createGetOverview(dbGetter: () => any) {
  return async function getOverview(
    _call: grpc.ServerUnaryCall<{ user_id: string }, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ) {
    try {
      const col = dbGetter().collection('reality');
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [total, new24h, topCities, topTypes] = await Promise.all([
        col.countDocuments({ source: SOURCE }),
        col.countDocuments({ source: SOURCE, first_seen: { $gte: cutoff } }),
        col
          .aggregate([
            { $match: { source: SOURCE } },
            { $group: { _id: '$city', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ])
          .toArray(),
        col
          .aggregate([
            { $match: { source: SOURCE } },
            { $group: { _id: '$property_type', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ])
          .toArray(),
      ]);

      callback(null, {
        total_listings: total,
        new_last_24h: new24h,
        top_cities: topCities.map((c: any) => ({ label: c._id || 'Unknown', count: c.count })),
        top_types: topTypes.map((t: any) => ({ label: t._id || 'Unknown', count: t.count })),
        extra_html: '',
      });
    } catch (err) {
      logger.error('GetOverview failed', err);
      callback(null, {
        total_listings: 0,
        new_last_24h: 0,
        top_cities: [],
        top_types: [],
        extra_html: '',
      });
    }
  };
}

export function startGrpcServer(dbGetter: () => any): void {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: Number,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDef) as any;

  const server = new grpc.Server();
  server.addService(proto.botmodule.BotModule.service, {
    GetManifest: getManifest,
    ParseUrl: parseUrl,
    GetConfigSchema: getConfigSchema,
    GetOverview: createGetOverview(dbGetter),
  });

  server.bindAsync(
    `0.0.0.0:${config.grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err) => {
      if (err) {
        logger.error('Failed to start gRPC server', err);
        process.exit(1);
      }
      logger.log(`gRPC server listening on :${config.grpcPort}`);
    },
  );
}
