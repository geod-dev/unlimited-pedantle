// w = word, n = digits, r = roman numeral, u = ordinal suffix (small rectangle)
export type ClientTok =
  | { k: 'w' | 'n' | 'r' | 'u'; n: number; req?: boolean }
  | { k: 'p'; s: string }
  | { k: 'br' }

export interface GameInfo {
  id: string
  lang: string
  titleLen: number
  tokens: ClientTok[]
  url: string
}

export interface GuessEntry {
  typed?: string // what the player typed
  word: string // dictionary word(s) it matched, "/"-separated when several accent variants matched
  exact: { i: number; s: string }[]
  near: { i: number; sim: number }[]
  best: number
}

export interface Ended { title: string; url: string; words: (string | null)[]; won: boolean }

// Similarity range mapped onto the yellow -> red heat scale.
export const HEAT_MIN = 0.26
export const HEAT_MAX = 0.5 // at or above this similarity the server reveals the word

const STORAGE_KEY = 'pedantle:game:v2' // bumped when the database was reset: old game ids no longer exist

export function useGame() {
  const game = useState<GameInfo | null>('game', () => null)
  const history = useState<GuessEntry[]>('history', () => [])
  const selected = useState<number>('selected', () => -1) // history index shown as "last guess"
  const ended = useState<Ended | null>('ended', () => null)
  const peeked = useState<Record<number, boolean>>('peeked', () => ({}))
  const busy = ref(false)
  const toast = useToast()

  const revealed = computed(() => {
    const m: Record<number, string> = {}
    for (const h of history.value) for (const e of h.exact) m[e.i] = e.s
    return m
  })

  /** best (most similar) guess per hidden position */
  const nearest = computed(() => {
    const m: Record<number, { word: string; sim: number }> = {}
    for (const h of history.value)
      for (const n of h.near) if (!m[n.i] || n.sim > m[n.i]!.sim) m[n.i] = { word: h.word, sim: n.sim }
    return m
  })

  const last = computed(() => history.value[selected.value] ?? null)

  const won = computed(() => {
    const g = game.value
    if (!g) return false
    const titleWords = g.tokens.slice(0, g.titleLen).map((t, i) => [t, i] as const).filter(([t]) => t.k === 'w' || t.k === 'n' || t.k === 'r')
    const required = titleWords.filter(([t]) => (t as { req?: boolean }).req)
    const need = required.length ? required : titleWords
    return need.length > 0 && need.every(([, i]) => i in revealed.value)
  })

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        game: game.value, history: history.value, selected: selected.value, ended: ended.value
      }))
    } catch { /* storage unavailable */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      game.value = s.game; history.value = s.history ?? []; selected.value = s.selected ?? -1; ended.value = s.ended ?? null
    } catch { /* ignore corrupted state */ }
  }

  async function start(opts: { lang?: string; url?: string }) {
    busy.value = true
    try {
      const g = await $fetch<GameInfo>('/api/games', { method: 'POST', body: opts })
      game.value = g; history.value = []; selected.value = -1; ended.value = null; peeked.value = {}
      persist()
    } catch (e: any) {
      toast.add({ title: 'Could not start a game', description: e?.data?.statusMessage ?? e?.statusMessage ?? 'Please retry.', color: 'error' })
    } finally {
      busy.value = false
    }
  }

  async function guess(raw: string): Promise<boolean> {
    const g = game.value
    if (!g || busy.value) return false
    const word = raw.normalize('NFC').trim().toLowerCase()
    if (!word) return false
    const again = history.value.findIndex(h => (h.typed ?? h.word) === word || h.word.split('/').includes(word))
    if (again >= 0) {
      selected.value = again
      toast.add({ title: 'Already guessed', description: `“${word}” is highlighted again.`, color: 'neutral' })
      return true
    }
    busy.value = true
    try {
      const r = await $fetch<any>(`/api/games/${g.id}/guess`, { method: 'POST', body: { word } })
      if (!r.valid) {
        toast.add({ title: r.reason, description: `“${word}”`, color: 'warning' })
        return false
      }
      history.value.push({ typed: r.typed, word: r.word, exact: r.exact, near: r.near, best: r.best })
      selected.value = history.value.length - 1
      if (won.value && !ended.value) await finish(true)
      persist()
      return true
    } catch (e: any) {
      toast.add({ title: 'Something went wrong', description: e?.data?.statusMessage ?? 'Please retry.', color: 'error' })
      return false
    } finally {
      busy.value = false
    }
  }

  async function finish(isWin: boolean) {
    const g = game.value
    if (!g) return
    const r = await $fetch<{ title: string; url: string; words: (string | null)[] }>(`/api/games/${g.id}/reveal`)
    ended.value = { ...r, won: isWin }
    persist()
  }

  function reset() {
    game.value = null; history.value = []; selected.value = -1; ended.value = null; peeked.value = {}
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }

  function peek(i: number) { peeked.value = { ...peeked.value, [i]: true } }
  function peekAll() {
    const all: Record<number, boolean> = {}
    game.value?.tokens.forEach((t, i) => { if (t.k !== 'p' && t.k !== 'br') all[i] = true })
    peeked.value = all
  }

  return { game, history, selected, ended, peeked, busy, revealed, nearest, last, won, start, guess, finish, reset, restore, peek, peekAll, persist }
}

export function heatColor(sim: number): string {
  const t = Math.min(1, Math.max(0, (sim - HEAT_MIN) / (HEAT_MAX - HEAT_MIN)))
  return `hsl(${Math.round(55 - 55 * t)} 92% 52%)`
}
