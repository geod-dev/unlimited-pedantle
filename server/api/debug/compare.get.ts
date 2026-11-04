import { cosine } from '@/server/utils/embed'
import { assertDebug, cleanLang, loadStore, rankOf, resolve, round4 } from '@/server/utils/debug'

// Similarity between two words of the same language, and how each ranks among the other's neighbours.
export default defineEventHandler(async (event) => {
  assertDebug()
  const q = getQuery(event)
  const lang = cleanLang(q.lang)
  const store = await loadStore(lang)
  const ia = resolve(store, String(q.a ?? ''))
  const ib = resolve(store, String(q.b ?? ''))
  const res = {
    lang,
    a: ia !== undefined ? store.words[ia]! : String(q.a ?? '').trim().toLowerCase(),
    b: ib !== undefined ? store.words[ib]! : String(q.b ?? '').trim().toLowerCase(),
    existsA: ia !== undefined,
    existsB: ib !== undefined,
    total: store.words.length
  }
  if (ia === undefined || ib === undefined) return res

  const sim = cosine(store.vecs[ia]!, store.vecs[ib]!)
  return {
    ...res,
    sim: round4(sim),
    rankBinA: rankOf(store.vecs, ia, sim), // "b" is the Nth closest word to "a"
    rankAinB: rankOf(store.vecs, ib, sim)
  }
})
