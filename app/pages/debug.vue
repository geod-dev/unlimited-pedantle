<script setup lang="ts">
// Embedding explorer: every computed word (all languages), nearest neighbours and comparisons (one language at a
// time), on-demand embedding. Similarities are exactly what the game uses (cosine of mean-centered embeddings).
useHead({ title: 'Embedding explorer' })

interface Neighbours { word: string; lang: string; exists: boolean; total?: number; neighbours?: { w: string; sim: number }[] }
interface Compare {
  lang: string; a: string; b: string; existsA: boolean; existsB: boolean; total: number
  sim?: number; rankBinA?: number; rankAinB?: number
}
interface WordList {
  words: { w: string; lang: string }[]; total: number; typed: string; have: string[]; langs: { lang: string; count: number }[]
}

const FLAGS: Record<string, string> = { fr: '🇫🇷', en: '🇬🇧', es: '🇪🇸', de: '🇩🇪', it: '🇮🇹', pt: '🇵🇹', nl: '🇳🇱' }
const flag = (lang: string) => FLAGS[lang] ?? lang.toUpperCase()

const route = useRoute()
const router = useRouter()
const q = (k: string, d = '') => String(route.query[k] ?? d)

const tab = ref<'neighbours' | 'compare'>(q('tab') === 'compare' ? 'compare' : 'neighbours')
const selected = ref(q('w'))
const selectedLang = ref(q('wl', 'fr'))
const cmpLang = ref(q('cl', 'fr'))
const cmpA = ref(q('a'))
const cmpB = ref(q('b'))
const threshold = HEAT_MIN // lower bound of the game's hint range (read-only)
const revealAt = HEAT_MAX // from here the game reveals the word
const isHint = (sim: number) => sim >= threshold

const disabled = ref(false)
const search = ref('')
const list = ref<WordList>({ words: [], total: 0, typed: '', have: [], langs: [] })
const neighbours = ref<Neighbours | null>(null)
const compare = ref<Compare | null>(null)
const computing = ref<string | null>(null)
const toast = useToast()

const langs = computed(() => {
  const known = list.value.langs.map(l => l.lang)
  return [...new Set(['fr', 'en', ...known])]
})

async function api<T>(url: string, opts?: Parameters<typeof $fetch>[1]): Promise<T> {
  try {
    return await $fetch<T>(url, opts as never)
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.status === 404) disabled.value = true
    throw e
  }
}

const loadList = async () => {
  list.value = await api('/api/debug/words', { query: { q: search.value, limit: 300 } })
}
const loadNeighbours = async () => {
  neighbours.value = selected.value
    ? await api('/api/debug/neighbors', { query: { w: selected.value, lang: selectedLang.value, k: 60 } })
    : null
}
const loadCompare = async () => {
  compare.value = cmpA.value.trim() && cmpB.value.trim()
    ? await api('/api/debug/compare', { query: { a: cmpA.value, b: cmpB.value, lang: cmpLang.value } })
    : null
}

// keep the URL shareable
watchEffect(() => {
  router.replace({
    query: {
      tab: tab.value, w: selected.value || undefined, wl: selected.value ? selectedLang.value : undefined,
      a: cmpA.value || undefined, b: cmpB.value || undefined, cl: cmpA.value || cmpB.value ? cmpLang.value : undefined
    }
  })
})

const debounced = (fn: () => unknown, ms = 250) => {
  let t: ReturnType<typeof setTimeout>
  return () => { clearTimeout(t); t = setTimeout(fn, ms) }
}
watch(search, debounced(loadList))
watch([selected, selectedLang], debounced(loadNeighbours, 150))
watch([cmpA, cmpB, cmpLang], debounced(loadCompare))
onMounted(() => Promise.all([loadList(), loadNeighbours(), loadCompare()]).catch(() => {}))

