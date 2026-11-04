import { createVerbs, type VerbTables, type Verbs } from '@/server/utils/verbs'

// Loads the verb tables (Nitro server assets, see server/assets) once and exposes them to the game and the debug page.
let verbs: Promise<Verbs> | null = null

async function asset<T>(key: string): Promise<T> {
  const raw = await useStorage('assets:server').getItemRaw(key)
  return JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw as Uint8Array).toString('utf8')) as T
}

const loadVerbs = () =>
  (verbs ??= Promise.all([asset<VerbTables['fr']>('verbs-fr.json'), asset<VerbTables['en']>('verbs-en.json')])
    .then(([fr, en]) => createVerbs({ fr, en })))

/** Verb lemmas a word may be a form of. `loose` = accent-insensitive (use it for what the player types). */
export async function verbLemmas(lang: string, word: string, loose = false): Promise<string[]> {
  return (await loadVerbs()).lemmas(lang, word, loose)
}

export async function isVerb(lang: string, lemma: string): Promise<boolean> {
  return (await loadVerbs()).isVerb(lang, lemma)
}

/** Every form of a verb. */
export async function verbForms(lang: string, lemma: string): Promise<string[]> {
  return (await loadVerbs()).forms(lang, lemma)
}
