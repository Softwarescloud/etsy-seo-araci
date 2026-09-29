/**
 * API anahtarı gerektirmeyen çekirdek testler.
 * Çalıştır:  npm test
 */
import assert from 'node:assert/strict';

import { extractTagPhrases, extractTitlePhrases, includesPhrase, normalize } from '../src/services/text.ts';
import { demandScore, opportunityScore } from '../src/services/keywords.ts';
import { auditListing, LIMITS, summarize } from '../src/services/audit.ts';
import type { EtsyListing } from '../src/etsy/client.ts';

function listing(overrides: Partial<EtsyListing> = {}): EtsyListing {
  return {
    listing_id: 1,
    title: 'Personalized Dog Collar Name Tag',
    description: 'x'.repeat(400),
    tags: ['dog collar', 'personalized', 'pet gift', 'leash', 'name tag'],
    ...overrides,
  } as EtsyListing;
}

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

console.log('\ntext');

test('normalize küçük harf, aksan ve noktalama temizler', () => {
  assert.equal(normalize('  Personalized  DOG-Collar!! '), 'personalized dog collar');
  assert.equal(normalize('Café Mug — Set'), 'cafe mug set');
});

test('başlıktan tekil ve ikili gruplar çıkar', () => {
  const phrases = extractTitlePhrases('Personalized Dog Collar Name Tag').map((p) => p.phrase);
  assert.ok(phrases.includes('dog'));
  assert.ok(phrases.includes('dog collar'));
  assert.ok(phrases.includes('collar name'));
  assert.ok(!phrases.includes('personalized dog collar'), 'üçlü gruplar çıkarılmaz');
});

test('durdurma kelimeleri elenir, niş kelimeleri korunur', () => {
  const phrases = extractTitlePhrases('Gift for Her Custom Personalized Present').map((p) => p.phrase);
  assert.ok(!phrases.includes('for'), 'fonksiyon kelimesi elenmeli');
  assert.ok(phrases.includes('personalized'), '"personalized" niş kelimesi korunmalı');
  assert.ok(phrases.includes('gift'), '"gift" niş kelimesi korunmalı');
  assert.ok(phrases.includes('custom'), '"custom" niş kelimesi korunmalı');
});

test('tag tam olarak ve kelime kelime üretilir', () => {
  const phrases = extractTagPhrases(['dog collar', 'gift']).map((p) => p.phrase);
  assert.ok(phrases.includes('dog collar'));
  assert.ok(phrases.includes('dog'));
  assert.ok(phrases.includes('collar'));
});

test('includesPhrase kelime sınırında çalışır', () => {
  assert.ok(includesPhrase('custom dog collar for large dogs', 'dog collar'));
  assert.ok(!includesPhrase('dogcollarsomething', 'dog collar'));
});

console.log('\nscoring');

test('talep skoru 0-100 aralığında ve örneklemeyle ölçeklenir', () => {
  const big = demandScore(600, 100);
  const small = demandScore(60, 100);
  assert.ok(big <= 100 && big > 0);
  assert.ok(big > small * 5);
  assert.equal(demandScore(0, 100), 0);
  assert.equal(demandScore(100, 0), 0);
});

test('fırsat skoru yalnızca rekabet biliniyorsa hesaplanır', () => {
  assert.equal(opportunityScore(80, null), null);
  assert.equal(opportunityScore(80, 0), null);
});

test('fırsat skoru aynı talepte düşük rekabeti ödüllendirir', () => {
  const lowCompetition = opportunityScore(70, 400)!;
  const highCompetition = opportunityScore(70, 900_000)!;
  assert.ok(lowCompetition > highCompetition * 2, `${lowCompetition} vs ${highCompetition}`);
  assert.ok(lowCompetition >= 0 && lowCompetition <= 100);
});

test('talep arttıkça fırsat skoru artar', () => {
  assert.ok(opportunityScore(90, 10_000)! > opportunityScore(20, 10_000)!);
});

console.log('\naudit');

test('sağlam ilan yüksek not alır', () => {
  const audit = auditListing(
    listing({
      title: 'Personalized Dog Collar with Custom Name Tag',
      tags: Array.from({ length: 13 }, (_, i) => `tag number ${i + 1}`),
    }),
  );
  assert.ok(audit.score >= 85, `skor ${audit.score}`);
  assert.equal(audit.grade, 'A');
});

test('eksik tag uyarısı üretir', () => {
  const audit = auditListing(listing({ tags: ['dog collar', 'pet'] }));
  const warning = audit.findings.find((f) => f.message.includes('/13 tag'));
  assert.ok(warning, 'tag eksikliği bildirilmeli');
  assert.equal(warning?.severity, 'warning');
});

test('13 tag sınırını aşmak hata üretir', () => {
  const audit = auditListing(listing({ tags: Array.from({ length: 15 }, (_, i) => `t${i}`) }));
  assert.ok(audit.findings.some((f) => f.severity === 'error' && f.message.includes('en fazla 13')));
});

test('20 karakteri aşan tag hata üretir', () => {
  const audit = auditListing(listing({ tags: ['this tag is definitely far too long'] }));
  assert.ok(audit.findings.some((f) => f.severity === 'error' && f.message.includes('20 karakteri')));
});

test('yinelenen tag tespit edilir', () => {
  const audit = auditListing(listing({ tags: ['dog collar', 'Dog Collar', 'pet gift'] }));
  assert.ok(audit.findings.some((f) => f.message.includes('Yinelenen tag')));
});

test('140 karakteri aşan başlık hata üretir', () => {
  const audit = auditListing(listing({ title: 'a'.repeat(150) }));
  assert.ok(audit.findings.some((f) => f.severity === 'error' && f.message.includes('140')));
});

test('hedef kelimelerin kullanılmadığı raporlanır', () => {
  const audit = auditListing(listing(), ['embroidered', 'waterproof', 'cat collar']);
  assert.deepEqual(audit.missingKeywords, ['embroidered', 'waterproof', 'cat collar']);
});

test('hedef kelime başlıkta geçiyorsa eksik sayılmaz', () => {
  const audit = auditListing(listing(), ['dog collar']);
  assert.deepEqual(audit.missingKeywords, []);
});

test('skor 0-100 aralığında kalır', () => {
  const audit = auditListing(
    listing({ title: '', description: '', tags: Array.from({ length: 20 }, () => 'x'.repeat(40)) }),
  );
  assert.ok(audit.score >= 0 && audit.score <= 100);
});

test('özet not dağılımını ve tag doluluğunu hesaplar', () => {
  const audits = [
    auditListing(listing({ listing_id: 1, tags: Array.from({ length: 13 }, (_, i) => `tag ${i}`) })),
    auditListing(listing({ listing_id: 2, tags: [] })),
  ];
  const result = summarize(audits, 'magaza', 40);
  assert.equal(result.listingsAnalyzed, 2);
  assert.equal(result.listingsTotal, 40);
  assert.equal(result.tagSlotsTotal, LIMITS.tagsMax * 2);
  assert.equal(result.tagSlotsUsed, 13);
  assert.ok(result.averageScore > 0 && result.averageScore <= 100);
  assert.equal(
    Object.values(result.gradeCounts).reduce((a, b) => a + b, 0),
    2,
  );
});

console.log(`\n${passed} test geçti.\n`);