async function compute(word: string, lang: string) {
  computing.value = `${word}|${lang}`
  try {
    const r = await api<{ word: string; created: boolean }>('/api/debug/embed', { method: 'POST', body: { word, lang } })
    toast.add({ title: r.created ? 'Embedded' : 'Already computed', description: `${flag(lang)} ${r.word}`, color: r.created ? 'success' : 'neutral' })
    await Promise.all([loadList(), loadNeighbours(), loadCompare()])
  } catch (e: any) {
    toast.add({ title: 'Could not compute', description: e?.data?.statusMessage ?? 'Please retry.', color: 'error' })
  } finally {
    computing.value = null
  }
}

function open(word: string, lang = selectedLang.value) {
  selected.value = word
  selectedLang.value = lang
  tab.value = 'neighbours'
}
function compareWith(word: string) {
  cmpLang.value = selectedLang.value
  cmpA.value = selected.value
  cmpB.value = word
  tab.value = 'compare'
}
function swap() { [cmpA.value, cmpB.value] = [cmpB.value, cmpA.value] }

const pct = (n: number) => `${Math.max(0, Math.min(1, n)) * 100}%`
const barColor = (sim: number) => (isHint(sim) ? heatColor(sim) : 'var(--ui-border-accented)')
const verdict = computed(() => {
  const s = compare.value?.sim
  return s === undefined ? 'none' : s >= revealAt ? 'reveal' : s >= threshold ? 'hint' : 'none'
})
const tabs = [
  { label: 'Nearest words', value: 'neighbours', icon: 'i-lucide-radar' },
  { label: 'Compare two words', value: 'compare', icon: 'i-lucide-git-compare-arrows' }
]
const computingKey = (w: string, l: string) => computing.value === `${w}|${l}`
</script>

