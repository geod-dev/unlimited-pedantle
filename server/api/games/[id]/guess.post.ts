import { loadGame } from '@/server/utils/game'
import { candidatesFor, center, cosine, getEmbeddings } from '@/server/utils/embed'
import { fold, isStop, lower, magnitude, normDigits, romanValue, suffixKey } from '@/server/utils/text'
import { closestWord, findSpellings } from '@/server/utils/lexicon'
import { verbLemmas } from '@/server/utils/lemma'

// Keep in sync with HEAT_MIN / HEAT_MAX in app/composables/useGame.ts
// Similarities are cosines between mean-centered embeddings (see getMean).
const HEAT_MIN = 0.26 // below: nothing; from here a similar word is shown as a hint (yellow)
const HEAT_MAX = 0.5 // from here the word is discovered outright (hints reach red just below)

const round = (n: number) => Math.round(n * 1000) / 1000

/** A number in the same order of magnitude is a hint; the closer, the hotter (same scale as word similarity). */
function numberSim(guess: number, target: number): number | null {
  if (guess === target || magnitude(guess) !== magnitude(target)) return null
  const d = Math.abs(guess - target) / Math.max(guess, target)
  return round(HEAT_MIN + (HEAT_MAX - HEAT_MIN) * (1 - d) ** 3)
}

export default defineEventHandler(async (event) => {
  const game = await loadGame(getRouterParam(event, 'id')!)
  const { word } = await readBody<{ word?: string }>(event)
  const typed = (word ?? '').normalize('NFC').trim().toLowerCase()

  if (/[0-9]/.test(typed) && /\p{L}/u.test(typed)) return { valid: false, reason: 'Letters and digits cannot be mixed' }
  const isNumber = /^[0-9]+$/.test(typed)
  if (!isNumber && !/^\p{L}+$/u.test(typed)) return { valid: false, reason: 'Enter a single word' }

  const exact: { i: number; s: string }[] = []
  const near: { i: number; sim: number }[] = []
  const seen = new Set<number>()
  const pushExact = (idx: number[]) => {
    for (const i of idx) if (!seen.has(i)) { seen.add(i); exact.push({ i, s: (game.tokens[i] as { s: string }).s }) }
  }
  const done = () => {
    const best = near.reduce((m, n) => Math.max(m, n.sim), 0)
    return { valid: true, typed, word: typed, exact, near, best }
  }

  // ---- digits: exact value, or same order of magnitude ----
  if (isNumber) {
    const f = normDigits(typed)
    const v = Number(f)
    for (const t of game.numerals) {
      if (t.kind !== 'n') continue
      if ((game.tokens[t.i] as { f: string }).f === f) exact.push({ i: t.i, s: (game.tokens[t.i] as { s: string }).s })
      else { const sim = numberSim(v, t.v); if (sim !== null) near.push({ i: t.i, sim }) }
    }
    return done()
  }

  const f = fold(typed)
  const sfx = suffixKey(f)
  // every page word spelled the same up to accents ("ete" matches "été")
  const direct = game.index.get(f) ?? []
  pushExact(direct)
  const matched = [...new Set(direct.map(i => lower((game.tokens[i] as { s: string }).s)))]
  // any conjugated form uncovers all the other forms of the same verb (être / est / fût / serai...)
  for (const lemma of await verbLemmas(game.lang, typed, true)) pushExact(game.lemmaIndex.get(lemma) ?? [])
  if (sfx) pushExact(game.index.get('sfx:' + sfx) ?? [])

  // ---- roman numerals: same rules as digits, only against roman tokens ----
  const roman = romanValue(typed.toUpperCase())
  if (roman) {
    for (const t of game.numerals) {
      if (t.kind !== 'r') continue
      if (t.v === roman) exact.push({ i: t.i, s: (game.tokens[t.i] as { s: string }).s })
      else { const sim = numberSim(roman, t.v); if (sim !== null) near.push({ i: t.i, sim }) }
    }
  }
  // numerals and ordinal suffixes are never embedded, so no semantic hints for them
  if (roman || sfx) return done()

  // ---- words: dictionary check, then embedding similarity ----
  // Dictionary spellings the guess stands for: the page words it matched, else spellings already known, else as typed.
  // Several accent variants may match ("a" / "à"); they are all used.
  // (the lexicon also restores accents typed without them)
  const known = matched.length ? [] : isStop(f) ? await candidatesFor(f, game.lang) : await findSpellings(game.lang, typed)
  if (!known.length && !matched.length && !isStop(f) && !exact.length) return { valid: false, reason: 'Unknown word', suggestion: await closestWord(game.lang, typed) }
  const forms = matched.length ? matched : known.length ? known : [typed]
  const label = forms.join('/')

  let best = 0 // also tracks sub-threshold similarity, so the guess list can show a faint "warmth"
  if (!isStop(f)) {
    const missing = forms.filter(w => !game.vectors.has(w))
    const fresh = missing.length ? await getEmbeddings(missing, game.lang) : new Map<string, Float32Array>()
    const vecs = forms.map(w => game.vectors.get(w) ?? center(fresh.get(w)!, game.mean))
    for (const [other, ovec] of game.vectors) {
      if (forms.includes(other)) continue
      const sim = Math.max(...vecs.map(v => cosine(v, ovec)))
      best = Math.max(best, sim)
      if (sim >= HEAT_MAX) pushExact(game.lwIndex.get(other)!) // close enough: the word is discovered
      else if (sim >= HEAT_MIN) for (const i of game.lwIndex.get(other)!) near.push({ i, sim: round(sim) })
    }
  }
  return { valid: true, typed, word: label, exact, near, best: round(best) }
})
