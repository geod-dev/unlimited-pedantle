import { randomUUID } from 'node:crypto'
import { fetchArticle, parseArticleUrl, randomTitle } from '@/server/utils/wiki'
import { cacheGame, hydrate, saveGame } from '@/server/utils/game'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ lang?: string; url?: string }>(event)

  let article = null
  let lang: string
  if (body?.url?.trim()) {
    const parsed = parseArticleUrl(body.url)
    lang = parsed.lang
    article = await fetchArticle(lang, parsed.title)
    if (!article) throw createError({ statusCode: 422, statusMessage: 'This article is too short or not usable. Try another one.' })
  } else {
    lang = body?.lang === 'en' ? 'en' : 'fr'
    for (let i = 0; i < 8 && !article; i++) article = await fetchArticle(lang, await randomTitle(lang))
    if (!article) throw createError({ statusCode: 502, statusMessage: 'Could not find an article, please retry.' })
  }

  const stored = { id: randomUUID().slice(0, 8), lang, title: article.title, url: article.url, titleLen: article.titleLen, tokens: article.tokens }
  const game = await hydrate(stored) // embeds every page word (cached in DB)
  await saveGame(stored)
  cacheGame(game)

  // The client never sees the words, only their lengths. Title words must be found to win
  // (stopwords and ordinal suffixes excepted).
  const tokens = article.tokens.map((t, i) => {
    if (t.k === 'p' || t.k === 'br') return t
    const req = i < article.titleLen && (t.k === 'n' || t.k === 'r' || (t.k === 'w' && !t.sw)) ? true : undefined
    return { k: t.k, n: [...t.s].length, req }
  })
  return { id: stored.id, lang, titleLen: article.titleLen, tokens, url: article.url }
})
