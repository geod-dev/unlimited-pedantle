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

// ---- random article from Wikipedia's "Vital articles" lists (level 2: ~100 topics ... level 5: ~50k) ----
export const LEVELS = [2, 3, 4, 5] as const
export type Level = typeof LEVELS[number]
const VITAL_SKIP = /Article alerts|Archive|Draft|Removed|Candidates|Nav bar/i
const vitalCache = new Map<Level, string[]>()

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

async function vitalTitles(level: Level): Promise<string[]> {
  const cached = vitalCache.get(level)
  if (cached) return cached
  const prefix = `Vital articles/Level ${level}`
  const pages: string[] = []
  for (let cont: string | undefined; ;) {
    const listing = await getJson(`${apiUrl('en')}?${new URLSearchParams({
      action: 'query', list: 'allpages', apnamespace: '4', apprefix: prefix, aplimit: '500', format: 'json', formatversion: '2',
      ...(cont ? { apcontinue: cont } : {})
    })}`)
    for (const p of listing.query.allpages as { title: string }[]) if (!VITAL_SKIP.test(p.title)) pages.push(p.title)
    cont = listing.continue?.apcontinue
    if (!cont) break
  }
  const titles = new Set<string>()
  for (let i = 0; i < pages.length; i += 50) {
    const j = await getJson(`${apiUrl('en')}?${new URLSearchParams({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: pages.slice(i, i + 50).join('|'), format: 'json', formatversion: '2'
    })}`)
    for (const p of j.query.pages) for (const t of parseVital(p.revisions?.[0]?.slots?.main?.content ?? '')) titles.add(t)
  }
  if (titles.size < 50) throw createError({ statusCode: 502, statusMessage: 'Could not load vital articles' })
  const list = [...titles]
  vitalCache.set(level, list)
  return list
}

// the list is English: resolve the article's title in the target language (null when it has no such edition)
async function localTitle(lang: string, enTitle: string): Promise<string | null> {
  const j = await getJson(`${apiUrl('en')}?${new URLSearchParams({
    action: 'query', prop: 'langlinks', lllang: lang, titles: enTitle, redirects: '1', format: 'json', formatversion: '2'
  })}`)
  return j.query?.pages?.[0]?.langlinks?.[0]?.title ?? null
}

export async function randomTitle(lang: string, level: Level = 3): Promise<string> {
  const list = await vitalTitles(level)
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
  await markLinks(lang, page.title as string, bodyToks)
  return {
    title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((page.title as string).replace(/ /g, '_'))}`,
    tokens: [...titleToks, ...bodyToks],
    titleLen: titleToks.length
  }
}

// ---- links: the plain-text extract has none, so read them from the rendered page and align them with the words ----
type LinkableTok = Extract<Tok, { k: 'w' | 'n' | 'r' }>
const linkable = (t: Tok): t is LinkableTok => t.k === 'w' || t.k === 'n' || t.k === 'r'
const LINK_WINDOW = 40 // a real link shows up soon after the previous one; anything further is a false match

function pageLinks(html: string): { text: string; href: string }[] {
  const body = html.replace(/<(table|style|sup)\b[\s\S]*?<\/\1>/gi, '') // infoboxes, references
  const out: { text: string; href: string }[] = []
  for (const p of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    for (const a of p[1]!.matchAll(/<a\b[^>]*href="\/wiki\/([^"#?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (/:|%3A/i.test(a[1]!)) continue // File:, Category:...
      const text = a[2]!.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      out.push({ text, href: a[1]! })
    }
  }
  return out
}

async function markLinks(lang: string, pageTitle: string, toks: Tok[]) {
  try {
    const j = await getJson(`${apiUrl(lang)}?${new URLSearchParams({
      action: 'parse', page: pageTitle, prop: 'text', redirects: '1', disableeditsection: '1', disablelimitreport: '1', format: 'json', formatversion: '2'
    })}`)
    const idx = toks.flatMap((t, i) => (linkable(t) ? [i] : []))
    let cur = 0
    for (const { text, href } of pageLinks(j.parse.text as string)) {
      const seq = tokenize(text, lang).filter(linkable).map(t => t.s)
      if (!seq.length) continue
      for (let s = cur; s < Math.min(idx.length, cur + LINK_WINDOW); s++) {
        if (!seq.every((w, k) => (toks[idx[s + k]!] as LinkableTok | undefined)?.s === w)) continue
        for (let k = 0; k < seq.length; k++) (toks[idx[s + k]!] as LinkableTok).l = href
        cur = s + seq.length
        break
      }
    }
  } catch { /* links are a bonus: play without them */ }
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
