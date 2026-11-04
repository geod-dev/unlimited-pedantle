# Unlimited Pedantle

Guess the hidden Wikipedia article one word at a time (Nuxt 4 + Nuxt UI + Turso + Voyage `voyage-4-lite`).

```bash
cp .env.example .env   # set NUXT_VOYAGE_API_KEY
npm install
npm run dev
```

- **Articles**: random pick among the most-viewed Wikipedia articles of the last month (fr/en), or any Wikipedia link.
- **Embeddings**: every page word and every guess is embedded once and cached in the `words` table.
- **Word validity**: page words, cached words, or the local lexicon `server/assets/lexicon-{fr,en}.txt` (Wiktionary words and inflected forms + proper nouns from Wikipedia article titles). No network call per guess.
  Regenerate with `node scripts/build-lexicon.mjs` after downloading the kaikki.org Wiktionary extracts (`kaikki-{fr,en}.jsonl`) and the `{fr,en}wiki-latest-all-titles-in-ns0.gz` dumps into `.cache/lexicon/`. Wiktionary data: CC BY-SA, via [kaikki.org](https://kaikki.org).
- **Tuning**: `NEAR_MIN` in `server/api/games/[id]/guess.post.ts` and `HEAT_MIN/HEAT_MAX` in `app/composables/useGame.ts`; `GATE_WORDS` in `server/utils/wiki.ts`.
- **Vercel**: create a Turso DB and set `NUXT_TURSO_DATABASE_URL`, `NUXT_TURSO_AUTH_TOKEN`, `NUXT_VOYAGE_API_KEY`.
