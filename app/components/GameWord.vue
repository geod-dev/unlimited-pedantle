<script setup lang="ts">
const props = defineProps<{
  n: number // length of the hidden word
  text?: string // revealed word
  near?: { word: string; sim: number } // best hint guess for this position
  isLastExact: boolean // revealed by the last guess
  lastSim?: number // similarity of this position for the last guess
  full?: string | null // word shown after the game ended
  clickable?: boolean
  debug?: boolean
  small?: boolean // ordinal suffix (e, ème, st...)
  href?: string | null // link target, only used once the game is over and the word is shown
}>()
const emit = defineEmits<{ peek: []; select: []; hover: [ev: MouseEvent]; leave: [] }>()

const revealed = computed(() => props.text ?? props.full ?? null)
// the word's own text: the real word once revealed, otherwise an invisible placeholder that gives the rectangle its width
const label = computed(() => revealed.value ?? 'n'.repeat(props.n))

// rectangle mode: hidden, hinted, or revealed by the last guess. Revealed earlier = plain text.
const rect = computed(() => !revealed.value || props.isLastExact)
const hot = computed(() => !revealed.value && props.near && props.lastSim === props.near.sim) // hint from the last guess

const rectStyle = computed(() => (hot.value ? { background: heatColor(props.near!.sim) } : undefined))
const interactive = computed(() => props.debug || (!revealed.value && props.clickable))
// a word found by a guess, or a hint from one, selects that guess (like clicking it in the guesses list)
const selectable = computed(() => !!props.text || !!props.near)

function onClick() {
  if (interactive.value) emit('peek')
  else if (selectable.value) emit('select')
}
</script>

<template>
  <span
    class="inline-grid place-items-center leading-[1.25] whitespace-nowrap"
    :class="[
      small ? 'text-[0.7em] align-super' : 'align-baseline',
      rect ? 'rounded-[3px] px-[0.25em]' : '',
      !rect ? '' : revealed ? 'bg-success/5' : hot ? '' : 'bg-neutral-300 dark:bg-neutral-600',
      interactive || selectable ? 'cursor-pointer' : ''
    ]"
    :style="rectStyle"
    @click="onClick"
    @mouseenter="emit('hover', $event)"
    @mouseleave="emit('leave')"
  >
    <component
      :is="href && revealed ? 'a' : 'span'"
      class="col-start-1 row-start-1"
      :class="[
        !revealed ? 'text-transparent select-none' : isLastExact ? 'text-success font-medium' : full && !text ? 'text-muted' : '',
        href && revealed ? 'underline underline-offset-4 hover:text-primary' : ''
      ]"
      :href="href && revealed ? href : undefined"
      :target="href && revealed ? '_blank' : undefined"
      :rel="href && revealed ? 'noopener' : undefined"
    >{{ label }}</component>
    <span v-if="near && !revealed" class="col-start-1 row-start-1" :class="hot ? 'text-neutral-900' : ''">{{ near.word }}</span>
  </span>
</template>
