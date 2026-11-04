export type Tok =
  | { k: 'w'; s: string; f: string; sw: boolean; l?: string } // word (embedded unless stopword), l = wiki link target
  | { k: 'n'; s: string; f: string; v: number; l?: string } // digits, never embedded
  | { k: 'r'; s: string; f: string; v: number; l?: string } // roman numeral, never embedded
  | { k: 'u'; s: string; f: string } // ordinal suffix after a number (e, ème, er, st, nd...), f = 'sfx:<group>'
  | { k: 'p'; s: string }
  | { k: 'br' }

const STOP_FR = 'le la les l un une des du de d et ou mais donc or ni car que qu qui quoi dont où ne pas plus se s sa son ses ce c cet cette ces il elle ils elles on je j tu nous vous me m te t lui leur leurs en y à au aux par pour sur sous dans avec sans entre vers chez est sont était étaient été être a ont avait avaient avoir fut fait ainsi aussi comme si très tout tous toute toutes mon ma mes ton ta tes notre nos votre vos'
const STOP_EN = 'the a an and or but nor so of to in on at by for with from as is are was were be been being has have had do does did it its this that these those he she they we you i his her their our your him them not no also which who whom what when where than then there here into over under about after before between'

export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFKD') // also turns "ᵉ" into "e"
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
}

/** lower case, accents kept: the spelling embeddings are computed on */
export const lower = (s: string) => s.normalize('NFC').toLowerCase()

const STOP = new Set((STOP_FR + ' ' + STOP_EN).split(' ').map(fold))
export const isStop = (f: string) => STOP.has(f)

// ---- ordinal suffixes: guessing "e" uncovers e / ème / er / ère..., while st, nd, rd, th stay separate ----
const E_GROUP = new Set(['e', 'eme', 'ieme', 'er', 'ere', 're'])
const OTHER_SUFFIXES = new Set(['st', 'nd', 'rd', 'th'])
export function suffixKey(f: string): string | null {
  return E_GROUP.has(f) ? 'e' : OTHER_SUFFIXES.has(f) ? f : null
}

// ---- numbers ----
export const normDigits = (s: string) => s.replace(/^0+(?=\d)/, '')

/** "0-100" is magnitude 0, then 100-1000 is 3, 1000-10000 is 4, ... */
export const magnitude = (v: number) => (v < 100 ? 0 : String(Math.floor(v)).length)

const ROMAN = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/
const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

/** value of a canonical roman numeral (upper case), 0 when invalid */
export function romanValue(s: string): number {
  if (!s || !ROMAN.test(s)) return 0
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN_VALUES[s[i]!]!
    total += v < (ROMAN_VALUES[s[i + 1]!] ?? 0) ? -v : v
  }
  return total
}

// "XIe", "IVème", "Ier": upper case roman followed by a lower case suffix
const ROMAN_WITH_SUFFIX = /^([IVXLCDM]+)(e|er|ère|ème|è|re|ième|nd|st|rd|th)?$/

/** single letters are mostly not numerals ("Le", "M.", "C", English "I"); keep V, X, and I outside English */
const romanAllowed = (r: string, lang: string) => r.length > 1 || r === 'V' || r === 'X' || (r === 'I' && lang !== 'en')

const TOKEN = /[0-9]+|\p{L}+/gu

export function tokenize(text: string, lang: string): Tok[] {
  const out: Tok[] = []
  const pushPunct = (s: string) => {
    if (!s) return
    s.split('\n').forEach((part, i) => {
      if (i > 0) out.push({ k: 'br' })
      if (part) out.push({ k: 'p', s: part })
    })
  }
  const pushSuffix = (s: string) => {
    const f = fold(s)
    out.push({ k: 'u', s, f: 'sfx:' + suffixKey(f)! })
  }
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const gap = text.slice(last, m.index)
    const word = m[0]
    last = m.index + word.length
    pushPunct(gap)

    if (/^[0-9]/.test(word)) {
      const f = normDigits(word)
      out.push({ k: 'n', s: word, f, v: Number(f) })
      continue
    }

    const prev = out.at(-1)
    const afterNumber = !gap && (prev?.k === 'n' || prev?.k === 'r')

    const rm = ROMAN_WITH_SUFFIX.exec(word)
    if (rm && romanValue(rm[1]!) && romanAllowed(rm[1]!, lang)) {
      out.push({ k: 'r', s: rm[1]!, f: rm[1]!, v: romanValue(rm[1]!) })
      if (rm[2]) pushSuffix(rm[2])
      continue
    }

    const f = fold(word)
    if (afterNumber && suffixKey(f)) pushSuffix(word)
    else out.push({ k: 'w', s: word, f, sw: isStop(f) })
  }
  pushPunct(text.slice(last))
  return out
}
