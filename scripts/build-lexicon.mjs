// Builds server/assets/lexicon-{fr,en}.txt: every word a player may guess, one per line, accents kept, sorted.
//
//   common words : Wiktionary entries and all their inflected forms (kaikki.org extracts)
//   proper nouns : words of Wikipedia article titles, minus what the dictionary already knows,
//                  minus words seen fewer than MIN_TITLE_COUNT times (typos, one-off oddities)
//
// Sources go in .cache/lexicon (gitignored); only the generated lists are committed.
//   node scripts/build-lexicon.mjs [fr|en ...]
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'

const CACHE = '.cache/lexicon'
const OUT = 'server/assets'
const MIN_TITLE_COUNT = Number(process.env.MIN_TITLE_COUNT ?? 3)
const WORD = /^\p{L}+$/u
// kaikki placeholders that are not real forms
const FAKE_FORM_TAGS = new Set(['table-tags', 'inflection-template', 'class', 'romanization'])

const lines = (path, gz = false) => {
  const input = createReadStream(path)
  return createInterface({ input: gz ? input.pipe(createGunzip()) : input, crlfDelay: Infinity })
}
const norm = s => s.normalize('NFC').toLowerCase()

async function dictionaryWords(lang) {
  const words = new Set()
  const add = w => { if (typeof w === 'string' && WORD.test(w)) words.add(norm(w)) }
  for await (const line of lines(`${CACHE}/kaikki-${lang}.jsonl`)) {
    if (!line) continue
    const e = JSON.parse(line)
    add(e.word)
    for (const f of e.forms ?? []) if (!f.tags?.some(t => FAKE_FORM_TAGS.has(t))) add(f.form)
  }
  return words
}

async function titleWords(lang) {
  const counts = new Map()
  for await (const line of lines(`${CACHE}/${lang}wiki-titles.gz`, true)) {
    for (const w of line.split(/[^\p{L}]+/u)) {
      if (w.length < 2) continue
      const k = norm(w)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  return counts
}

mkdirSync(OUT, { recursive: true })
for (const lang of process.argv.slice(2).length ? process.argv.slice(2) : ['fr', 'en']) {
  const dict = await dictionaryWords(lang)
  const titles = await titleWords(lang)
  const names = [...titles].filter(([w, n]) => n >= MIN_TITLE_COUNT && !dict.has(w)).map(([w]) => w)
  const all = [...new Set([...dict, ...names])].sort()
  writeFileSync(`${OUT}/lexicon-${lang}.txt`, all.join('\n') + '\n')
  console.log(`${lang}: ${dict.size} dictionary + ${names.length} proper nouns = ${all.length} words`)
}
