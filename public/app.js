const $ = (selector) => document.querySelector(selector);

const state = {
  seed: '',
  keywords: [],
  saved: new Set(),
};

function toast(message, bad = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 2600);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `İstek başarısız (${response.status})`);
  return body;
}

const fmt = new Intl.NumberFormat('tr-TR');

function scoreClass(score) {
  if (score === null || score === undefined) return 'low';
  if (score >= 55) return 'high';
  if (score >= 30) return 'mid';
  return 'low';
}

const TREND_ICON = { up: '▲', down: '▼', flat: '▬' };

// ---------- health ----------

async function loadHealth() {
  const el = $('#status');
  try {
    const health = await api('/api/health');
    const fatal = (health.warnings ?? []).filter((w) => w.includes('ETSY_API_KEY') || w.includes('SHARED_SECRET'));

    if (!health.apiKeyConfigured) {
      el.textContent = 'ETSY_API_KEY eksik';
      el.className = 'status bad';
    } else if (!health.sharedSecretConfigured) {
      el.textContent = 'shared secret eksik';
      el.className = 'status bad';
    } else {
      el.textContent = `API hazir · ${health.rateLimitPerSecond} istek/sn${health.shopConnected ? ' · magaza bagli' : ''}`;
      el.className = 'status ok';
    }

    for (const warning of fatal) toast(warning, true);
  } catch {
    el.textContent = 'sunucuya ulasilamiyor';
    el.className = 'status bad';
  }
}

// ---------- suggestions ----------

let suggestTimer;
$('#seed').addEventListener('input', (event) => {
  clearTimeout(suggestTimer);
  const value = event.target.value.trim();
  if (value.length < 3) {
    $('#suggestions').innerHTML = '';
    return;
  }
  suggestTimer = setTimeout(async () => {
    try {
      const { suggestions } = await api(`/api/suggest?seed=${encodeURIComponent(value)}`);
      $('#suggestions').innerHTML = suggestions
        .slice(0, 10)
        .map((s) => `<button type="button" data-seed="${s}">${s}</button>`)
        .join('');
    } catch {
      /* öneri zorunlu değil */
    }
  }, 220);
});

$('#suggestions').addEventListener('click', (event) => {
  const seed = event.target.dataset?.seed;
  if (!seed) return;
  $('#seed').value = seed;
  $('#search-form').requestSubmit();
});

// ---------- search ----------

$('#search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const seed = $('#seed').value.trim();
  if (!seed) return;

  const button = $('#submit');
  button.disabled = true;
  button.textContent = 'Araştırılıyor…';
  $('#results').classList.add('hidden');
  $('#summary').classList.add('hidden');

  try {
    const probe = $('#probe').checked ? '1' : '0';
    const data = await api(`/api/keyword?seed=${encodeURIComponent(seed)}&probe=${probe}`);
    state.seed = data.seed;
    state.keywords = data.keywords;
    renderSummary(data);
    renderTable();
    $('#results').classList.remove('hidden');
    $('#suggestions').innerHTML = '';
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Araştır';
  }
});

function renderSummary(data) {
  const cards = [
    { label: 'Arama terimi', value: data.seed },
    { label: 'Toplam sonuç', value: fmt.format(data.seedMetrics.resultsTotal) },
    { label: 'İncelenen ilan', value: fmt.format(data.seedMetrics.listingsAnalyzed) },
    { label: 'Bulunan kelime', value: fmt.format(data.keywords.length) },
    { label: 'Kaynak', value: data.seedMetrics.fetchedFrom === 'cache' ? 'önbellek' : 'canlı' },
  ];
  $('#summary').innerHTML = cards
    .map((c) => `<div class="card"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`)
    .join('');
  $('#summary').classList.remove('hidden');
}

// ---------- table ----------

function sortedKeywords() {
  const mode = $('#sort').value;
  const list = [...state.keywords];
  const nullLast = (a, b) => (a === null ? 1 : b === null ? -1 : 0);

  switch (mode) {
    case 'demand':
      return list.sort((a, b) => b.demandScore - a.demandScore);
    case 'competition':
      return list.sort((a, b) => nullLast(a.competition, b.competition) || (a.competition ?? 0) - (b.competition ?? 0));
    case 'useRate':
      return list.sort((a, b) => b.useRate - a.useRate);
    default:
      return list.sort(
        (a, b) => nullLast(a.opportunityScore, b.opportunityScore) || (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0),
      );
  }
}

