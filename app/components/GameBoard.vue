<script setup lang="ts">
const {
  game, history, selected, ended, peeked, pending, revealed, nearest, last, won,
  guess, finish, reset, peek, peekAll
} = useGame()

const input = ref('')
const inputEl = ref<{ inputRef?: HTMLInputElement } | null>(null)

// not awaited: the guess loads in the background (loader in the guesses list) while the next word can already be typed
function submit() {
  const word = input.value
  if (!word.trim()) return
  input.value = ''
  guess(word)
  inputEl.value?.inputRef?.focus()
}

// the input takes the colour of the selected (last) guess: green when it uncovered words, else its heat colour
const inputStyle = computed(() => {
  const l = last.value
  const color = !l ? null : l.exact.length ? 'var(--ui-success)' : l.best >= HEAT_MIN ? heatColor(l.best) : null
  return color ? { '--tw-ring-color': color, backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)` } : undefined
})

const lastExact = computed(() => new Set(last.value?.exact.map(e => e.i)))
const lastNear = computed(() => new Map(last.value?.near.map(n => [n.i, n.sim])))

const titleToks = computed(() => game.value!.tokens.slice(0, game.value!.titleLen).map((t, i) => ({ t, i })))
const bodyBlocks = computed(() => {
  // group tokens into paragraphs
  const g = game.value!
  const paras: { t: ClientTok; i: number }[][] = [[]]
  g.tokens.forEach((t, i) => {
    if (i < g.titleLen) return
    if (t.k === 'br') paras.push([])
    else paras.at(-1)!.push({ t, i })
  })
  return paras.filter(p => p.length)
})

const recent = computed(() => history.value.map((h, i) => ({ h, i })).reverse())
const wordsFound = computed(() => Object.keys(revealed.value).length)
const total = computed(() => game.value!.tokens.filter(t => t.k !== 'p' && t.k !== 'br').length)

function playAgain() { reset() }

// links only exist once the game is over: the title links to the article, body words to the pages the article links to
const linkOf = (i: number) => {
  const l = ended.value?.links?.[i]
  return l ? `https://${game.value!.lang}.wikipedia.org/wiki/${l}` : null
}

// whitespace between two revealed words of the same link is underlined too, so the link reads as one
type Entry = { t: ClientTok; i: number }
const shown = (i: number) => !!(textOf(i) ?? (ended.value && (i < game.value!.titleLen || peeked.value[i]) ? ended.value.words[i] : null))
function bridge(para: Entry[], p: number, linkFor: (i: number) => string | null | undefined) {
  const a = para[p - 1], b = para[p + 1], sep = para[p]?.t
  if (!a || !b || !('n' in a.t) || !('n' in b.t) || sep?.k !== 'p' || sep.s.trim()) return null
  const l = linkFor(a.i)
  return l && l === linkFor(b.i) && shown(a.i) && shown(b.i) ? l : null
}

// the bridging space is greyed like the words around it when both were only revealed at the end (not guessed)
const bridgeMuted = (para: Entry[], p: number) => !textOf(para[p - 1]!.i) && !textOf(para[p + 1]!.i)

// ---- hidden debug mode: Ctrl+Alt+D (or ?debug in the URL) lets you click any rectangle / word to show or hide it ----
const debug = ref(false)
const debugWords = ref<(string | null)[] | null>(null)
const override = ref<Record<number, boolean>>({}) // true = force shown, false = force hidden

async function setDebug(on: boolean) {
  debug.value = on
  if (on && !debugWords.value) debugWords.value = (await $fetch<{ words: (string | null)[] }>(`/api/games/${game.value!.id}/reveal`)).words
}
const textOf = (i: number) => override.value[i] === true ? debugWords.value?.[i] ?? undefined : override.value[i] === false ? undefined : revealed.value[i]
const nearOf = (i: number) => override.value[i] === false ? undefined : nearest.value[i]
function onPeek(i: number) {
  if (!debug.value) return peek(i)
  const visible = override.value[i] ?? !!revealed.value[i]
  override.value = { ...override.value, [i]: !visible }
}

// hover popover: similarity of the word under the cursor with the 3 closest guesses
interface TipData { rows: { word: string; sim: number }[]; verbs: { lemma: string; forms: string[]; onPage: number }[] }
interface Tip { i: number; x: number; y: number; data: TipData | null; error?: string }
const tip = ref<Tip | null>(null)
const simCache = new Map<string, TipData>()

// end of game: the guesses matching the hovered word, closest first (none = no popover)
const endTip = ref<{ x: number; y: number; rows: { word: string; sim: number }[] } | null>(null)

function showMatches(i: number, box: DOMRect) {
  const rows: { word: string; sim: number }[] = []
  for (const h of history.value) {
    if (h.exact.some(e => e.i === i)) rows.push({ word: h.word, sim: 1 })
    else {
      const n = h.near.find(n => n.i === i)
      if (n) rows.push({ word: h.word, sim: n.sim })
    }
  }
  rows.sort((a, b) => b.sim - a.sim)
  endTip.value = rows.length ? { x: Math.max(8, box.left), y: box.bottom + 6, rows } : null
}

function onLeave() { tip.value = null; endTip.value = null }

async function onHover(i: number, ev: MouseEvent) {
  const box = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  if (!debug.value) return ended.value ? showMatches(i, box) : undefined
  const key = `${i}|${history.value.length}`
  tip.value = { i, x: Math.max(8, box.left), y: box.bottom + 6, data: simCache.get(key) ?? null }
  if (simCache.has(key)) return
  try {
    const data = await $fetch<TipData>(`/api/games/${game.value!.id}/debug-sim`, {
      method: 'POST', body: { i, words: history.value.map(h => h.word) }
    })
    simCache.set(key, data)
    if (tip.value?.i === i) tip.value.data = data
  } catch (e: any) {
    // 404 = the server has no NUXT_DEBUG_ENABLED=true (the debug API is dev-only by default)
    if (tip.value?.i === i) tip.value.error = `${e?.statusCode ?? ''} ${e?.statusMessage ?? e?.message ?? 'request failed'}`.trim()
  }
}

// select the guess that uncovered the word at position i, or else the one behind its hint
function selectGuessAt(i: number) {
  const exact = history.value.findIndex(h => h.exact.some(e => e.i === i))
  if (exact >= 0) return void (selected.value = exact)
  const near = nearest.value[i]
  if (near) selected.value = history.value.findIndex(h => h.word === near.word && h.near.some(n => n.i === i && n.sim === near.sim))
}

function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') return setDebug(!debug.value)
  // typing while something else is focused (e.g. after clicking a word) goes back to the input
  const el = document.activeElement as HTMLElement | null
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  if (!ended.value && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) inputEl.value?.inputRef?.focus()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  if (new URLSearchParams(location.search).has('debug')) setDebug(true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="max-w-6xl mx-auto p-3 sm:p-6 space-y-4">
    <header class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h1 class="text-xl font-bold">Unlimited Pedantle</h1>
        <UColorModeButton />
      </div>
      <div class="flex items-center gap-2">
        <UBadge v-if="debug" color="warning" variant="solid">DEBUG</UBadge>
        <UButton v-if="!ended" size="sm" color="neutral" variant="ghost" icon="i-lucide-flag" @click="finish(false)">Give up</UButton>
        <UButton v-else size="sm" color="primary" icon="i-lucide-rotate-ccw" @click="playAgain">Play again</UButton>
      </div>
    </header>

    <div
      v-if="debug && tip"
      class="fixed z-50 pointer-events-none rounded-lg border border-default bg-default shadow-lg p-2.5 text-sm min-w-44"
      :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
    >
      <div class="font-semibold mb-1">{{ debugWords?.[tip.i] ?? '…' }}</div>
      <div v-if="tip.error" class="text-error">Debug API error: {{ tip.error }}</div>
      <div v-else-if="!tip.data" class="text-muted">…</div>
      <template v-else>
        <div v-if="!tip.data.rows.length" class="text-muted">No similarity (stopword, number or no guess yet)</div>
        <ul v-else class="space-y-0.5">
          <li v-for="r in tip.data.rows" :key="r.word" class="flex items-center gap-2">
            <span class="size-2.5 rounded-full shrink-0" :style="{ background: r.sim >= HEAT_MIN ? heatColor(r.sim) : 'var(--ui-border-accented)' }" />
            <span class="flex-1">{{ r.word }}</span>
            <span class="tabular-nums" :class="r.sim >= HEAT_MIN ? 'font-semibold' : 'text-muted'">{{ r.sim.toFixed(3) }}</span>
          </li>
        </ul>
        <div v-for="v in tip.data.verbs" :key="v.lemma" class="mt-2 pt-2 border-t border-default max-w-xs">
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-spell-check" class="size-3.5 text-primary" />
            <span class="font-medium">{{ v.lemma }}</span>
            <span class="text-xs text-muted">· {{ v.onPage }} on this page</span>
          </div>
          <div class="text-xs text-muted mt-0.5 whitespace-normal">{{ v.forms.slice(0, 14).join(', ') }}{{ v.forms.length > 14 ? `… (${v.forms.length})` : '' }}</div>
        </div>
      </template>
    </div>

    <div
      v-if="!debug && endTip"
      class="fixed z-50 pointer-events-none rounded-lg border border-default bg-default shadow-lg p-2.5 text-sm min-w-44"
      :style="{ left: endTip.x + 'px', top: endTip.y + 'px' }"
    >
      <ul class="space-y-0.5">
        <li v-for="r in endTip.rows" :key="r.word" class="flex items-center gap-2">
          <span class="size-2.5 rounded-full shrink-0" :style="{ background: r.sim >= 1 ? 'var(--ui-success)' : r.sim >= HEAT_MIN ? heatColor(r.sim) : 'var(--ui-border-accented)' }" />
          <span class="flex-1">{{ r.word }}</span>
          <span class="tabular-nums text-muted">{{ Math.round(r.sim * 100) }}%</span>
        </li>
      </ul>
    </div>

    <div
      v-if="ended?.won"
      class="flex items-center justify-between gap-3 rounded-lg px-4 py-3 ring ring-inset bg-success/10 text-success ring-success/25"
    >
      <div class="flex items-center gap-3 min-w-0">
        <UIcon name="i-lucide-trophy" class="size-6 shrink-0" />
        <span class="font-semibold text-lg truncate">You found it: {{ ended.title }}!</span>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-[1fr_17rem] items-start">
      <section class="space-y-4 min-w-0">
        <form v-if="!ended" class="sticky top-2 z-10 flex gap-2 bg-default/90 backdrop-blur rounded-lg p-1" @submit.prevent="submit">
          <UInput
            ref="inputEl" v-model="input" size="xl" class="flex-1" autofocus autocomplete="off" autocapitalize="off"
            spellcheck="false" :placeholder="last ? (last.typed ?? last.word) : 'Type a word…'" :style="inputStyle"
          />
        </form>

        <UCard>
          <UBadge color="neutral" variant="subtle" size="sm" class="mb-3">{{ wordsFound }}/{{ total }} words · {{ history.length }} guesses</UBadge>
          <div class="flex items-start justify-between gap-3 mb-5">
          <h2 class="text-3xl font-bold leading-snug">
            <template v-for="({ t, i }, ti) in titleToks" :key="i">
              <GameWord v-if="'n' in t" :n="t.n" :text="textOf(i)" :near="nearOf(i)" :is-last-exact="lastExact.has(i)"
                :last-sim="lastNear.get(i)" :full="ended ? ended.words[i] : null" :clickable="!!ended" :debug="debug" :small="t.k === 'u'"
                :href="ended?.url" @peek="onPeek(i)" @select="selectGuessAt(i)" @hover="onHover(i, $event)" @leave="onLeave" />
              <a
                v-else-if="bridge(titleToks, ti, () => ended?.url)" :href="ended?.url" target="_blank" rel="noopener"
                class="underline underline-offset-4 hover:text-primary" :class="{ 'text-muted': bridgeMuted(titleToks, ti) }"
              >{{ t.s }}</a>
              <template v-else>{{ t.s }}</template>
            </template>
          </h2>
          <UButton v-if="ended" size="sm" color="neutral" variant="subtle" class="shrink-0" @click="peekAll">Reveal all</UButton>
          </div>

          <p v-for="(para, pi) in bodyBlocks" :key="pi" class="leading-9 mb-3 text-lg">
            <template v-for="({ t, i }, pi2) in para" :key="i">
              <GameWord v-if="'n' in t" :n="t.n" :text="textOf(i)" :near="nearOf(i)" :is-last-exact="lastExact.has(i)"
                :last-sim="lastNear.get(i)" :full="ended && peeked[i] ? ended.words[i] : null" :clickable="!!ended" :debug="debug" :small="t.k === 'u'"
                :href="linkOf(i)" @peek="onPeek(i)" @select="selectGuessAt(i)" @hover="onHover(i, $event)" @leave="onLeave" />
              <a
                v-else-if="bridge(para, pi2, linkOf)" :href="bridge(para, pi2, linkOf)!" target="_blank" rel="noopener"
                class="underline underline-offset-4 hover:text-primary" :class="{ 'text-muted': bridgeMuted(para, pi2) }"
              >{{ t.s }}</a>
              <template v-else>{{ t.s }}</template>
            </template>
          </p>
        </UCard>
      </section>

      <aside class="lg:sticky lg:top-4">
        <UCard :ui="{ header: 'px-3 py-2 sm:px-3', body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2">
              <span class="font-semibold">Guesses</span>
              <UBadge color="neutral" variant="subtle" size="sm">{{ history.length }}</UBadge>
            </div>
          </template>
          <ul class="max-h-[60vh] overflow-y-auto divide-y divide-default">
            <li v-if="!recent.length && !pending.length" class="p-4 text-sm text-muted">Nothing yet. Start with common words!</li>
            <li v-for="p in [...pending].reverse()" :key="'p' + p.id" class="flex items-center gap-2 px-3 py-2 text-muted">
              <span class="flex-1 truncate font-medium">{{ p.word }}</span>
              <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
            </li>
            <li v-for="{ h, i } in recent" :key="i">
              <button
                type="button" class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-elevated"
                :class="{ 'bg-elevated': i === selected }" @click="selected = i"
              >
                <span class="flex-1 truncate font-medium">{{ h.word }}</span>
                <UBadge v-if="h.exact.length" color="success" variant="subtle" size="sm">×{{ h.exact.length }}</UBadge>
                <span
                  v-else class="size-3 rounded-full shrink-0" :title="`closest: ${Math.round(h.best * 100)}%`"
                  :style="{ background: h.best >= HEAT_MIN ? heatColor(h.best) : 'var(--ui-border-accented)' }"
                />
              </button>
            </li>
          </ul>
        </UCard>
      </aside>
    </div>
  </div>
</template>
