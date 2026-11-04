import { useDb } from '@/server/utils/db'
import { assertDebug } from '@/server/utils/debug'
import { fold, lower } from '@/server/utils/text'

// Every computed word, in every language. Search ignores accents ("ete" finds "été"); words keep their accents.
export default defineEventHandler(async (event) => {
  assertDebug()
  const q = getQuery(event)
  const typed = lower(String(q.q ?? '').trim())
  const folded = fold(typed)
  const limit = Math.min(500, Number(q.limit) || 200)
  const offset = Math.max(0, Number(q.offset) || 0)
  const esc = (s: string) => s.replace(/[\\%_]/g, '\\$&')
  const contains = `%${esc(folded)}%`
  const prefix = `${esc(folded)}%`
  const db = await useDb()

  const [rows, count, have, langs] = await Promise.all([
    db.execute({
      // prefix matches first, then alphabetical
      sql: `SELECT w, lang FROM embeddings WHERE f LIKE ? ESCAPE '\\' ORDER BY (f LIKE ? ESCAPE '\\') DESC, w, lang LIMIT ? OFFSET ?`,
      args: [contains, prefix, limit, offset]
    }),
    db.execute({ sql: `SELECT COUNT(*) AS c FROM embeddings WHERE f LIKE ? ESCAPE '\\'`, args: [contains] }),
    typed ? db.execute({ sql: 'SELECT lang FROM embeddings WHERE w = ?', args: [typed] }) : Promise.resolve(null),
    db.execute('SELECT lang, COUNT(*) AS c FROM embeddings GROUP BY lang ORDER BY c DESC')
  ])
  return {
    words: rows.rows.map(r => ({ w: r.w as string, lang: r.lang as string })),
    total: Number(count.rows[0]!.c),
    typed,
    /** languages in which this exact spelling is already computed */
    have: have ? have.rows.map(r => r.lang as string) : [],
    langs: langs.rows.map(r => ({ lang: r.lang as string, count: Number(r.c) }))
  }
})
