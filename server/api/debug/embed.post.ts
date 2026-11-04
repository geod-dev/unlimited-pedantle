import { getCachedEmbeddings, getEmbeddings } from '@/server/utils/embed'
import { assertDebug, cleanLang } from '@/server/utils/debug'
import { lower } from '@/server/utils/text'

// Embed a word (exact spelling, accents kept) in a language (one paid API call unless already embedded elsewhere).
export default defineEventHandler(async (event) => {
  assertDebug()
  const body = await readBody<{ word?: string; lang?: string }>(event)
  const w = lower((body?.word ?? '').trim())
  if (!/^\p{L}+$/u.test(w)) throw createError({ statusCode: 400, statusMessage: 'Enter a single word (letters only)' })
  const lang = cleanLang(body?.lang)
  const existed = (await getCachedEmbeddings([w], lang)).has(w)
  if (!existed) await getEmbeddings([w], lang)
  return { word: w, lang, created: !existed }
})
