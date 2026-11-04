import type { Tok } from '@/server/utils/text'
import { useDb } from '@/server/utils/db'
import { center, getEmbeddings, getMean } from '@/server/utils/embed'
import { verbLemmas } from '@/server/utils/lemma'
import { fold, lower } from '@/server/utils/text'

export interface StoredGame {
  id: string
  lang: string
  title: string
  url: string
  titleLen: number
  tokens: Tok[]
}

export interface LoadedGame extends StoredGame {
  /** folded word (or 'sfx:<group>' for ordinal suffixes) -> token indexes */
  index: Map<string, number[]>
  /** folded verb lemma -> token indexes of all its conjugated forms on the page */
  lemmaIndex: Map<string, number[]>
  /** digit and roman numeral tokens, compared by value */
  numerals: { i: number; kind: 'n' | 'r'; v: number }[]
  /** lower-case (accented) non-stopword page word -> token indexes */
  lwIndex: Map<string, number[]>
  /** the same words with their centered vectors */
  vectors: Map<string, Float32Array>
  /** mean vector used to center this game's vectors (guesses must be centered with the same one) */
  mean: Float32Array
}

const cache = new Map<string, LoadedGame>()

export async function saveGame(g: StoredGame) {
  const db = await useDb()
  await db.execute({
    sql: 'INSERT INTO games (id, lang, title, url, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [g.id, g.lang, g.title, g.url, JSON.stringify({ titleLen: g.titleLen, tokens: g.tokens }), Date.now()]
  })
}

export async function loadGame(id: string): Promise<LoadedGame> {
  const hit = cache.get(id)
  if (hit) return hit
  const db = await useDb()
  const rs = await db.execute({ sql: 'SELECT * FROM games WHERE id = ?', args: [id] })
  const row = rs.rows[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Game not found' })
  const data = JSON.parse(row.data as string)
  const game = await hydrate({
    id, lang: row.lang as string, title: row.title as string, url: row.url as string,
    titleLen: data.titleLen, tokens: data.tokens
  })
  cacheGame(game)
  return game
}

export function cacheGame(g: LoadedGame) {
  if (cache.size > 50) cache.delete(cache.keys().next().value!)
  cache.set(g.id, g)
}

export async function hydrate(g: StoredGame): Promise<LoadedGame> {
  const index = new Map<string, number[]>()
  const numerals: LoadedGame['numerals'] = []
  const lwIndex = new Map<string, number[]>()
  g.tokens.forEach((t, i) => {
    if (t.k === 'n' || t.k === 'r') numerals.push({ i, kind: t.k, v: t.v })
    if (t.k !== 'w' && t.k !== 'u') return
    const list = index.get(t.f)
    if (list) list.push(i)
    else index.set(t.f, [i])
    if (t.k === 'w' && !t.sw) { // numbers, suffixes and stopwords are never embedded
      const lw = lower(t.s)
      lwIndex.set(lw, [...(lwIndex.get(lw) ?? []), i])
    }
  })
  const lemmaIndex = new Map<string, number[]>()
  for (const [f, idx] of index) {
    const first = g.tokens[idx[0]!]
    if (!first || first.k !== 'w') continue
    for (const lemma of await verbLemmas(g.lang, first.s)) {
      const key = fold(lemma)
      lemmaIndex.set(key, [...(lemmaIndex.get(key) ?? []), ...idx])
    }
  }
  const all = await getEmbeddings([...lwIndex.keys()], g.lang)
  const mean = await getMean(g.lang)
  const vectors = new Map([...all].map(([lw, v]) => [lw, center(v, mean)] as const))
  return { ...g, index, lwIndex, lemmaIndex, numerals, vectors, mean }
}
