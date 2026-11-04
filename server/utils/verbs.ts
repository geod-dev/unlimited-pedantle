import wink from 'wink-lemmatizer'
import EnglishVerbs from 'english-verbs-helper'
import { fold, lower } from '@/server/utils/text'

// Verb knowledge, same interface for every language: which verbs can this word be a form of (lemmas),
// and what are all the forms of a verb. Used so that guessing any form uncovers every other form on the page.
//  - French: Lefff conjugation table  { infinitive: [every form] }  (server/assets/verbs-fr.json)
//  - English: irregular verbs table + regular rules  (server/assets/verbs-en.json, english-verbs-helper, wink-lemmatizer)
//  - Other languages: no verb knowledge, only exact matches.

export interface VerbTables {
  fr: Record<string, string[]>
  /** { lemma: [preterit, past participle, gerund|null] } */
  en: Record<string, (string | null)[]>
}

export interface Verbs {
  /**
   * Lemmas a word may be a form of. `loose` ignores accents (for what the player types);
   * page words are looked up exactly so "à" is never mistaken for "a" (avoir) nor "dû" for "du".
   */
  lemmas(lang: string, word: string, loose?: boolean): string[]
  /** every form of a verb */
  forms(lang: string, lemma: string): string[]
  /** is it a real verb? (English lemmatizer returns any word unchanged, so check it recognises the verb's own gerund) */
  isVerb(lang: string, lemma: string): boolean
}

const push = (m: Map<string, string[]>, key: string, v: string) => {
  const list = m.get(key)
  if (!list) m.set(key, [v])
  else if (!list.includes(v)) list.push(v)
}

export function createVerbs(tables: VerbTables): Verbs {
  // French reverse indexes: exact accented form, and accent-folded form
  const frExact = new Map<string, string[]>()
  const frFold = new Map<string, string[]>()
  for (const [infinitive, forms] of Object.entries(tables.fr)) {
    for (const form of forms) {
      push(frExact, form, infinitive)
      push(frFold, fold(form), infinitive)
    }
  }

  // English irregular forms -> lemma
  const enIrregular = new Map<string, string[]>()
  for (const [lemma, forms] of Object.entries(tables.en)) for (const f of forms) if (f) push(enIrregular, f, lemma)
  for (const f of ['am', 'are', 'is', 'was', 'were', 'been', 'being']) push(enIrregular, f, 'be')

  const formsCache = new Map<string, string[]>()
  const englishForms = (lemma: string): string[] => {
    const hit = formsCache.get(lemma)
    if (hit) return hit
    let out: string[]
    if (lemma === 'be') out = ['be', 'am', 'are', 'is', 'was', 'were', 'been', 'being']
    else {
      const data = tables.en as never
      const present = EnglishVerbs.getConjugation(null, lemma, 'PRESENT', 2)
      const past = EnglishVerbs.getConjugation(data, lemma, 'SIMPLE_PAST', 2)
      const participle = EnglishVerbs.getConjugation(data, lemma, 'PERFECT_PRESENT', 2).replace(/^has /, '')
      const gerund = EnglishVerbs.getIngPart(data, lemma)
      out = [...new Set([lemma, present, past, participle, gerund].filter(Boolean))]
    }
    formsCache.set(lemma, out)
    return out
  }

  // The lemmatizer returns any word unchanged, so a lemma only counts as a verb when the lemmatizer
  // also maps one of its generated forms back to it (or it is an irregular verb).
  const isEnglishVerb = (lemma: string) =>
    lemma === 'be' || lemma in tables.en || englishForms(lemma).some(f => f !== lemma && wink.lemmatizeVerb(f) === lemma)

  /** possible base forms of an inflected English word, by suffix rules (validated afterwards against the generator) */
  const englishStems = (w: string): string[] => {
    const s = new Set<string>([w, wink.lemmatizeVerb(w)])
    const doubled = (x: string) => x.length > 2 && x.at(-1) === x.at(-2)
    if (w.endsWith('ies')) s.add(w.slice(0, -3) + 'y')
    if (w.endsWith('es')) s.add(w.slice(0, -2))
    if (w.endsWith('s')) s.add(w.slice(0, -1))
    if (w.endsWith('ied')) s.add(w.slice(0, -3) + 'y')
    if (w.endsWith('ed')) { s.add(w.slice(0, -2)); s.add(w.slice(0, -1)); if (doubled(w.slice(0, -2))) s.add(w.slice(0, -3)) }
    if (w.endsWith('ying')) s.add(w.slice(0, -4) + 'ie')
    if (w.endsWith('ing')) { const b = w.slice(0, -3); s.add(b); s.add(b + 'e'); if (doubled(b)) s.add(b.slice(0, -1)) }
    return [...s].filter(c => c.length > 1)
  }

  return {
    lemmas(lang, word, loose = false) {
      const w = lower(word)
      if (lang === 'fr') return (loose ? frFold.get(fold(w)) : frExact.get(w)) ?? []
      if (lang === 'en') {
        // irregular forms, plus every candidate base form that really produces this word when conjugated
        const found = new Set(enIrregular.get(w) ?? [])
        for (const c of englishStems(w)) if (!found.has(c) && englishForms(c).includes(w) && isEnglishVerb(c)) found.add(c)
        return [...found]
      }
      return []
    },
    forms(lang, lemma) {
      if (lang === 'fr') return tables.fr[lemma] ?? []
      if (lang === 'en') return englishForms(lemma)
      return []
    },
    isVerb(lang, lemma) {
      if (lang === 'fr') return lemma in tables.fr
      if (lang === 'en') return isEnglishVerb(lemma)
      return false
    }
  }
}