function renderTable() {
  const rows = sortedKeywords()
    .map((k) => {
      const demandBar = `<span class="bar ${k.demandScore >= 60 ? 'good' : ''}"><span style="width:${k.demandScore}%"></span></span>${k.demandScore.toFixed(0)}`;
      const competition = k.competition === null ? '<span class="score low">—</span>' : fmt.format(k.competition);
      const opportunity =
        k.opportunityScore === null
          ? '<span class="score low">—</span>'
          : `<span class="score ${scoreClass(k.opportunityScore)}">${k.opportunityScore.toFixed(0)}</span>`;
      const trend = k.trend
        ? `<span class="trend ${k.trend}">${TREND_ICON[k.trend]}</span>`
        : '<span class="trend flat">·</span>';
      const saved = state.saved.has(k.keyword);

      return `<tr>
        <td><span class="kw" data-kw="${k.keyword}">${k.keyword}</span></td>
        <td class="num">${demandBar}</td>
        <td class="num">${(k.useRate * 100).toFixed(0)}%</td>
        <td class="num">${k.top3Hits}</td>
        <td class="num">${competition}</td>
        <td class="num">${opportunity}</td>
        <td class="trend-col">${trend}</td>
        <td><button class="icon-btn ${saved ? 'active' : ''}" data-save="${k.keyword}" title="Kaydet">${saved ? '★' : '☆'}</button></td>
      </tr>`;
    })
    .join('');

  $('#keyword-table tbody').innerHTML = rows;
}

$('#sort').addEventListener('change', renderTable);

$('#keyword-table').addEventListener('click', (event) => {
  const saveKeyword = event.target.dataset?.save;
  if (saveKeyword) {
    toggleSave(saveKeyword);
    return;
  }
  const keyword = event.target.dataset?.kw;
  if (keyword) openDetail(keyword);
});

$('#export').addEventListener('click', () => {
  const header = ['keyword', 'demand', 'use_rate', 'top3_hits', 'competition', 'opportunity', 'trend', 'top_shops'];
  const lines = sortedKeywords().map((k) =>
    [
      k.keyword,
      k.demandScore,
      k.useRate,
      k.top3Hits,
      k.competition ?? '',
      k.opportunityScore ?? '',
      k.trend ?? '',
      `"${k.topShops.join('; ')}"`,
    ].join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.seed.replace(/\s+/g, '-')}-keywords.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- detail ----------

async function openDetail(keyword) {
  const k = state.keywords.find((item) => item.keyword === keyword);
  if (!k) return;

  let points = [];
  try {
    ({ points } = await api(`/api/history?keyword=${encodeURIComponent(keyword)}`));
  } catch {
    /* geçmiş yoksa sadece anlık veri göster */
  }

  $('#detail-body').innerHTML = `
    <h3>${k.keyword}</h3>
    <p class="note">${k.wordCount} kelime · ${k.samples} ilan örneğinden türetildi</p>
    <div class="kv">
      <div><div class="label">Talep skoru</div><div class="value">${k.demandScore.toFixed(1)}</div></div>
      <div><div class="label">Fırsat skoru</div><div class="value">${k.opportunityScore ?? '—'}</div></div>
      <div><div class="label">Başlıkta geçen ilan</div><div class="value">${k.titleHits}</div></div>
      <div><div class="label">Tag'de geçen ilan</div><div class="value">${k.tagHits}</div></div>
      <div><div class="label">İlk 3 sırada</div><div class="value">${k.top3Hits}</div></div>
      <div><div class="label">Ort. sıra</div><div class="value">${k.avgPosition ?? '—'}</div></div>
      <div><div class="label">Rekabet (sonuç)</div><div class="value">${k.competition === null ? '—' : fmt.format(k.competition)}</div></div>
      <div><div class="label">Trend</div><div class="value">${k.trend ?? 'veri yetersiz'}</div></div>
    </div>
    ${points.length > 1 ? '<h4>Rekabet geçmişi</h4>' + sparkline(points.map((p) => p.resultsTotal)) : '<p class="note">Bu kelime için henüz yeterli rekabet geçmişi yok. Aynı kelimeyi tekrar araştırıp veri biriktir.</p>'}
    ${k.topShops.length ? `<p class="note">Bu kelimeyi kullanan mağazalar: ${k.topShops.join(', ')}</p>` : ''}
  `;
  $('#detail').classList.remove('hidden');
}

function sparkline(values, label) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = 100 / Math.max(1, values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(28 - ((v - min) / span) * 24).toFixed(2)}`)
    .join(' ');

  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">
    <polyline fill="none" stroke="#f1641e" stroke-width="0.8" points="${points}" vector-effect="non-scaling-stroke" />
  </svg>
  <p class="note">${label ? `${label} · ` : ''}${values.length} günlük kayıt</p>`;
}

$('#detail-close').addEventListener('click', () => $('#detail').classList.add('hidden'));
$('#detail').addEventListener('click', (event) => {
  if (event.target === $('#detail')) $('#detail').classList.add('hidden');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('#detail').classList.add('hidden');
});

// ---------- saved keywords ----------

async function loadSaved() {
  const { items } = await api('/api/saved');
  state.saved = new Set(items.map((i) => i.keyword));
  $('#saved-section').classList.toggle('hidden', items.length === 0);
  $('#saved-list').innerHTML = items
    .map(
      (i) => `<li>
        <span><strong>${i.keyword}</strong>${i.note ? ` <span class="note">— ${i.note}</span>` : ''}</span>
        <button class="icon-btn" data-remove="${i.keyword}" title="Sil">×</button>
      </li>`,
    )
    .join('');
  renderTable();
}

async function toggleSave(keyword) {
  if (state.saved.has(keyword)) {
    state.saved.delete(keyword);
    await api(`/api/saved?keyword=${encodeURIComponent(keyword)}`, { method: 'DELETE' });
    toast('Kaldırıldı');
  } else {
    state.saved.add(keyword);
    await api('/api/saved', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyword }),
    });
    toast('Kaydedildi');
  }
  await loadSaved();
}

