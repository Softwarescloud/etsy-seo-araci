/**
 * API anahtarı gerektirmeyen çekirdek testler.
 * Çalıştır:  npm test
 */
import assert from 'node:assert/strict';

import { extractTagPhrases, extractTitlePhrases, includesPhrase, normalize } from '../src/services/text.ts';
import { demandScore, opportunityScore } from '../src/services/keywords.ts';

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

console.log(`\n${passed} test geçti.\n`);
