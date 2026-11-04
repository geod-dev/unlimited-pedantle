import { useDb } from '@/server/utils/db'
import { fold, lower } from '@/server/utils/text'

const DIM = 512
const MODEL = 'voyage-4-lite'

export const toBlob = (v: ArrayLike<number>) => new Uint8Array(new Float32Array(v).buffer)
export const fromBlob = (b: ArrayBuffer | Uint8Array): Float32Array => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b)
  return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength))
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0, x = 0, y = 0
  for (let i = 0; i < a.length; i++) { s += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]! }
  return s / (Math.sqrt(x * y) || 1)
}

async function callVoyage(inputs: string[]): Promise<number[][]> {
  const key = useRuntimeConfig().voyageApiKey
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      // Bare words embed by spelling ("roi" ~ "voie"); this prompt makes the vectors semantic.
      body: JSON.stringify({ input: inputs.map(w => `Sens et thème du mot : ${w}`), model: MODEL, output_dimension: DIM })
    })
    if (res.ok) return ((await res.json()) as any).data.map((d: any) => d.embedding)
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }
    throw createError({ statusCode: 502, statusMessage: `Embedding API error ${res.status}` })
  }
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',')

/**
 * Embeddings for accent-preserving lower-case words in a language, keyed by that word.
 * Only words missing from the DB hit the (paid) API; a word already embedded in another language is copied
 * (the model embeds the string, not the language).
 */
export async function getEmbeddings(words: string[], lang: string): Promise<Map<string, Float32Array>> {
  const db = await useDb()
  const keys = [...new Set(words.map(lower))]
  const result = new Map<string, Float32Array>()

  for (let i = 0; i < keys.length; i += 400) {
    const chunk = keys.slice(i, i + 400)
    const rs = await db.execute({ sql: `SELECT w, vec FROM embeddings WHERE lang = ? AND w IN (${placeholders(chunk.length)})`, args: [lang, ...chunk] })
    for (const row of rs.rows) result.set(row.w as string, fromBlob(row.vec as ArrayBuffer))
  }

  let missing = keys.filter(k => !result.has(k))
  const insert = (k: string, vec: ArrayLike<number>) => ({
    sql: 'INSERT OR IGNORE INTO embeddings (w, lang, f, vec) VALUES (?, ?, ?, ?)',
    args: [k, lang, fold(k), toBlob(vec)]
  })

  for (let i = 0; i < missing.length; i += 400) {
    const chunk = missing.slice(i, i + 400)
    const rs = await db.execute({ sql: `SELECT w, vec FROM embeddings WHERE w IN (${placeholders(chunk.length)})`, args: chunk })
    const copies = new Map(rs.rows.map(r => [r.w as string, fromBlob(r.vec as ArrayBuffer)]))
    if (copies.size) await db.batch([...copies].map(([k, v]) => insert(k, v)))
    for (const [k, v] of copies) result.set(k, v)
  }
  missing = missing.filter(k => !result.has(k))

  for (let i = 0; i < missing.length; i += 128) {
    const chunk = missing.slice(i, i + 128)
    const vecs = await callVoyage(chunk)
    await db.batch(chunk.map((k, j) => insert(k, vecs[j]!)))
    chunk.forEach((k, j) => result.set(k, new Float32Array(vecs[j]!)))
  }
  return result
}

/** Vectors already in the database for this language, never calls the API. */
export async function getCachedEmbeddings(words: string[], lang: string): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>()
  const keys = [...new Set(words.map(lower))]
  if (!keys.length) return out
  const db = await useDb()
  const rs = await db.execute({ sql: `SELECT w, vec FROM embeddings WHERE lang = ? AND w IN (${placeholders(keys.length)})`, args: [lang, ...keys] })
  for (const row of rs.rows) out.set(row.w as string, fromBlob(row.vec as ArrayBuffer))
  return out
}

/** Dictionary spellings known for an accent-folded word ("ete" -> ["été", "eté"...]). */
export async function candidatesFor(f: string, lang: string): Promise<string[]> {
  const db = await useDb()
  const rs = await db.execute({ sql: 'SELECT w FROM embeddings WHERE lang = ? AND f = ? ORDER BY w', args: [lang, f] })
  return rs.rows.map(r => r.w as string)
}

// Embeddings share a large common component, so raw cosine rates every pair ~0.6 and generic words ("puis",
// "notamment") look close to everything. We subtract the mean vector of the language's words before comparing.
const meanCache = new Map<string, { count: number; mean: Float32Array }>()
const MIN_WORDS_FOR_LANG_MEAN = 100 // below that, the mean of all languages is steadier

export async function getMean(lang: string): Promise<Float32Array> {
  const db = await useDb()
  const num = async (sql: string, args: string[] = []) => Number((await db.execute({ sql, args })).rows[0]!.c)
  const inLang = await num('SELECT COUNT(*) AS c FROM embeddings WHERE lang = ?', [lang])
  const perLang = inLang >= MIN_WORDS_FOR_LANG_MEAN
  const key = perLang ? lang : '*'
  const count = perLang ? inLang : await num('SELECT COUNT(*) AS c FROM embeddings')

  // only recomputed once the vocabulary grew by 25%, so similarities stay stable from one game to the next
  const hit = meanCache.get(key)
  if (hit && count < hit.count * 1.25) return hit.mean

  const rows = (await (perLang
    ? db.execute({ sql: 'SELECT vec FROM embeddings WHERE lang = ?', args: [lang] })
    : db.execute('SELECT vec FROM embeddings'))).rows
  const vecs = rows.map(r => fromBlob(r.vec as ArrayBuffer))
  const mean = new Float32Array(vecs[0]?.length ?? DIM)
  for (const v of vecs) for (let i = 0; i < mean.length; i++) mean[i]! += v[i]!
  for (let i = 0; i < mean.length; i++) mean[i]! /= vecs.length || 1
  meanCache.set(key, { count, mean })
  return mean
}

export const center = (v: Float32Array, mean: Float32Array): Float32Array => v.map((x, i) => x - mean[i]!)
