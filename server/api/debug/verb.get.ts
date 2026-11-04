import { assertDebug, cleanLang } from '@/server/utils/debug'
import { isVerb, verbForms, verbLemmas } from '@/server/utils/lemma'
import { lower } from '@/server/utils/text'

// Which verbs a word may be a form of, and every form of each verb (what a guess would uncover on a page).
export default defineEventHandler(async (event) => {
  assertDebug()
  const q = getQuery(event)
  const lang = cleanLang(q.lang)
  const word = lower(String(q.w ?? '').trim())
  const lemmas = word ? await verbLemmas(lang, word, true) : []
  const verbs = await Promise.all(lemmas.map(async lemma => ({
    lemma,
    verb: await isVerb(lang, lemma),
    forms: await verbForms(lang, lemma)
  })))
  return { word, lang, lemmas: verbs.filter(v => v.verb) }
})
