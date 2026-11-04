import { fold, lower, tokenize, type Tok } from '@/server/utils/text'

const UA = { 'user-agent': 'unlimited-pedantle/1.0 (hobby word game)' }
const GATE_WORDS = 180 // stop adding sentences once the text reaches this many words

const apiUrl = (lang: string, host = 'wikipedia') => `https://${lang}.${host}.org/w/api.php`
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: UA })
    if (res.ok) return res.json()
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = Number(res.headers.get('retry-after')) || attempt + 1
      await new Promise(r => setTimeout(r, Math.min(wait, 5) * 1000))
      continue
    }
    throw createError({ statusCode: 502, statusMessage: `Wikipedia error ${res.status}` })
  }
}

// ---- random popular article ("matchmaking": only well-viewed articles) ----
const popularCache = new Map<string, string[]>()

async function popularTitles(lang: string): Promise<string[]> {
  if (popularCache.has(lang)) return popularCache.get(lang)!
  const d = new Date()
  for (let back = 1; back <= 4; back++) {
    const m = new Date(d.getFullYear(), d.getMonth() - back, 1)
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${m.getFullYear()}/${String(m.getMonth() + 1).padStart(2, '0')}/all-days`
    try {
      const j = await getJson(url)
      const titles = (j.items[0].articles as { article: string }[])
        .map(a => a.article)
        .filter(a => !a.includes(':') && !/^(Main_Page|Accueil|Liste?_|List_of|Wikipédia)/i.test(a))
        .slice(0, 700)
      if (titles.length > 50) {
        popularCache.set(lang, titles)
        return titles
      }
    } catch { /* try an older month */ }
  }
  throw createError({ statusCode: 502, statusMessage: 'Could not load popular articles' })
}

export async function randomTitle(lang: string): Promise<string> {
  const list = await popularTitles(lang)
  return list[Math.floor(Math.random() * list.length)]!.replace(/_/g, ' ')
}

// ---- article url parsing ----
export function parseArticleUrl(raw: string): { lang: string; title: string } {
  let u: URL
  try { u = new URL(raw.trim()) } catch { throw createError({ statusCode: 400, statusMessage: 'Invalid URL' }) }
  const m = u.hostname.match(/^([a-z-]+)(?:\.m)?\.wikipedia\.org$/)
  if (!m) throw createError({ statusCode: 400, statusMessage: 'Not a Wikipedia link' })
  const title = u.pathname.startsWith('/wiki/')
    ? decodeURIComponent(u.pathname.slice(6))
    : u.searchParams.get('title')
  if (!title) throw createError({ statusCode: 400, statusMessage: 'No article in this link' })
  return { lang: m[1]!, title: title.replace(/_/g, ' ') }
}

// ---- article text ----
export interface Article { title: string; url: string; tokens: Tok[]; titleLen: number }

export async function fetchArticle(lang: string, rawTitle: string): Promise<Article | null> {
  const q = new URLSearchParams({
    action: 'query', prop: 'extracts|pageprops', explaintext: '1', exsectionformat: 'plain',    redirects: '1', titles: rawTitle, format: 'json', formatversion: '2', ppprop: 'disambiguation'
  })
  const j = await getJson(`${apiUrl(lang)}?${q}`)
  const page = j.query?.pages?.[0]
  if (!page || page.missing || !page.extract || page.pageprops?.disambiguation !== undefined) return null

  const title = (page.title as string).replace(/\s*\(.*\)\s*$/, '')
  const body = pickText(page.extract as string)
  const titleToks = tokenize(title, lang)
  const bodyToks = tokenize(body, lang)
  if (bodyToks.filter(t => t.k === 'w').length < 60) return null
  return {
    title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((page.title as string).replace(/ /g, '_'))}`,
    tokens: [...titleToks, ...bodyToks],
    titleLen: titleToks.length
  }
}

function pickText(extract: string): string {
  const paragraphs = extract
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.split(/\s+/).length >= 8) // short lines are section headings
  const out: string[] = []
  let words = 0
  for (const para of paragraphs) {
    const sentences = para.split(/(?<=[.!?])\s+(?=[\p{Lu}«"“(])/u)
    const kept: string[] = []
    for (const s of sentences) {
      if (!/[.!?»”)]$/.test(s)) continue // truncated tail of the extract
      kept.push(s)
      words += s.split(/\s+/).length
      if (words >= GATE_WORDS) break
    }
    if (kept.length) out.push(kept.join(' '))
    if (words >= GATE_WORDS) break
  }
  return out.join('\n')
}

// ---- guess validation: dictionary spellings of a typed word, from Wiktionary / Wikipedia ----
/**
 * The word itself when it is a Wiktionary/Wikipedia page; otherwise the accented spellings Wiktionary knows
 * ("incarcerees" -> ["incarcérées"]). Empty when the word doesn't exist.
 */
export async function findSpellings(lang: string, word: string): Promise<string[]> {
  if (await wordExists(lang, word)) return [word]
  try {
    // Wiktionary's search ignores accents and returns the accented titles
    const q = new URLSearchParams({
      action: 'query', list: 'search', srsearch: word, srnamespace: '0', srlimit: '10', srprop: '', format: 'json', formatversion: '2'
    })
    const j = await getJson(`${apiUrl(lang, 'wiktionary')}?${q}`)
    const f = fold(word)
    const titles = (j.query?.search ?? []).map((s: { title: string }) => lower(s.title))
    return [...new Set<string>(titles)].filter(t => /^\p{L}+$/u.test(t) && fold(t) === f).slice(0, 3)
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Dictionary is busy, please retry in a moment' })
  }
}

async function wordExists(lang: string, word: string): Promise<boolean> {
  const cap = word.charAt(0).toUpperCase() + word.slice(1)
  const check = async (host: string, l: string, titles: string[]) => {
    const q = new URLSearchParams({ action: 'query', titles: titles.join('|'), redirects: '1', format: 'json', formatversion: '2' })
    const j = await getJson(`${apiUrl(l, host)}?${q}`)
    return (j.query.pages as any[]).some(p => !p.missing && !p.invalid)
  }
  try {
    const first = await Promise.all([check('wiktionary', lang, [word]), check('wikipedia', lang, [cap, word])])
    if (first.some(Boolean)) return true
    return lang !== 'en' && (await check('wikipedia', 'en', [cap]))
  } catch {
    // don't tell the player a real word is unknown just because Wikipedia is throttling us
    throw createError({ statusCode: 503, statusMessage: 'Dictionary is busy, please retry in a moment' })
  }
}