$('#saved-list').addEventListener('click', async (event) => {
  const keyword = event.target.dataset?.remove;
  if (!keyword) return;
  state.saved.delete(keyword);
  await api(`/api/saved?keyword=${encodeURIComponent(keyword)}`, { method: 'DELETE' });
  await loadSaved();
});

$('#copy-tags').addEventListener('click', async () => {
  const tags = [...state.saved].slice(0, 13);
  if (!tags.length) return;
  await navigator.clipboard.writeText(tags.join(', '));
  toast(`${tags.length} tag kopyalandı`);
});

$('#clear-saved').addEventListener('click', async () => {
  if (!confirm('Tüm kayıtlı kelimeler silinsin mi?')) return;
  for (const keyword of [...state.saved]) {
    await api(`/api/saved?keyword=${encodeURIComponent(keyword)}`, { method: 'DELETE' });
  }
  state.saved.clear();
  await loadSaved();
  toast('Temizlendi');
});

// ---------- automation ----------

const TASK_LABELS = {
  shop_audit: 'Mağaza denetimi',
  keyword_refresh: 'Kelime tazeleme',
};

function fmtDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('tr-TR');
}

async function loadAutomation() {
  try {
    const status = await api('/api/automation/status');
    const cards = [
      { label: 'Durum', value: status.enabled ? 'Açık' : 'Kapalı' },
      { label: 'Çalışma saati', value: `${String(status.hour).padStart(2, '0')}:00` },
      { label: 'Sonraki koşu', value: fmtDateTime(status.nextRunAt) },
      { label: 'Mağaza', value: status.shopConfigured ? 'bağlı' : 'bağlı değil' },
      { label: 'Kayıtlı kelime', value: status.savedKeywords },
    ];
    $('#auto-status').innerHTML = cards
      .map((c) => `<div class="card"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`)
      .join('');

    const problems = [];
    if (!status.shopConfigured) problems.push('.env içinde ETSY_SHOP_ID tanımlı değil — mağaza denetimi çalışmayacak.');
    if (status.savedKeywords === 0) problems.push('Kayıtlı kelime yok — kelime tazeleme çalışmayacak.');
    $('#auto-note').textContent = problems.length
      ? problems.join(' ')
      : 'Her gece otomatik çalışır. Sunucu bu saatlerde açık olmalı.';

    const history = await api('/api/automation/history');

    renderScoreSeries(history.scoreSeries);
    renderKeywordTrends(history.keywordTrends);
    renderRuns(history.runs);
  } catch (error) {
    $('#auto-note').textContent = `Otomasyon bilgisi alınamadı: ${error.message}`;
  }
}

