import { loadGame } from '@/server/utils/game'
import { center, cosine, getCachedEmbeddings } from '@/server/utils/embed'
import { round4 } from '@/server/utils/debug'
import { isVerb, verbForms, verbLemmas } from '@/server/utils/lemma'
import { lower } from '@/server/utils/text'

// For the debug hover popover (no assertDebug: it only reads cached vectors, never spends credits, and /reveal is already open)
// Hover popover on a word of the page: the verbs it is a form of (what a guess would uncover
// together), and its similarity with the 3 closest guesses.
export default defineEventHandler(async (event) => {
  const game = await loadGame(getRouterParam(event, 'id')!)
  const { i, words } = await readBody<{ i: number; words: string[] }>(event)
  const tok = game.tokens[i]
  if (!tok || tok.k !== 'w') return { rows: [], verbs: [] }

  const lw = lower(tok.s)
  const verbs = []
  for (const lemma of await verbLemmas(game.lang, lw)) {
    if (!(await isVerb(game.lang, lemma))) continue
    verbs.push({ lemma, forms: await verbForms(game.lang, lemma), onPage: (game.lemmaIndex.get(lemma) ?? []).length })
  }

  const target = game.vectors.get(lw) // already centered; stopwords are never embedded
  if (!target) return { rows: [], verbs }

  // history labels can hold several spellings ("péché/pêche")
  const forms = [...new Set((words ?? []).flatMap(w => w.split('/')).map(lower))]
  const vectors = await getCachedEmbeddings(forms, game.lang)
  const rows = forms
    .filter(w => w !== lw && vectors.has(w))
    .map(w => ({ word: w, sim: round4(cosine(target, center(vectors.get(w)!, game.mean))) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3)
  return { rows, verbs }
})
