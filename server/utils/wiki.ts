import { tokenize, type Tok } from '@/server/utils/text'

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

// ---- random article from Wikipedia's "Vital articles" level 4 (~10k general-knowledge topics) ----
const VITAL_PREFIX = 'Vital articles/Level 4/'
const VITAL_SKIP = /Article alerts|Archive|Draft|Removed|Candidates/i
let vitalCache: string[] | null = null

// Article links sit on numbered list lines: `# {{Icon|B}} '''[[Title|label]]''' ([[Wikipedia:Vital articles/Level 3|Level 3]])`
function parseVital(wikitext: string): string[] {
  const out: string[] = []
  for (const line of wikitext.split('\n')) {
    if (!/^[#*]/.test(line)) continue
    const m = line.replace(/\{\{[^}]*\}\}/g, '').match(/\[\[([^\]|#]+)/)
    if (m && !/^(Wikipedia|File|Category|Template):/i.test(m[1]!)) out.push(m[1]!.trim())
  }
  return out
}

async function vitalTitles(): Promise<string[]> {
  if (vitalCache) return vitalCache
  const listing = await getJson(`${apiUrl('en')}?${new URLSearchParams({
    action: 'query', list: 'allpages', apnamespace: '4', apprefix: VITAL_PREFIX, aplimit: '200', format: 'json', formatversion: '2'
  })}`)
  const pages = (listing.query.allpages as { title: string }[]).map(p => p.title).filter(t => !VITAL_SKIP.test(t))
  const titles = new Set<string>()
  for (let i = 0; i < pages.length; i += 50) {
    const j = await getJson(`${apiUrl('en')}?${new URLSearchParams({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: pages.slice(i, i + 50).join('|'), format: 'json', formatversion: '2'
    })}`)
    for (const p of j.query.pages) for (const t of parseVital(p.revisions?.[0]?.slots?.main?.content ?? '')) titles.add(t)
  }
  if (titles.size < 1000) throw createError({ statusCode: 502, statusMessage: 'Could not load vital articles' })
  return (vitalCache = [...titles])
}

// the list is English: resolve the article's title in the target language (null when it has no such edition)
async function localTitle(lang: string, enTitle: string): Promise<string | null> {
  const j = await getJson(`${apiUrl('en')}?${new URLSearchParams({
    action: 'query', prop: 'langlinks', lllang: lang, titles: enTitle, redirects: '1', format: 'json', formatversion: '2'
  })}`)
  return j.query?.pages?.[0]?.langlinks?.[0]?.title ?? null
}

export async function randomTitle(lang: string): Promise<string> {
  const list = await vitalTitles()
  for (let i = 0; i < 5; i++) {
    const title = list[Math.floor(Math.random() * list.length)]!
    if (lang === 'en') return title
    const local = await localTitle(lang, title)
    if (local) return local
  }
  throw createError({ statusCode: 502, statusMessage: 'Could not find an article, please retry.' })
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