function renderScoreSeries(series) {
  const wrap = $('#score-series-wrap');
  if (!series?.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  $('#score-series').innerHTML = sparkline(series.map((p) => p.score), series[series.length - 1].score.toFixed(1));
}

function renderKeywordTrends(trends) {
  const wrap = $('#keyword-trends-wrap');
  const rows = (trends ?? []).filter((t) => t.change !== null);
  if (!rows.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  $('#keyword-trends').innerHTML = rows
    .map((t) => {
      const icon = t.direction === 'up' ? '▲' : t.direction === 'down' ? '▼' : '▬';
      const pct = t.previous ? (((t.current - t.previous) / t.previous) * 100).toFixed(1) : '0.0';
      const cls = t.direction === 'up' ? 'down' : t.direction === 'down' ? 'up' : 'flat';
      return `<li>
        <span>${t.keyword}</span>
        <span class="trend ${cls}">${icon} ${pct}% <span class="note">(${fmt.format(t.previous)} → ${fmt.format(t.current)})</span></span>
      </li>`;
    })
    .join('');
}

function renderRuns(runs) {
  const wrap = $('#runs-wrap');
  if (!runs?.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  $('#runs-list').innerHTML = runs
    .slice(0, 10)
    .map((r) => {
      const icon = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '–' : '✗';
      const cls = r.status === 'ok' ? 'up' : r.status === 'skipped' ? 'flat' : 'down';
      return `<li>
        <span class="trend ${cls}">${icon}</span>
        <span>${TASK_LABELS[r.task] ?? r.task}</span>
        <span class="note">${r.message}</span>
        <span class="note">${fmtDateTime(r.startedAt)}</span>
      </li>`;
    })
    .join('');
}

$('#run-now').addEventListener('click', async () => {
  const button = $('#run-now');
  button.disabled = true;
  button.textContent = 'Çalışıyor…';
  try {
    const data = await api('/api/automation/run', { method: 'POST' });
    renderRuns(data.runs);
    const failed = data.results.filter((r) => r.status === 'error');
    if (failed.length) toast(`Hata: ${failed[0].message}`, true);
    else toast(data.results.map((r) => r.message).join(' · '));
    loadAutomation();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Şimdi çalıştır';
  }
});

$('#refresh-auto').addEventListener('click', loadAutomation);

// ---------- shop audit ----------

$('#shop-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const shopId = $('#shop-id').value.trim();
  if (!shopId) return;

  const button = $('#shop-submit');
  button.disabled = true;
  button.textContent = 'Denetleniyor…';

  try {
    const keywords = [...state.saved].slice(0, 25);
    const query = keywords.length ? `&keywords=${encodeURIComponent(keywords.join(','))}` : '';
    const data = await api(`/api/shop/audit?shopId=${encodeURIComponent(shopId)}${query}`);
    renderShopAudit(data);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Denetle';
  }
});

function renderShopAudit(data) {
  const cards = [
    { label: 'Mağaza', value: data.shopId },
    { label: 'Ortalama skor', value: data.averageScore },
    { label: 'İlan', value: `${data.listingsAnalyzed}/${data.listingsTotal}` },
    { label: 'A / B / C / D', value: `${data.gradeCounts.A}/${data.gradeCounts.B}/${data.gradeCounts.C}/${data.gradeCounts.D}` },
    { label: 'Tag doluluğu', value: `${data.tagSlotsUsed}/${data.tagSlotsTotal}` },
  ];
  $('#shop-summary').innerHTML = cards
    .map((c) => `<div class="card"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`)
    .join('');
  $('#shop-summary').classList.remove('hidden');

  const worst = (a, b) => a.score - b.score;
  $('#audit-table tbody').innerHTML = data.audits
    .slice()
    .sort(worst)
    .map((a) => {
      const top = a.findings.filter((f) => f.severity !== 'info');
      const rest = a.findings.length - top.length;
      const note = top.length
        ? `<span class="sev ${top[0].severity}">${top[0].message}</span>${
            top.length > 1 ? ` <span class="note">+${top.length - 1} sorun</span>` : ''
          }`
        : `<span class="sev ok">Sorun yok${rest ? ` <span class="note">(${rest} öneri)</span>` : ''}</span>`;

      return `<tr>
        <td>${a.image ? `<img class="thumb" src="${a.image}" alt="" />` : ''}<span class="title-cell">${a.title}</span></td>
        <td class="num"><span class="score ${scoreClass(a.score)}">${a.score}</span> <span class="note">${a.grade}</span></td>
        <td class="finding">${note}</td>
        <td class="num">${a.tags.length}/13</td>
        <td>${a.url ? `<a class="icon-btn" href="${a.url}" target="_blank" rel="noreferrer noopener" title="Etsy'de aç">↗</a>` : ''}</td>
      </tr>`;
    })
    .join('');

  $('#shop-results').classList.remove('hidden');
}

// ---------- boot ----------

async function boot() {
  await loadHealth();
  const health = await api('/api/health').catch(() => null);
  if (health?.defaultShopId) $('#shop-id').value = health.defaultShopId;
  await loadSaved().catch(() => {});
  await loadAutomation();
}

boot();
