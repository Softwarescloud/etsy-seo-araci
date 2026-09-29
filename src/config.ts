import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile() {
  const file = resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    // malformed .env is reported by the missing-key validation below
  }
}

loadEnvFile();

function str(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: int('PORT', 4310),
  host: str('HOST', '127.0.0.1'),
  dbPath: str('DB_PATH', resolve(process.cwd(), 'data', 'etsy-seo.db')),
  etsy: {
    apiKey: str('ETSY_API_KEY'),
    apiBase: str('ETSY_API_BASE', 'https://openapi.etsy.com/v3/application'),
    shopId: str('ETSY_SHOP_ID'),
    accessToken: str('ETSY_ACCESS_TOKEN'),
  },
  limits: {
    // Etsy allows a handful of requests per second per key; stay well under it.
    requestsPerSecond: int('REQUESTS_PER_SECOND', 4),
    // Sample size for keyword mining (multiples of the 48-per-page API page size).
    pagesPerSearch: int('PAGES_PER_SEARCH', 2),
    maxProbeCalls: int('MAX_PROBE_CALLS', 6),
    maxSeedVariants: int('MAX_SEED_VARIANTS', 4),
  },
  cache: {
    listingTtlMs: int('LISTING_CACHE_TTL_MINUTES', 180) * 60_000,
    resultCountTtlMs: int('RESULT_COUNT_TTL_MINUTES', 720) * 60_000,
  },
} as const;

export function assertConfig(): void {
  if (!config.etsy.apiKey) {
    throw new Error(
      'ETSY_API_KEY tanımlı değil. .env dosyasına Etsy API anahtarını ekle (https://www.etsy.com/developers/apps adresinden alınır).',
    );
  }
}
