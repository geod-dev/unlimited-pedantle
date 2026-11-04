<script setup lang="ts">
const { start, busy } = useGame()
const url = ref('')
const pending = ref<'fr' | 'en' | 'url' | null>(null)

async function go(kind: 'fr' | 'en' | 'url') {
  pending.value = kind
  await start(kind === 'url' ? { url: url.value } : { lang: kind })
  pending.value = null
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center p-4">
    <UColorModeButton class="fixed top-3 right-3" />
    <UCard class="w-full max-w-lg">
      <div class="text-center space-y-1 mb-6">
        <h1 class="text-3xl font-bold tracking-tight">Unlimited Pedantle</h1>
        <p class="text-muted">Find the hidden Wikipedia article, one word at a time.</p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <UButton size="xl" block color="primary" :loading="pending === 'fr'" :disabled="busy" @click="go('fr')">
          🇫🇷 Français
        </UButton>
        <UButton size="xl" block color="primary" variant="soft" :loading="pending === 'en'" :disabled="busy" @click="go('en')">
          🇬🇧 English
        </UButton>
      </div>

      <USeparator label="or" class="my-5" />

      <form class="flex gap-2" @submit.prevent="url.trim() && go('url')">
        <UInput v-model="url" class="flex-1" placeholder="https://en.wikipedia.org/wiki/…" icon="i-lucide-link" :disabled="busy" />
        <UButton type="submit" :loading="pending === 'url'" :disabled="busy || !url.trim()">Play</UButton>
      </form>
      <p v-if="busy" class="text-sm text-muted mt-4 text-center">Picking an article and embedding its words…</p>
    </UCard>
  </main>
</template>
