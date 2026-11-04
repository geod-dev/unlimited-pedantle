import wink from 'wink-lemmatizer'
import { fold } from '@/server/utils/text'

// Verb lemmatization so that guessing any conjugated form (être, est, fût, serai...) reveals all of them.
// French: reverse index built from the Lefff conjugation table. English: wink-lemmatizer. Other languages: exact only.

let frIndex: Map<string, string[]> | null = null

async function frenchIndex(): Promise<Map<string, string[]>> {
  if (frIndex) return frIndex
  // 6 MB table shipped as a Nitro server asset (see nuxt.config.ts) rather than bundled as a module
  const raw = await useStorage('assets:verbs').getItemRaw('conjugations.json')
  const data = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw as Uint8Array).toString('utf8')) as Record<string, Record<string, (string | null)[]>>
  const index = new Map<string, string[]>()
  for (const [infinitive, tenses] of Object.entries(data)) {
    for (const forms of Object.values(tenses)) {
      for (const form of forms) {
        if (!form || form === 'NA') continue
        const key = fold(form)
        const list = index.get(key)
        if (!list) index.set(key, [infinitive])
        else if (!list.includes(infinitive)) list.push(infinitive)
      }
    }
  }
  frIndex = index
  return index
}

/** Verb lemmas a word form may belong to (empty when it is not a known verb form). */
export async function verbLemmas(lang: string, word: string): Promise<string[]> {
  if (lang === 'fr') return (await frenchIndex()).get(fold(word)) ?? []
  if (lang === 'en') {
    const lemma = wink.lemmatizeVerb(word.toLowerCase())
    // wink returns the word itself when it is not an inflected verb; the bare form is still a lemma candidate
    return [lemma]
  }
  return []
}
