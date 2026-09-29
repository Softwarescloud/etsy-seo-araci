import { config } from '../config.ts';

class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private readonly capacity: number;
  private readonly refillPerSecond: number;

  constructor(capacity: number, refillPerSecond: number) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(
        this.capacity,
        this.tokens + ((now - this.last) / 1000) * this.refillPerSecond,
      );
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000)));
    }
  }
}

const bucket = new TokenBucket(config.limits.requestsPerSecond, config.limits.requestsPerSecond);

export class EtsyApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    super(`Etsy API ${status} - ${path}: ${body.slice(0, 300)}`);
    this.name = 'EtsyApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${config.etsy.apiBase}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(path: string, query?: Query, attempt = 0): Promise<T> {
  await bucket.take();

  const headers: Record<string, string> = {
    'x-api-key': config.etsy.apiKey,
    accept: 'application/json',
  };
  if (config.etsy.accessToken) headers.authorization = `Bearer ${config.etsy.accessToken}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), { headers, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      return request<T>(path, query, attempt + 1);
    }
    throw new Error(`Etsy'ye ulaşılamadı: ${(error as Error).message}`);
  }

  if (response.status === 429 || response.status >= 500) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, retryAfter * 1000 || 1000 * 2 ** attempt));
      return request<T>(path, query, attempt + 1);
    }
  }

  const body = await response.text();
  if (!response.ok) throw new EtsyApiError(response.status, path, body);

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Etsy yanıtı JSON değil: ${body.slice(0, 200)}`);
  }
}

export interface EtsyListing {
  listing_id: number;
  title: string;
  description?: string;
  tags?: string[];
  price?: { amount: number; divisor: number };
  quantity?: number;
  num_favorers?: number;
  views?: number;
  creation_timestamp?: string;
  url?: string;
  shop?: { shop_id: number; shop_name: string };
  images?: { url: string }[];
}

export interface EtsySearchResult {
  count: number;
  results: EtsyListing[];
  params?: { limit?: number; offset?: number; keywords?: string };
}

export interface EtsyTaxonomyNode {
  taxonomy_id: number;
  name: string;
  parent_id?: number;
  children?: EtsyTaxonomyNode[];
}

export interface EtsyShopListings {
  count: number;
  results: EtsyListing[];
}

/** Toplu (aktif) ilan araması. Etsy'nin "kilitli" endpoint'i: geliştirici hesabı
 *  aktif erişime sahip olmalı, aksi halde 401/403 döner. */
export function searchActiveListings(
  keywords: string,
  limit: number,
  offset: number,
): Promise<EtsySearchResult> {
  return request<EtsySearchResult>('/listings/active', {
    keywords,
    limit,
    offset,
    sort_by: 'score',
  });
}

/** Tek kelimenin toplam sonuç sayısı — rekabet proxy'si. */
export function countActiveListings(keywords: string): Promise<{ count: number }> {
  return request<{ count: number }>('/listings/active', { keywords, limit: 1, offset: 0 });
}

/** Satıcı taksonomisi — ürün kategorileri ve anahtar kelime havuzu. */
export function getTaxonomy(): Promise<EtsyTaxonomyNode[]> {
  return request<EtsyTaxonomyNode[]>('/taxonomy/single/new');
}

/** Kendi mağazanın ilanları (shopId verilmişse). */
export function getShopListings(shopId: string, limit: number, offset: number): Promise<EtsyShopListings> {
  return request<EtsyShopListings>(`/shops/${shopId}/listings`, {
    limit,
    offset,
    includes: 'MainImage,Shipping,Shop',
  });
}
