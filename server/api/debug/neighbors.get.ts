import { cosine } from '@/server/utils/embed'
import { assertDebug, cleanLang, loadStore, resolve, round4 } from '@/server/utils/debug'

// The closest words to a word, within the same language (cosine of mean-centered embeddings, as in the game).
export default defineEventHandler(async (event) => {
  assertDebug()
  const q = getQuery(event)
  const lang = cleanLang(q.lang)
  const typed = String(q.w ?? '')
  const k = Math.min(200, Number(q.k) || 50)
  const store = await loadStore(lang)
  const i = resolve(store, typed)
  if (i === undefined) return { word: typed.trim().toLowerCase(), lang, exists: false }

  const sims: [number, number][] = []
  for (let j = 0; j < store.vecs.length; j++) {
    if (j !== i) sims.push([j, cosine(store.vecs[i]!, store.vecs[j]!)])
  }
  sims.sort((a, b) => b[1] - a[1])
  return {
    word: store.words[i]!,
    lang,
    exists: true,
    total: store.words.length,
    neighbours: sims.slice(0, k).map(([j, sim]) => ({ w: store.words[j]!, sim: round4(sim) }))
  }
})
