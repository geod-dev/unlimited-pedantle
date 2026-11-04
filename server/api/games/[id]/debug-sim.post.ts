import { loadGame } from '@/server/utils/game'
import { center, cosine, getCachedEmbeddings } from '@/server/utils/embed'
import { assertDebug, round4 } from '@/server/utils/debug'
import { lower } from '@/server/utils/text'

// Debug only: similarity between the word at a position and the 3 closest guesses (for the hover popover).
export default defineEventHandler(async (event) => {
  assertDebug()
  const game = await loadGame(getRouterParam(event, 'id')!)
  const { i, words } = await readBody<{ i: number; words: string[] }>(event)
  const tok = game.tokens[i]
  if (!tok || tok.k !== 'w') return []

  const lw = lower(tok.s)
  const target = game.vectors.get(lw) // already centered; stopwords are never embedded
  if (!target) return []

  // history labels can hold several spellings ("péché/pêche")
  const forms = [...new Set((words ?? []).flatMap(w => w.split('/')).map(lower))]
  const vectors = await getCachedEmbeddings(forms, game.lang)
  return forms
    .filter(w => w !== lw && vectors.has(w))
    .map(w => ({ word: w, sim: round4(cosine(target, center(vectors.get(w)!, game.mean))) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3)
})
