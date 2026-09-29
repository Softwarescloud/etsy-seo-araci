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

server.listen(config.port, config.host, () => {
  console.log(`\n  Etsy SEO aracı  ->  http://${config.host}:${config.port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
