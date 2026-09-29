import { config } from '../config.ts';
import {
  countActiveListings,
  EtsyApiError,
  getShopActiveListings,
  searchActiveListings,
  type EtsyListing,
} from '../etsy/client.ts';
import { db, getCached, setCached, today, upsertKeyword } from '../db.ts';
import { auditListing, summarize, type ListingAudit, type ShopAuditResult } from './audit.ts';
import { extractTagPhrases, extractTitlePhrases, includesPhrase, normalize } from './text.ts';

const PAGE_SIZE = 48;

export interface KeywordMetrics {
  keyword: string;
  wordCount: number;
  samples: number;
  titleHits: number;
  tagHits: number;
  top3Hits: number;
  top10Hits: number;
  avgPosition: number | null;
  useRate: number;
  demandScore: number;
  competition: number | null;
  opportunityScore: number | null;
  topShops: string[];
  trend: 'up' | 'down' | 'flat' | null;
  probed: boolean;
}

export interface ResearchResult {
  seed: string;
  seedMetrics: {
    resultsTotal: number;
    listingsAnalyzed: number;
    fetchedFrom: 'etsy' | 'cache';
  };
  keywords: KeywordMetrics[];
  errors: string[];
  generatedAt: string;
}

interface Sample {
  listing: EtsyListing;
  position: number;
  shopName: string;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export async function collectListings(seed: string): Promise<{
  samples: Sample[];
  resultsTotal: number;
  fromCache: boolean;
}> {
  const cacheKey = `listings:${seed}:${config.limits.pagesPerSearch}`;
  const cached = getCached<{ samples: Sample[]; resultsTotal: number; fetchedAt: string }>(
    cacheKey,
    config.cache.listingTtlMs,
  );
  if (cached) return { samples: cached.samples, resultsTotal: cached.resultsTotal, fromCache: true };

  const samples: Sample[] = [];
  const seen = new Set<number>();
  let resultsTotal = 0;

  for (let page = 0; page < config.limits.pagesPerSearch; page++) {
    const result = await searchActiveListings(seed, PAGE_SIZE, page * PAGE_SIZE);
    resultsTotal = result.count ?? resultsTotal;

    for (const listing of result.results ?? []) {
      if (seen.has(listing.listing_id)) continue;
      seen.add(listing.listing_id);
      samples.push({
        listing,
        position: samples.length + 1,
        shopName: listing.shop?.shop_name ?? '',
      });
    }

    if (!result.results?.length) break;
    if (result.count !== undefined && samples.length >= result.count) break;
  }

  const payload = { samples, resultsTotal, fetchedAt: new Date().toISOString() };
  setCached(cacheKey, payload, config.cache.listingTtlMs);
  recordSearch(seed, resultsTotal, samples.length);
  return { samples, resultsTotal, fromCache: false };
}

function recordSearch(keyword: string, resultsTotal: number, listingCount: number): void {
  db.prepare(
    `INSERT INTO searches (keyword, results_total, listing_count, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(keyword, resultsTotal, listingCount, new Date().toISOString());
  upsertKeyword(keyword);

  db.prepare(
    `INSERT INTO keyword_daily (keyword, day, samples, results_total, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(keyword, day) DO UPDATE SET
       results_total = excluded.results_total,
       updated_at = excluded.updated_at`,
  ).run(keyword, today(), listingCount, resultsTotal, new Date().toISOString());
}

interface Accumulator {
  keyword: string;
  wordCount: number;
  titleHits: number;
  tagHits: number;
  top3Hits: number;
  top10Hits: number;
  positionSum: number;
  positionCount: number;
  shops: Map<string, number>;
}

function mine(samples: Sample[], seed: string): Map<string, Accumulator> {
  const map = new Map<string, Accumulator>();

  const bump = (phrase: string, wordCount: number, sample: Sample, field: 'title' | 'tag') => {
    if (phrase === seed) return;
    let entry = map.get(phrase);
    if (!entry) {
      entry = {
        keyword: phrase,
        wordCount,
        titleHits: 0,
        tagHits: 0,
        top3Hits: 0,
        top10Hits: 0,
        positionSum: 0,
        positionCount: 0,
        shops: new Map(),
      };
      map.set(phrase, entry);
    }
    if (field === 'title') {
      entry.titleHits++;
      entry.positionSum += sample.position;
      entry.positionCount++;
      if (sample.position <= 3) entry.top3Hits++;
      if (sample.position <= 10) entry.top10Hits++;
    } else {
      entry.tagHits++;
    }
    if (sample.shopName) entry.shops.set(sample.shopName, (entry.shops.get(sample.shopName) ?? 0) + 1);
  };

  for (const sample of samples) {
    const counted = new Set<string>();
    for (const { phrase, words } of extractTitlePhrases(sample.listing.title ?? '')) {
      if (counted.has(phrase)) continue;
      counted.add(phrase);
      bump(phrase, words, sample, 'title');
    }
    for (const { phrase, words } of extractTagPhrases(sample.listing.tags ?? [])) {
      bump(phrase, words, sample, 'tag');
    }
  }

  return map;
}

function rawDemand(entry: Accumulator): number {
  return (
    entry.titleHits * 1 +
    entry.tagHits * 1.5 +
    entry.top3Hits * 4 +
    entry.top10Hits * 1.5
  );
}

export function demandScore(raw: number, samples: number): number {
  if (samples === 0) return 0;
  const perListing = raw / samples;
  return round(clamp01(perListing / 6) * 100, 1);
}

export function opportunityScore(demand: number, resultsTotal: number | null): number | null {
  if (resultsTotal === null || resultsTotal <= 0) return null;
  const competitionIndex = clamp01(Math.log10(resultsTotal + 10) / 6);
  return round(clamp01(demand / 100) * (1 - competitionIndex) * 100, 1);
}

function trendFor(keyword: string, useRate: number): 'up' | 'down' | 'flat' | null {
  const rows = db
    .prepare(
      `SELECT use_rate FROM (
         SELECT (title_hits + tag_hits) * 1.0 / NULLIF(samples, 0) AS use_rate
         FROM keyword_daily
         WHERE keyword = ? AND day < ?
         ORDER BY day DESC
         LIMIT 7
       )`,
    )
    .all(keyword, today()) as { use_rate: number | null }[];
  const values = rows.map((r) => r.use_rate).filter((v): v is number => typeof v === 'number' && v > 0);
  if (values.length < 2) return null;

  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const delta = useRate - average;
  if (delta > 0.08) return 'up';
  if (delta < -0.08) return 'down';
  return 'flat';
}

function persistDaily(keyword: string, entry: Accumulator, samples: number): void {
  upsertKeyword(keyword);
  db.prepare(
    `INSERT INTO keyword_daily
       (keyword, day, samples, title_hits, tag_hits, top3_hits, top10_hits, position_sum, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(keyword, day) DO UPDATE SET
       samples = MAX(samples, excluded.samples),
       title_hits = MAX(title_hits, excluded.title_hits),
       tag_hits = MAX(tag_hits, excluded.tag_hits),
       top3_hits = MAX(top3_hits, excluded.top3_hits),
       top10_hits = MAX(top10_hits, excluded.top10_hits),
       position_sum = MAX(position_sum, excluded.position_sum),
       updated_at = excluded.updated_at`,
  ).run(
    keyword,
    today(),
    samples,
    entry.titleHits,
    entry.tagHits,
    entry.top3Hits,
    entry.top10Hits,
    entry.positionSum,
    new Date().toISOString(),
  );
}

async function probeCompetition(keywords: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const queue = [...keywords].slice(0, config.limits.maxProbeCalls);

  await Promise.all(
    queue.map(async (keyword) => {
      const cacheKey = `count:${keyword}`;
      const cached = getCached<{ count: number }>(cacheKey, config.cache.resultCountTtlMs);
      if (cached) {
        out.set(keyword, cached.count);
        return;
      }
      try {
        const { count } = await countActiveListings(keyword);
        setCached(cacheKey, { count }, config.cache.resultCountTtlMs);
        out.set(keyword, count);
      } catch (error) {
        if (error instanceof EtsyApiError) return;
        throw error;
      }
    }),
  );

  return out;
}

export interface ResearchOptions {
  probe?: boolean;
  limit?: number;
}

export async function research(rawSeed: string, options: ResearchOptions = {}): Promise<ResearchResult> {
  const seed = normalize(rawSeed);
  const errors: string[] = [];

  if (!seed) throw new HttpError(400, 'Arama terimi boş olamaz.');

  let collected: { samples: Sample[]; resultsTotal: number; fromCache: boolean };
  try {
    collected = await collectListings(seed);
  } catch (error) {
    if (error instanceof EtsyApiError) {
      throw new HttpError(
        error.status,
        error.status === 401 || error.status === 403
          ? 'Etsy API erişimi reddetti. /listings/active endpoint\'i için geliştirici hesabında "Commercial/Production" erişiminin açık olması gerekir.'
          : `Etsy API hatası (${error.status}).`,
      );
    }
    throw error;
  }

  const samples = collected.samples;
  const mined = mine(samples, seed);

  const ranked = [...mined.values()]
    .map((entry) => ({ entry, raw: rawDemand(entry) }))
    .sort((a, b) => b.raw - a.raw || a.entry.keyword.localeCompare(b.entry.keyword));

  const limit = options.limit ?? 40;
  const selected = ranked.slice(0, limit);
  const demandByKeyword = new Map(selected.map((r) => [r.entry.keyword, demandScore(r.raw, samples.length)]));

  let competition = new Map<string, number>();
  if (options.probe !== false && selected.length > 0) {
    const topLevel = selected
      .filter((r) => r.entry.wordCount === 2 || r.entry.titleHits >= 2)
      .slice(0, config.limits.maxProbeCalls)
      .map((r) => r.entry.keyword);
    const probes = await probeCompetition(topLevel.length ? topLevel : selected.slice(0, 3).map((r) => r.entry.keyword));
    competition = probes;
  }

  const keywords: KeywordMetrics[] = selected.map(({ entry, raw }) => {
    const demand = demandScore(raw, samples.length);
    const resultsTotal = competition.get(entry.keyword) ?? null;
    const useRate = samples.length ? (entry.titleHits + entry.tagHits) / (samples.length * 2) : 0;

    persistDaily(entry.keyword, entry, samples.length);

    return {
      keyword: entry.keyword,
      wordCount: entry.wordCount,
      samples: samples.length,
      titleHits: entry.titleHits,
      tagHits: entry.tagHits,
      top3Hits: entry.top3Hits,
      top10Hits: entry.top10Hits,
      avgPosition: entry.positionCount ? round(entry.positionSum / entry.positionCount, 1) : null,
      useRate: round(useRate, 3),
      demandScore: demand,
      competition: resultsTotal,
      opportunityScore: opportunityScore(demand, resultsTotal),
      topShops: [...entry.shops.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name),
      trend: trendFor(entry.keyword, useRate),
      probed: resultsTotal !== null,
    } satisfies KeywordMetrics;
  });

  keywords.sort((a, b) => {
    const scoreA = a.opportunityScore ?? a.demandScore;
    const scoreB = b.opportunityScore ?? b.demandScore;
    return scoreB - scoreA;
  });

  return {
    seed,
    seedMetrics: {
      resultsTotal: collected.resultsTotal,
      listingsAnalyzed: samples.length,
      fetchedFrom: collected.fromCache ? 'cache' : 'etsy',
    },
    keywords,
    errors,
    generatedAt: new Date().toISOString(),
  };
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface HistoryPoint {
  searchedAt: string;
  resultsTotal: number;
}

export function searchHistory(keyword: string, limit = 60): HistoryPoint[] {
  const normalizedKeyword = normalize(keyword);
  const rows = db
    .prepare(
      `SELECT results_total, created_at FROM searches
       WHERE keyword = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(normalizedKeyword, limit) as { results_total: number; created_at: string }[];
  return rows.map((r) => ({ searchedAt: r.created_at, resultsTotal: r.results_total })).reverse();
}

/** Yerel korpus tabanlı, ücretsiz öneri üretimi (Etsy'ye istek atmaz). */
export function localSuggestions(seed: string, limit = 15): string[] {
  const normalizedSeed = normalize(seed);
  if (!normalizedSeed) return [];

  const rows = db
    .prepare(
      `SELECT keyword FROM keywords
       WHERE keyword != ? AND (keyword LIKE ? OR keyword LIKE ?)
       ORDER BY last_seen_at DESC LIMIT ?`,
    )
    .all(normalizedSeed, `%${normalizedSeed}%`, `${normalizedSeed}%`, limit * 4) as { keyword: string }[];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const row of rows) {
    const keyword = row.keyword;
    if (seen.has(keyword)) continue;
    // Arama terimini içeren kelimeler + terimin içinde geçen daha kısa kelimeler
    if (!includesPhrase(keyword, normalizedSeed) && !includesPhrase(normalizedSeed, keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= limit) break;
  }

  return out;
}

export function listSaved(): { keyword: string; note: string; createdAt: string }[] {
  const rows = db.prepare('SELECT keyword, note, created_at FROM saved_keywords ORDER BY created_at DESC').all() as {
    keyword: string;
    note: string;
    created_at: string;
  }[];
  return rows.map((r) => ({ keyword: r.keyword, note: r.note, createdAt: r.created_at }));
}

export function saveKeyword(keyword: string, note = ''): void {
  const normalized = normalize(keyword);
  if (!normalized) throw new HttpError(400, 'Anahtar kelime boş olamaz.');
  db.prepare(
    `INSERT INTO saved_keywords (keyword, note, created_at) VALUES (?, ?, ?)
     ON CONFLICT(keyword) DO UPDATE SET note = excluded.note`,
  ).run(normalized, note, new Date().toISOString());
}

export function deleteSavedKeyword(keyword: string): void {
  db.prepare('DELETE FROM saved_keywords WHERE keyword = ?').run(normalize(keyword));
}

// ---------------------------------------------------------------------------
// Mağaza denetimi
// ---------------------------------------------------------------------------

export interface ShopAudit extends ShopAuditResult {}

export async function auditShop(rawShopId: string, targetKeywords: string[] = []): Promise<ShopAudit> {
  const shopId = rawShopId.trim();
  if (!shopId) throw new HttpError(400, 'Mağaza ID gerekli.');

  const keywords = [...new Set(targetKeywords.map(normalize).filter(Boolean))];
  const cacheKey = `shop:${shopId}:${keywords.join('|')}`;

  const cached = getCached<ShopAudit>(cacheKey, config.cache.listingTtlMs);
  if (cached) return cached;

  let listings: EtsyListing[];
  let total = 0;
  try {
    const result = await getShopActiveListings(shopId, PAGE_SIZE, 0);
    listings = result.results ?? [];
    total = result.count ?? listings.length;
  } catch (error) {
    if (error instanceof EtsyApiError) {
      throw new HttpError(
        error.status,
        error.status === 404
          ? `Mağaza bulunamadı (${shopId}). Etsy mağaza ID'si sonu ".etsy.com" olmadan, sadece "magazaadi" şeklinde yazılır.`
          : error.status === 401 || error.status === 403
            ? 'Etsy mağaza ilanlarına erişimi reddetti. API anahtarının mağaza ilanları izni olmayabilir.'
            : `Etsy API hatası (${error.status}).`,
      );
    }
    throw error;
  }

  const audits = listings.map((listing) => auditListing(listing, keywords));
  audits.sort((a, b) => a.score - b.score);

  const result: ShopAudit = {
    ...summarize(audits, shopId, total),
    audits,
  };

  setCached(cacheKey, result, config.cache.listingTtlMs);
  return result;
}
