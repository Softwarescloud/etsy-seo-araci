import type { EtsyListing } from '../etsy/client.ts';
import { normalize } from './text.ts';

/** Etsy'nin uyguladığı resmî sınırlar. */
export const LIMITS = {
  titleMax: 140,
  titleIdeal: [40, 70] as const,
  tagsMax: 13,
  tagLengthMax: 20,
  descriptionMax: 5000,
  descriptionIdeal: [200, 1000] as const,
} as const;

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  message: string;
  hint?: string;
}

export interface ListingAudit {
  listingId: number;
  title: string;
  url: string | null;
  image: string | null;
  price: string | null;
  favorites: number;
  tags: string[];
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  findings: Finding[];
  missingKeywords: string[];
}

const SEVERITY_PENALTY: Record<Severity, number> = { error: 12, warning: 6, info: 2 };

function inRange(value: number, [min, max]: readonly [number, number]): boolean {
  return value >= min && value <= max;
}

export function auditListing(listing: EtsyListing, targetKeywords: string[] = []): ListingAudit {
  const findings: Finding[] = [];
  const title = listing.title ?? '';
  const description = listing.description ?? '';
  const tags = (listing.tags ?? []).map((tag) => tag.trim()).filter(Boolean);

  // --- Başlık ---
  const titleLength = title.length;
  if (titleLength === 0) {
    findings.push({ severity: 'error', message: 'Başlık boş.', hint: 'Etsy başlıksız ilan göstermez.' });
  } else if (titleLength > LIMITS.titleMax) {
    findings.push({
      severity: 'error',
      message: `Başlık ${titleLength} karakter — en fazla ${LIMITS.titleMax}.`,
      hint: 'Fazlalıklar kesilir; önemli kelimeler başta kalmalı.',
    });
  } else if (!inRange(titleLength, LIMITS.titleIdeal)) {
    findings.push({
      severity: 'warning',
      message: `Başlık ${titleLength} karakter — ideal aralık ${LIMITS.titleIdeal[0]}-${LIMITS.titleIdeal[1]}.`,
      hint: 'Çok kısa başlık arama motorunda alan kaybettirir.',
    });
  }

  // --- Tag sayısı ---
  if (tags.length === 0) {
    findings.push({ severity: 'error', message: 'Hiç tag yok.', hint: '13 tag hakkının tamamını kullan.' });
  } else if (tags.length > LIMITS.tagsMax) {
    findings.push({ severity: 'error', message: `${tags.length} tag var — en fazla ${LIMITS.tagsMax}.` });
  } else if (tags.length < LIMITS.tagsMax) {
    findings.push({
      severity: 'warning',
      message: `Yalnızca ${tags.length}/${LIMITS.tagsMax} tag kullanılmış.`,
      hint: `${LIMITS.tagsMax - tags.length} tag hakkın boşta duruyor.`,
    });
  }

  // --- Tag uzunluğu ---
  const longTags = tags.filter((tag) => tag.length > LIMITS.tagLengthMax);
  if (longTags.length > 0) {
    findings.push({
      severity: 'error',
      message: `${longTags.length} tag ${LIMITS.tagLengthMax} karakteri aşıyor: ${longTags.slice(0, 3).join(', ')}`,
      hint: 'Etsy uzun tag\'leri kısaltır veya yok sayar.',
    });
  }

  // --- Yinelenen tag ---
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tag of tags) {
    const key = normalize(tag);
    if (seen.has(key)) duplicates.add(tag);
    seen.add(key);
  }
  if (duplicates.size > 0) {
    findings.push({
      severity: 'warning',
      message: `Yinelenen tag: ${[...duplicates].join(', ')}`,
      hint: 'Aynı kelimeyi iki kez kullanmak ek görünürlük sağlamaz.',
    });
  }

  // --- Tekrarlanan kelimeler (title + tags) ---
  const titleWords = normalize(title).split(' ').filter(Boolean);
  const tagWords = normalize(tags.join(' ')).split(' ').filter(Boolean);
  const repeated = [...new Set(tagWords.filter((word) => word.length > 3 && titleWords.includes(word)))];
  if (repeated.length > 2) {
    findings.push({
      severity: 'info',
      message: `Başlıkta da geçen ${repeated.length} kelime: ${repeated.slice(0, 5).join(', ')}`,
      hint: 'Normalde sorun değil; ama tag çeşitliliğini düşürüyorsa sadeleştir.',
    });
  }

  // --- Açıklama ---
  if (description.trim().length === 0) {
    findings.push({ severity: 'warning', message: 'Açıklama boş.', hint: 'İlk 200 karakter aramada görünür.' });
  } else if (description.length > LIMITS.descriptionMax) {
    findings.push({ severity: 'error', message: `Açıklama ${LIMITS.descriptionMax} karakteri aşıyor.` });
  } else if (!inRange(description.length, LIMITS.descriptionIdeal)) {
    findings.push({
      severity: 'info',
      message: `Açıklama ${description.length} karakter — ideal ${LIMITS.descriptionIdeal[0]}-${LIMITS.descriptionIdeal[1]}.`,
    });
  }

  // --- Anahtar kelime kapsaması ---
  const haystack = normalize(`${title} ${tags.join(' ')}`);
  const missingKeywords = targetKeywords.filter((keyword) => !haystack.includes(normalize(keyword)));
  if (targetKeywords.length > 0 && missingKeywords.length > 0) {
    findings.push({
      severity: 'info',
      message: `${missingKeywords.length} hedef kelime kullanılmıyor.`,
      hint: missingKeywords.slice(0, 6).join(', '),
    });
  }

  const penalty = findings.reduce((total, f) => total + SEVERITY_PENALTY[f.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    listingId: listing.listing_id,
    title,
    url: listing.url ?? null,
    image: listing.images?.[0]?.url ?? null,
    price: listing.price ? (listing.price.amount / listing.price.divisor).toFixed(2) : null,
    favorites: listing.num_favorers ?? 0,
    tags,
    score,
    grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D',
    findings,
    missingKeywords,
  };
}

export interface ShopAuditSummary {
  shopId: string;
  listingsAnalyzed: number;
  listingsTotal: number;
  averageScore: number;
  gradeCounts: Record<'A' | 'B' | 'C' | 'D', number>;
  tagSlotsUsed: number;
  tagSlotsTotal: number;
}

export interface ShopAuditResult extends ShopAuditSummary {
  audits: ListingAudit[];
}

export function summarize(audits: ListingAudit[], shopId: string, listingsTotal: number): ShopAuditSummary {
  const gradeCounts: Record<'A' | 'B' | 'C' | 'D', number> = { A: 0, B: 0, C: 0, D: 0 };
  let tagSlotsUsed = 0;

  for (const audit of audits) {
    gradeCounts[audit.grade]++;
    tagSlotsUsed += audit.tags.length;
  }

  const averageScore = audits.length
    ? Math.round((audits.reduce((total, a) => total + a.score, 0) / audits.length) * 10) / 10
    : 0;

  return {
    shopId,
    listingsAnalyzed: audits.length,
    listingsTotal,
    averageScore,
    gradeCounts,
    tagSlotsUsed,
    tagSlotsTotal: audits.length * LIMITS.tagsMax,
  };
}
