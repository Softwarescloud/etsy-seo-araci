import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { config, warnIfIncompleteConfig } from './config.ts';
import { purgeExpiredCache } from './db.ts';
import {
  auditShop,
  deleteSavedKeyword,
  HttpError,
  listSaved,
  localSuggestions,
  research,
  saveKeyword,
  searchHistory,
} from './services/keywords.ts';
import {
  keywordTrends,
  runHistory,
  runTask,
  shopHistory,
  shopScoreSeries,
  startScheduler,
  TASKS,
  type TaskName,
} from './services/automation.ts';

const publicDir = resolve(process.cwd(), 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function serveStatic(res: import('node:http').ServerResponse, urlPath: string): void {
  const relative = normalize(urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''));
  const filePath = join(publicDir, relative);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(res, 404, { error: 'Bulunamadı' });
    return;
  }

  res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Geçersiz JSON gövdesi.');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  try {
    if (!pathname.startsWith('/api/')) {
      serveStatic(res, pathname);
      return;
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        apiKeyConfigured: Boolean(config.etsy.apiKey),
        shopConnected: Boolean(config.etsy.shopId),
        defaultShopId: config.etsy.shopId || '',
        rateLimitPerSecond: config.limits.requestsPerSecond,
        purgedCacheRows: purgeExpiredCache(),
      });
      return;
    }

    if (pathname === '/api/keyword' && req.method === 'GET') {
      const seed = url.searchParams.get('seed') ?? '';
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Math.min(200, Math.max(5, Number(limitParam) || 40)) : undefined;
      const probe = url.searchParams.get('probe');
      const result = await research(seed, { limit, probe: probe !== '0' });
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/history' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword') ?? '';
      sendJson(res, 200, { keyword, points: searchHistory(keyword) });
      return;
    }

    if (pathname === '/api/suggest' && req.method === 'GET') {
      sendJson(res, 200, { suggestions: localSuggestions(url.searchParams.get('seed') ?? '') });
      return;
    }

    if (pathname === '/api/saved' && req.method === 'GET') {
      sendJson(res, 200, { items: listSaved() });
      return;
    }

    if (pathname === '/api/saved' && req.method === 'POST') {
      const body = (await readBody(req)) as { keyword?: string; note?: string };
      saveKeyword(body.keyword ?? '', body.note ?? '');
      sendJson(res, 201, { ok: true, items: listSaved() });
      return;
    }

    if (pathname === '/api/saved' && req.method === 'DELETE') {
      deleteSavedKeyword(url.searchParams.get('keyword') ?? '');
      sendJson(res, 200, { ok: true, items: listSaved() });
      return;
    }

    if (pathname === '/api/shop/audit' && req.method === 'GET') {
      const shopId = url.searchParams.get('shopId') || config.etsy.shopId;
      const keywords = (url.searchParams.get('keywords') ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      const result = await auditShop(shopId, keywords);
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/automation/status' && req.method === 'GET') {
      sendJson(res, 200, {
        enabled: config.automation.enabled,
        hour: config.automation.hour,
        shopConfigured: Boolean(config.etsy.shopId),
        savedKeywords: listSaved().length,
        nextRunAt: scheduler.next().toISOString(),
        runs: runHistory(undefined, 10),
      });
      return;
    }

    if (pathname === '/api/automation/run' && req.method === 'POST') {
      const requested = url.searchParams.get('task');
      const tasks = (requested ? [requested] : Object.keys(TASKS)) as TaskName[];
      const invalid = tasks.find((t) => !(t in TASKS));
      if (invalid) throw new HttpError(400, `Bilinmeyen görev: ${invalid}`);

      const results = [];
      for (const task of tasks) results.push(await runTask(task));
      sendJson(res, 200, { results, runs: runHistory(undefined, 10) });
      return;
    }

    if (pathname === '/api/automation/history' && req.method === 'GET') {
      const task = url.searchParams.get('task') as TaskName | null;
      sendJson(res, 200, {
        runs: runHistory(task ?? undefined, 30),
        scoreSeries: config.etsy.shopId ? shopScoreSeries(config.etsy.shopId) : [],
        listings: config.etsy.shopId ? shopHistory(config.etsy.shopId) : {},
        keywordTrends: keywordTrends(),
      });
      return;
    }

    sendJson(res, 404, { error: 'Bilinmeyen endpoint' });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Beklenmeyen hata';
    console.error('[error]', error);
    sendJson(res, 500, { error: message });
  }
});

for (const warning of warnIfIncompleteConfig()) {
  console.warn(`  [uyari] ${warning}\n`);
}

const scheduler = startScheduler(async (task) => {
  const outcome = await runTask(task);
  const icon = outcome.status === 'ok' ? '✓' : outcome.status === 'skipped' ? '–' : '✗';
  console.log(`  [otomasyon] ${icon} ${task}: ${outcome.message}`);
});

server.listen(config.port, config.host, () => {
  console.log(`\n  Etsy SEO aracı  ->  http://${config.host}:${config.port}\n`);
  if (config.automation.enabled) {
    console.log(`  Otomasyon: her gün saat ${String(config.automation.hour).padStart(2, '0')}:00`);
    console.log(`  Sonraki çalışma: ${scheduler.next().toLocaleString('tr-TR')}\n`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
