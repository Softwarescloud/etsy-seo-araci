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
    sharedSecret: str('ETSY_SHARED_SECRET'),
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
  automation: {
    enabled: str('AUTOMATION_ENABLED', '1') !== '0',
    // 0-23 arası, sunucunun kendi saat diliminde
    hour: Math.min(23, Math.max(0, int('AUTOMATION_HOUR', 4))),
    // Günde kaç kayıtlı kelimenin rekabeti tazelensin (Etsy kotasını korur)
    maxKeywordRefresh: int('MAX_KEYWORD_REFRESH', 15),
  },
} as const;

/**
 * Etsy `x-api-key` başlığı iki parçadan oluşur: `keystring:shared_secret`
 * (https://www.etsy.com/developers/your-apps). İkisi ayrı ayrı tanımlanmışsa
 * burada birleştirilir; kullanıcı zaten "a:b" biçiminde yazdıysa olduğu gibi kalır.
 */
export function buildApiKeyHeader(keystring: string, sharedSecret: string): string {
  if (keystring.includes(':')) return keystring;
  return sharedSecret ? `${keystring}:${sharedSecret}` : keystring;
}

export function etsyApiKeyHeader(): string {
  return buildApiKeyHeader(config.etsy.apiKey, config.etsy.sharedSecret);
}

/**
 * Eksik anahtar sunucuyu düşürmez: arayüz açılır, kullanıcı hatayı görür,
 * anahtarı .env'e yazıp yeniden başlatır.
 */
export function warnIfIncompleteConfig(): string[] {
  const warnings: string[] = [];
  const { apiKey, sharedSecret } = config.etsy;

  if (!apiKey) {
    warnings.push(
      'ETSY_API_KEY tanımlı değil — anahtar kelime araması ve mağaza denetimi çalışmayacak. ' +
        'https://www.etsy.com/developers/your-apps adresinden "Keystring" ve "Shared secret" değerlerini al.',
    );
  } else if (!sharedSecret && !apiKey.includes(':')) {
    warnings.push(
      'ETSY_SHARED_SECRET eksik. Etsy x-api-key başlığında "keystring:shared_secret" biçimini bekler; ' +
        'sadece keystring ile gelen istekler "Shared secret is required in x-api-key header" hatasıyla reddedilir.',
    );
  }

  if (!config.etsy.shopId) {
    warnings.push(
      'ETSY_SHOP_ID tanımlı değil — Mağaza Denetimi ve otomasyondaki mağaza görevi çalışmayacak. ' +
        'Değer, mağaza adının ".etsy.com" eki olmadan yazılmış hâlidir.',
    );
  }

  return warnings;
}
