<script setup lang="ts">
const {
  game, history, selected, ended, peeked, busy, revealed, nearest, last, won,
  guess, finish, reset, peek, peekAll
} = useGame()

const input = ref('')
const inputEl = ref<{ inputRef?: HTMLInputElement } | null>(null)

async function submit() {
  if (await guess(input.value)) input.value = ''
  await nextTick()
  inputEl.value?.inputRef?.focus()
}

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
interface Tip { i: number; x: number; y: number; rows: { word: string; sim: number }[] | null }
const tip = ref<Tip | null>(null)
const simCache = new Map<string, { word: string; sim: number }[]>()

async function onHover(i: number, ev: MouseEvent) {
  const box = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  const key = `${i}|${history.value.length}`
  tip.value = { i, x: Math.max(8, box.left), y: box.bottom + 6, rows: simCache.get(key) ?? null }
  if (simCache.has(key)) return
  const rows = await $fetch<{ word: string; sim: number }[]>(`/api/games/${game.value!.id}/debug-sim`, {
    method: 'POST', body: { i, words: history.value.map(h => h.word) }
  })
  simCache.set(key, rows)
  if (tip.value?.i === i) tip.value.rows = rows
}

function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') setDebug(!debug.value)
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
      <h1 class="text-xl font-bold">Unlimited Pedantle</h1>
      <div class="flex items-center gap-2">
        <UBadge v-if="debug" color="warning" variant="solid">DEBUG</UBadge>
        <UBadge color="neutral" variant="subtle">{{ wordsFound }}/{{ total }} words · {{ history.length }} guesses</UBadge>
        <UButton v-if="!ended" size="sm" color="neutral" variant="ghost" icon="i-lucide-flag" @click="finish(false)">Give up</UButton>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-rotate-ccw" @click="playAgain">New game</UButton>
        <UColorModeButton />
      </div>
    </header>

    <div
      v-if="debug && tip"
      class="fixed z-50 pointer-events-none rounded-lg border border-default bg-default shadow-lg p-2.5 text-sm min-w-44"
      :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
    >
      <div class="font-semibold mb-1">{{ debugWords?.[tip.i] ?? '…' }}</div>
      <div v-if="!tip.rows" class="text-muted">…</div>
      <div v-else-if="!tip.rows.length" class="text-muted">No similarity (stopword, number or no guess yet)</div>
      <ul v-else class="space-y-0.5">
        <li v-for="r in tip.rows" :key="r.word" class="flex items-center gap-2">
          <span class="size-2.5 rounded-full shrink-0" :style="{ background: r.sim >= HEAT_MIN ? heatColor(r.sim) : 'var(--ui-border-accented)' }" />
          <span class="flex-1">{{ r.word }}</span>
          <span class="tabular-nums" :class="r.sim >= HEAT_MIN ? 'font-semibold' : 'text-muted'">{{ r.sim.toFixed(3) }}</span>
        </li>
      </ul>
    </div>

    <UAlert
      v-if="ended"
      :color="ended.won ? 'success' : 'warning'"
      variant="subtle"
      :icon="ended.won ? 'i-lucide-trophy' : 'i-lucide-flag'"
      :title="ended.won ? `You found it: ${ended.title}!` : `The article was: ${ended.title}`"
      :description="`Solved in ${history.length} guesses. Click a rectangle to reveal a word.`"
      :actions="[
        { label: 'Reveal all', color: 'neutral', variant: 'outline', onClick: peekAll },
        { label: 'Open article', color: 'neutral', variant: 'outline', to: ended.url, target: '_blank' },
        { label: 'Play again', color: 'primary', onClick: playAgain }
      ]"
    />

    <div class="grid gap-4 lg:grid-cols-[1fr_17rem] items-start">
      <section class="space-y-4 min-w-0">
        <form v-if="!ended" class="sticky top-2 z-10 flex gap-2 bg-default/90 backdrop-blur rounded-lg p-1" @submit.prevent="submit">
          <UInput
            ref="inputEl" v-model="input" size="xl" class="flex-1" autofocus autocomplete="off" autocapitalize="off"
            spellcheck="false" placeholder="Type a word…" icon="i-lucide-pencil" :disabled="busy"
          />
          <UButton type="submit" size="xl" :loading="busy" :disabled="!input.trim()">Guess</UButton>
        </form>

        <UCard>
          <h2 class="text-3xl font-bold leading-snug mb-5">
            <template v-for="{ t, i } in titleToks" :key="i">
              <GameWord v-if="'n' in t" :n="t.n" :text="textOf(i)" :near="nearOf(i)" :is-last-exact="lastExact.has(i)"
                :last-sim="lastNear.get(i)" :full="ended && peeked[i] ? ended.words[i] : null" :clickable="!!ended" :debug="debug" :small="t.k === 'u'"
                @peek="onPeek(i)" @hover="onHover(i, $event)" @leave="tip = null" />
              <template v-else>{{ t.s }}</template>
            </template>
          </h2>

          <p v-for="(para, pi) in bodyBlocks" :key="pi" class="leading-9 mb-3 text-lg">
            <template v-for="{ t, i } in para" :key="i">
              <GameWord v-if="'n' in t" :n="t.n" :text="textOf(i)" :near="nearOf(i)" :is-last-exact="lastExact.has(i)"
                :last-sim="lastNear.get(i)" :full="ended && peeked[i] ? ended.words[i] : null" :clickable="!!ended" :debug="debug" :small="t.k === 'u'"
                @peek="onPeek(i)" @hover="onHover(i, $event)" @leave="tip = null" />
              <template v-else>{{ t.s }}</template>
            </template>
          </p>
        </UCard>
      </section>

      <aside class="lg:sticky lg:top-4">
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header><span class="font-semibold">Guesses</span></template>
          <ul class="max-h-[60vh] overflow-y-auto divide-y divide-default">
            <li v-if="!recent.length" class="p-4 text-sm text-muted">Nothing yet. Start with common words!</li>
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
