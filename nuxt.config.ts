import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// "@/" is the project root, so server code imports "@/server/utils/..." instead of "../../utils/..."
const root = resolve(fileURLToPath(new URL('.', import.meta.url)))

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  alias: { '@': root },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Unlimited Pedantle',
      meta: [{ name: 'description', content: 'Guess the hidden Wikipedia article, one word at a time.' }]
    }
  },
  nitro: {
    serverAssets: [{ baseName: 'verbs', dir: './node_modules/french-verbs-lefff/dist' }]
  },
  runtimeConfig: {
    voyageApiKey: '',
    tursoDatabaseUrl: 'file:./data/local.db',
    tursoAuthToken: '',
    debugEnabled: '' // set NUXT_DEBUG_ENABLED=true to expose /debug outside dev
  }
})
