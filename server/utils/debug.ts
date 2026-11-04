import { useDb } from '@/server/utils/db'
import { center, cosine, fromBlob, getMean } from '@/server/utils/embed'
import { fold, lower } from '@/server/utils/text'

/** The debug API can spend embedding credits: dev only, unless NUXT_DEBUG_ENABLED=true. */
export function assertDebug() {
  if (!import.meta.dev && useRuntimeConfig().debugEnabled !== 'true') {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
}

export const cleanLang = (s: unknown) => (/^[a-z]{2,8}$/.test(String(s)) ? String(s) : 'fr')
export const round4 = (n: number) => Math.round(n * 10000) / 10000

interface Store {
  count: number
  mean: Float32Array
  words: string[] // accented, lower case
  fs: string[] // accent-folded
  /** mean-centered vectors, exactly what the game compares */
  vecs: Float32Array[]
  index: Map<string, number>
}
const stores = new Map<string, Store>()

/** All words of ONE language: neighbours and comparisons never cross languages. */
export async function loadStore(lang: string): Promise<Store> {
  const db = await useDb()
  const count = Number((await db.execute({ sql: 'SELECT COUNT(*) AS c FROM embeddings WHERE lang = ?', args: [lang] })).rows[0]!.c)
  const mean = await getMean(lang)
  const hit = stores.get(lang)
  if (hit && hit.count === count && hit.mean === mean) return hit
  const rows = (await db.execute({ sql: 'SELECT w, f, vec FROM embeddings WHERE lang = ? ORDER BY w', args: [lang] })).rows
  const words = rows.map(r => r.w as string)
  const store: Store = {
    count, mean, words,
    fs: rows.map(r => r.f as string),
    vecs: rows.map(r => center(fromBlob(r.vec as ArrayBuffer), mean)),
    index: new Map(words.map((w, i) => [w, i]))
  }
  stores.set(lang, store)
  return store
}

/** Index of a typed word: the exact spelling, else the first word spelled the same up to accents. */
export function resolve(store: Store, typed: string): number | undefined {
  const w = lower(typed.trim())
  return store.index.get(w) ?? (store.fs.indexOf(fold(w)) >= 0 ? store.fs.indexOf(fold(w)) : undefined)
}

/** 1-based rank of a word with similarity `sim` among the neighbours of word `i` */
export function rankOf(vecs: Float32Array[], i: number, sim: number): number {
  let better = 0
  for (let j = 0; j < vecs.length; j++) if (j !== i && cosine(vecs[i]!, vecs[j]!) > sim) better++
  return better + 1
}
