function normalizeWordToken(w: string) {
  if (w.endsWith('s') && w.length > 3) w = w.replace(/e?s$/, '');
  return w;
}

const queryKey = "potato_raw";
const itemKey = "yolk_baby_potatoes";
const chainKey = "yolk";

const rawQWords = queryKey.split('_').filter(w => w.length >= 2);
const rawIWords = itemKey.split('_').filter(w => w.length >= 2);
if (chainKey) rawIWords.push(...chainKey.split('_'));

const qWords = new Set(rawQWords.map(normalizeWordToken).filter(w => w.length >= 2));
const iWords = new Set(rawIWords.map(normalizeWordToken).filter(w => w.length >= 2));

console.log({ qWords: Array.from(qWords), iWords: Array.from(iWords) });

let shared = 0;
qWords.forEach(qw => {
  if (iWords.has(qw) || [...iWords].some(iw => iw.length > 3 && qw.length > 3 && (iw.startsWith(qw) || qw.startsWith(iw)))) {
    shared++;
  }
});
const qCoverage = shared / qWords.size;
const iCoverage = shared / iWords.size;
let score = (qCoverage * 0.7) + (iCoverage * 0.3);
console.log({ qCoverage, iCoverage, score });