<template>
  <div class="max-w-6xl mx-auto p-3 sm:p-6 space-y-4">
    <header class="flex flex-wrap items-center gap-3">
      <UButton to="/" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm">Game</UButton>
      <h1 class="text-xl font-bold">Embedding explorer</h1>
      <UBadge color="neutral" variant="subtle">{{ list.total.toLocaleString() }} words{{ search ? ' match' : '' }}</UBadge>
      <div class="ml-auto flex flex-wrap items-center gap-3">
        <UBadge color="neutral" variant="outline" title="Similarity range of the game (read-only): hints from the first value, word revealed from the second">
          Hint {{ threshold.toFixed(2) }} · Reveal {{ revealAt.toFixed(2) }}
        </UBadge>
        <UColorModeButton />
      </div>
    </header>

    <UAlert
      v-if="disabled" color="warning" variant="subtle" icon="i-lucide-lock"
      title="Debug page disabled" description="It only runs in dev. Set NUXT_DEBUG_ENABLED=true to enable it elsewhere."
    />

    <div class="grid gap-4 lg:grid-cols-[19rem_1fr] items-start">
      <!-- all computed words, every language -->
      <UCard :ui="{ body: 'p-0 sm:p-0', header: 'p-3 sm:p-3' }" class="lg:sticky lg:top-4">
        <template #header>
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search (accents ignored) or add…" class="w-full" />
        </template>
        <div class="max-h-[60vh] lg:max-h-[calc(100vh-11rem)] overflow-y-auto">
          <div v-if="search.trim() && /^\p{L}+$/u.test(search.trim())" class="p-2 border-b border-default flex flex-wrap items-center gap-1.5 bg-primary/5">
            <span class="text-xs text-muted px-1">Compute “{{ list.typed }}” in</span>
            <UButton
              v-for="l in langs.filter(l => !list.have.includes(l))" :key="l" size="xs" color="primary" variant="soft"
              :loading="computingKey(list.typed, l)" :disabled="computing !== null" @click="compute(list.typed, l)"
            >
              {{ flag(l) }}
            </UButton>
          </div>
          <ul class="divide-y divide-default">
            <li v-for="item in list.words" :key="item.w + item.lang">
              <button
                type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-elevated"
                :class="{ 'bg-elevated font-medium': item.w === selected && item.lang === selectedLang }" @click="open(item.w, item.lang)"
              >
                <span class="w-6 text-center text-base leading-none" :title="item.lang">{{ flag(item.lang) }}</span>
                <span class="flex-1 truncate">{{ item.w }}</span>
              </button>
            </li>
          </ul>
          <p v-if="list.total > list.words.length" class="p-3 text-xs text-muted text-center">
            Showing {{ list.words.length }} of {{ list.total }}: refine the search.
          </p>
          <p v-if="!list.words.length && !search" class="p-4 text-sm text-muted">No word computed yet. Play a game first.</p>
        </div>
      </UCard>

      <!-- explorer -->
      <section class="min-w-0 space-y-4">
        <UTabs v-model="tab" :items="tabs" :content="false" color="neutral" class="w-full" />

        <!-- nearest words -->
        <UCard v-if="tab === 'neighbours'">
          <div v-if="!selected" class="py-10 text-center text-muted">
            <UIcon name="i-lucide-mouse-pointer-click" class="size-8 mb-2" />
            <p>Pick a word on the left to see its nearest neighbours.</p>
          </div>
          <template v-else-if="neighbours && !neighbours.exists">
            <div class="py-8 text-center space-y-3">
              <p class="text-lg">“{{ neighbours.word }}” isn't computed in {{ flag(selectedLang) }} yet.</p>
              <UButton icon="i-lucide-sparkles" :loading="computingKey(selected, selectedLang)" @click="compute(selected, selectedLang)">
                Compute it (1 API call)
              </UButton>
            </div>
          </template>
          <template v-else-if="neighbours?.neighbours">
            <div class="flex items-baseline gap-3 mb-4">
              <h2 class="text-2xl font-bold">{{ neighbours.word }}</h2>
              <span class="text-xl" :title="neighbours.lang">{{ flag(neighbours.lang) }}</span>
              <span class="text-sm text-muted">among {{ neighbours.total }} {{ neighbours.lang }} words</span>
            </div>
            <ol class="space-y-1">
              <li v-for="(n, i) in neighbours.neighbours" :key="n.w" class="group flex items-center gap-2">
                <span class="w-6 text-right text-xs text-muted tabular-nums">{{ i + 1 }}</span>
                <button type="button" class="relative flex-1 h-8 rounded overflow-hidden bg-elevated text-left" @click="open(n.w, neighbours.lang)">
                  <span class="absolute inset-y-0 left-0 rounded-r transition-all" :style="{ width: pct(n.sim), background: barColor(n.sim), opacity: isHint(n.sim) ? 0.85 : 0.5 }" />
                  <span class="absolute inset-y-0 w-px bg-default/70" :style="{ left: pct(threshold) }" />
                  <span class="absolute inset-y-0 w-px bg-default/70" :style="{ left: pct(revealAt) }" />
                  <span class="relative z-10 flex h-full items-center px-2 font-medium" :class="isHint(n.sim) ? 'text-neutral-900' : ''">{{ n.w }}</span>
                </button>
                <span class="w-14 text-right text-sm tabular-nums" :class="isHint(n.sim) ? 'font-semibold' : 'text-muted'">{{ n.sim.toFixed(3) }}</span>
                <UButton
                  size="xs" color="neutral" variant="ghost" icon="i-lucide-git-compare-arrows" title="Compare with this word"
                  class="opacity-0 group-hover:opacity-100 focus:opacity-100" @click="compareWith(n.w)"
                />
              </li>
            </ol>
            <p class="mt-3 text-xs text-muted">The two vertical lines mark where hints start and where words get revealed in the game.</p>
          </template>
        </UCard>

        <!-- compare -->
        <UCard v-else>
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <span class="text-sm text-muted">Language</span>
            <UButton
              v-for="l in langs" :key="l" size="sm" :color="l === cmpLang ? 'primary' : 'neutral'"
              :variant="l === cmpLang ? 'solid' : 'outline'" @click="cmpLang = l"
            >
              {{ flag(l) }} {{ l }}
            </UButton>
          </div>
          <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr] items-start">
            <UInput v-model="cmpA" size="xl" placeholder="First word" class="w-full" />
            <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left-right" title="Swap" class="justify-self-center" @click="swap" />
            <UInput v-model="cmpB" size="xl" placeholder="Second word" class="w-full" />
          </div>

          <div v-if="compare && (!compare.existsA || !compare.existsB)" class="mt-5 flex flex-wrap gap-2">
            <template v-for="side in [{ ok: compare.existsA, w: compare.a }, { ok: compare.existsB, w: compare.b }]" :key="side.w">
              <UButton
                v-if="!side.ok && side.w" icon="i-lucide-sparkles" color="primary" variant="soft"
                :loading="computingKey(side.w, cmpLang)" @click="compute(side.w, cmpLang)"
              >
                Compute “{{ side.w }}” in {{ flag(cmpLang) }} (1 API call)
              </UButton>
            </template>
          </div>

          <div v-else-if="compare && compare.sim !== undefined" class="mt-6 space-y-5">
            <div class="text-center">
              <div class="text-6xl font-bold tabular-nums" :style="{ color: verdict !== 'none' ? heatColor(compare.sim) : undefined }">{{ compare.sim.toFixed(3) }}</div>
              <div class="mt-1 text-sm text-muted">{{ compare.a }} ↔ {{ compare.b }} · {{ flag(compare.lang) }}</div>
            </div>
            <div class="relative h-3 rounded-full bg-elevated overflow-hidden">
              <div class="absolute inset-y-0 left-0 rounded-full" :style="{ width: pct(compare.sim), background: barColor(compare.sim) }" />
              <div class="absolute inset-y-0 w-0.5 bg-default" :style="{ left: pct(threshold) }" />
              <div class="absolute inset-y-0 w-0.5 bg-default" :style="{ left: pct(revealAt) }" />
            </div>
            <div class="flex justify-center">
              <UBadge :color="verdict === 'reveal' ? 'success' : verdict === 'hint' ? 'warning' : 'neutral'" variant="subtle" size="lg">
                {{ verdict === 'reveal' ? 'Word revealed in the game' : verdict === 'hint' ? 'Shows as a hint' : 'Below the hint minimum' }}
              </UBadge>
            </div>
            <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2 text-center">
              <div class="rounded-lg bg-elevated p-3">
                <dt class="text-xs text-muted">“{{ compare.b }}” among the neighbours of “{{ compare.a }}”</dt>
                <dd class="text-lg font-semibold tabular-nums">#{{ compare.rankBinA }}<span class="text-xs text-muted"> / {{ compare.total - 1 }}</span></dd>
              </div>
              <div class="rounded-lg bg-elevated p-3">
                <dt class="text-xs text-muted">“{{ compare.a }}” among the neighbours of “{{ compare.b }}”</dt>
                <dd class="text-lg font-semibold tabular-nums">#{{ compare.rankAinB }}<span class="text-xs text-muted"> / {{ compare.total - 1 }}</span></dd>
              </div>
            </dl>
            <div class="flex flex-wrap justify-center gap-2">
              <UButton size="sm" color="neutral" variant="outline" @click="open(compare.a, compare.lang)">Neighbours of {{ compare.a }}</UButton>
              <UButton size="sm" color="neutral" variant="outline" @click="open(compare.b, compare.lang)">Neighbours of {{ compare.b }}</UButton>
            </div>
          </div>

          <p v-else class="mt-8 mb-4 text-center text-muted">Type two words of the same language to compare them. Unknown words can be computed on the spot.</p>
        </UCard>
      </section>
    </div>
  </div>
</template>
