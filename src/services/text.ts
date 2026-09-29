/**
 * Yalnızca dilbilgisel fonksiyon kelimeleri ve saf gürültü. Nisan kelimeleri
 * ("personalized", "gift", "custom" gibi) nişin ta kendisidir ve elenmemelidir —
 * filtrelemek en değerli kelimeleri silerdi.
 */
const STOPWORDS = new Set(
  `a an and are as at be been but by for from has have he her hers him his how i if in into is it its
   me my of on or our ours she so than that the their theirs them then there these they this to too
   was we were what when where which who why will with you your yours
   etsy com https http www com
   s t re ve ll d m
   do does did done
   can could would should shall may might must
   not no nor if but so as than
   have has had having
   one two three four five six seven eight nine ten`
    .split(/\s+/)
    .filter(Boolean),
);

const MIN_LENGTH = 2;
const MAX_LENGTH = 28;
const MAX_PHRASE_WORDS = 4;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableToken(token: string): boolean {
  if (token.length < MIN_LENGTH || token.length > MAX_LENGTH) return false;
  if (/^\d+$/.test(token)) return false;
  if (STOPWORDS.has(token)) return false;
  return true;
}

function isUsablePhrase(phrase: string): boolean {
  const words = phrase.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > MAX_PHRASE_WORDS) return false;
  return words.every(isUsableToken);
}

export interface CandidatePhrase {
  phrase: string;
  words: number;
}

/** Başlıktan 1'li ve 2'li kelime grupları çıkarır. "personalized dog collar" ->
 *  personalized / dog / collar / personalized dog / dog collar */
export function extractTitlePhrases(title: string): CandidatePhrase[] {
  const words = normalize(title).split(' ').filter(Boolean);
  const out: CandidatePhrase[] = [];

  for (let i = 0; i < words.length; i++) {
    const single = words[i];
    if (single && isUsableToken(single)) out.push({ phrase: single, words: 1 });

    const pair = i + 1 < words.length ? `${single} ${words[i + 1]}` : '';
    if (pair && isUsablePhrase(pair)) out.push({ phrase: pair, words: 2 });
  }

  return out;
}

/** Etsy tag'leri çok kelimelik olabilir; hem tam tag'i hem kelimelerini üret. */
export function extractTagPhrases(tags: string[]): CandidatePhrase[] {
  const out: CandidatePhrase[] = [];
  for (const raw of tags) {
    const normalized = normalize(raw);
    if (!normalized) continue;
    if (isUsablePhrase(normalized)) out.push({ phrase: normalized, words: normalized.split(' ').length });
    for (const word of normalized.split(' ')) {
      if (isUsableToken(word)) out.push({ phrase: word, words: 1 });
    }
  }
  return out;
}

export function includesPhrase(haystack: string, phrase: string): boolean {
  return ` ${normalize(haystack)} `.includes(` ${phrase} `);
}

export function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter(Boolean));
}
