import { config } from '../config.ts';
import { countActiveListings } from '../etsy/client.ts';
import { db, today, upsertKeyword } from '../db.ts';
import { auditShop, listSaved } from './keywords.ts';
import { normalize } from './text.ts';

export type TaskName = 'shop_audit' | 'keyword_refresh';
export type RunStatus = 'ok' | 'error' | 'skipped';

export interface RunRecord {
  id: number;
  task: TaskName;
  status: RunStatus;
  message: string;
  startedAt: string;
  finishedAt: string;
}

export interface RunOutcome {
  task: TaskName;
  status: RunStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface ListingTrend {
  listingId: number;
  title: string;
  currentScore: number;
  previousScore: number | null;
  change: number | null;
  currentTags: number;
  tagDelta: number | null;
  grades: { day: string; score: number; grade: string }[];
}

export interface KeywordTrend {
  keyword: string;
  current: number | null;
  previous: number | null;
  change: number | null;
  direction: 'up' | 'down' | 'flat' | null;
}

// ---------------------------------------------------------------------------
// Görevler
// ---------------------------------------------------------------------------

/** Mağazanın ilanlarını denetler ve günlük geçmişe yazar. */
export async function runShopAudit(): Promise<RunOutcome> {
  if (!config.etsy.shopId) {
    return { task: 'shop_audit', status: 'skipped', message: 'ETSY_SHOP_ID tanımlı değil.' };
  }

  const keywords = listSaved().map((k) => k.keyword);
  const result = await auditShop(config.etsy.shopId, keywords, { force: true });
  const day = today();
  const now = new Date().toISOString();

  const insert = db.prepare(
    `INSERT INTO shop_audit_daily (shop_id, listing_id, day, score, grade, tag_count, title)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(shop_id, listing_id, day) DO UPDATE SET
       score = excluded.score, grade = excluded.grade,
       tag_count = excluded.tag_count, title = excluded.title`,
  );

  for (const audit of result.audits) {
    insert.run(result.shopId, audit.listingId, day, audit.score, audit.grade, audit.tags.length, audit.title);
  }

  const worst = result.audits[0];
  return {
    task: 'shop_audit',
    status: 'ok',
    message: `${result.audits.length} ilan denetlendi · ortalama ${result.averageScore}${
      worst ? ` · en düşük: ${worst.grade} (${worst.score})` : ''
    }`,
    details: {
      shopId: result.shopId,
      listings: result.audits.length,
      averageScore: result.averageScore,
      gradeCounts: result.gradeCounts,
      recordedAt: now,
    },
  };
}

/** Kayıtlı kelimelerin rekabet sayısını tazeler — böylece trend oluşur. */
export async function runKeywordRefresh(): Promise<RunOutcome> {
  const keywords = listSaved().map((k) => k.keyword).slice(0, config.automation.maxKeywordRefresh);
  if (keywords.length === 0) {
    return { task: 'keyword_refresh', status: 'skipped', message: 'Kayıtlı kelime yok.' };
  }

  const now = new Date().toISOString();
  const day = today();
  const upsertCount = db.prepare(
    `INSERT INTO keyword_daily (keyword, day, samples, results_total, updated_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(keyword, day) DO UPDATE SET
       results_total = excluded.results_total, updated_at = excluded.updated_at`,
  );
  const insertSearch = db.prepare(
    `INSERT INTO searches (keyword, results_total, listing_count, created_at) VALUES (?, ?, 1, ?)`,
  );

  let ok = 0;
  const failures: string[] = [];

  for (const keyword of keywords) {
    try {
      const { count } = await countActiveListings(keyword);
      upsertCount.run(keyword, day, count, now);
      insertSearch.run(keyword, count, now);
      upsertKeyword(keyword);
      ok++;
    } catch (error) {
      failures.push(`${keyword}: ${(error as Error).message.slice(0, 80)}`);
    }
  }

  const status: RunStatus = ok === 0 ? 'error' : failures.length ? 'ok' : 'ok';
  return {
    task: 'keyword_refresh',
    status,
    message:
      ok === 0
        ? `Hiçbiri güncellenemedi. ${failures[0] ?? 'bilinmeyen hata'}`
        : `${ok}/${keywords.length} kelime tazelendi${failures.length ? ` · ${failures.length} hata` : ''}`,
    details: { refreshed: ok, attempted: keywords.length, failures },
  };
}

export const TASKS: Record<TaskName, () => Promise<RunOutcome>> = {
  shop_audit: runShopAudit,
  keyword_refresh: runKeywordRefresh,
};

export async function runTask(task: TaskName): Promise<RunOutcome> {
  const startedAt = new Date().toISOString();
  let outcome: RunOutcome;

  try {
    outcome = await TASKS[task]();
  } catch (error) {
    outcome = { task, status: 'error', message: (error as Error).message };
  }

  db.prepare(
    `INSERT INTO automation_runs (task, status, message, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(task, outcome.status, outcome.message.slice(0, 500), startedAt, new Date().toISOString());

  return outcome;
}

export function runHistory(task?: TaskName, limit = 20): RunRecord[] {
  const rows = (
    task
      ? db
          .prepare('SELECT * FROM automation_runs WHERE task = ? ORDER BY started_at DESC LIMIT ?')
          .all(task, limit)
      : db.prepare('SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT ?').all(limit)
  ) as {
    id: number;
    task: TaskName;
    status: RunStatus;
    message: string;
    started_at: string;
    finished_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    task: r.task,
    status: r.status,
    message: r.message,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  }));
}

// ---------------------------------------------------------------------------
// Zamanlama
// ---------------------------------------------------------------------------

/** Verilen andan sonraki çalışma anını bulur (bugün saat geçtiyse yarın). */
export function nextRunAt(now: Date, hour: number): Date {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function isDue(next: Date, now: Date): boolean {
  return now >= next;
}

/**
 * Uzun setTimeout yerine dakika dakika kontrol eder — bilgisayar uykuya
 * girdiğinde veya saat değiştiğinde programlanan zaman kaçmaz.
 */
export function startScheduler(onRun: (task: TaskName) => Promise<void>): {
  stop: () => void;
  next: () => Date;
} {
  const hour = config.automation.hour;
  let next = nextRunAt(new Date(), hour);
  let stopped = false;
  let ranToday = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const now = new Date();

    // Gece yarısını geçtiysek "bugün çalıştı" bayrağını sıfırla
    if (now.getHours() === 0) ranToday = false;

    if (!ranToday && isDue(next, now) && config.automation.enabled) {
      ranToday = true;
      next = nextRunAt(now, hour);
      for (const task of Object.keys(TASKS) as TaskName[]) {
        await onRun(task);
      }
    } else if (!isDue(next, now)) {
      next = nextRunAt(now, hour);
    }

    if (!stopped) setTimeout(() => void tick(), 60_000);
  };

  setTimeout(() => void tick(), 60_000);

  return { stop: () => { stopped = true; }, next: () => next };
}

// ---------------------------------------------------------------------------
// Raporlama
// ---------------------------------------------------------------------------

export function shopHistory(shopId: string, days = 14): Record<string, ListingTrend> {
  const rows = db
    .prepare(
      `SELECT listing_id, title, day, score, grade, tag_count FROM shop_audit_daily
       WHERE shop_id = ? ORDER BY day DESC, score ASC`,
    )
    .all(shopId) as { listing_id: number; title: string; day: string; score: number; grade: string; tag_count: number }[];

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const byListing = new Map<number, ListingTrend>();

  for (const row of rows) {
    if (row.day < cutoff) continue;
    let entry = byListing.get(row.listing_id);
    if (!entry) {
      entry = {
        listingId: row.listing_id,
        title: row.title,
        currentScore: row.score,
        previousScore: null,
        change: null,
        currentTags: row.tag_count,
        tagDelta: null,
        grades: [],
      };
      byListing.set(row.listing_id, entry);
    }
    entry.grades.push({ day: row.day, score: row.score, grade: row.grade });
  }

  // İlk gün = en eski, son gün = bugün
  for (const entry of byListing.values()) {
    entry.grades.sort((a, b) => a.day.localeCompare(b.day));
    const last = entry.grades.at(-1);
    const previous = entry.grades.at(-2);
    entry.currentScore = last?.score ?? entry.currentScore;
    entry.previousScore = previous?.score ?? null;
    entry.change = previous ? last!.score - previous.score : null;
  }

  return Object.fromEntries([...byListing.entries()].map(([id, value]) => [String(id), value]));
}

/** Günlük ortalama skor serisi — mağaza sağlığının yönü. */
export function shopScoreSeries(shopId: string, days = 30): { day: string; score: number; listings: number }[] {
  const rows = db
    .prepare(
      `SELECT day, ROUND(AVG(score), 1) AS score, COUNT(*) AS listings
       FROM shop_audit_daily WHERE shop_id = ?
       GROUP BY day ORDER BY day DESC LIMIT ?`,
    )
    .all(shopId, days) as { day: string; score: number; listings: number }[];
  return rows.reverse();
}

export function keywordTrends(limit = 30): KeywordTrend[] {
  const keywords = listSaved().map((k) => normalize(k.keyword));

  return keywords.map((keyword) => {
    const rows = db
      .prepare(
        `SELECT day, results_total FROM keyword_daily
         WHERE keyword = ? AND results_total IS NOT NULL
         ORDER BY day DESC LIMIT 2`,
      )
      .all(keyword) as { day: string; results_total: number }[];

    const current = rows[0]?.results_total ?? null;
    const previous = rows[1]?.results_total ?? null;

    if (current === null || previous === null || previous === 0) {
      return { keyword, current, previous, change: null, direction: null };
    }

    const ratio = (current - previous) / previous;
    const direction: KeywordTrend['direction'] =
      ratio > 0.02 ? 'up' : ratio < -0.02 ? 'down' : 'flat';

    return { keyword, current, previous, change: current - previous, direction };
  }).sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0)).slice(0, limit);
}
