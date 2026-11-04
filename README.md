# 🧩 Unlimited Pedantle

Guess a hidden Wikipedia article, one word at a time. The closer your word is in meaning, the hotter it gets 🔥

## 🚀 Quick start

```bash
cp .env.example .env   # add your NUXT_VOYAGE_API_KEY
npm install
npm run dev
```

## 🛠️ Stack

| | |
|---|---|
| 🖼️ Front | Nuxt 4 + Nuxt UI |
| 🗄️ Database | Turso |
| 🧠 Embeddings | Voyage `voyage-4-lite` |

## ✨ How it works

- 📰 **Articles**: random pick from last month's most-viewed Wikipedia pages (fr/en), or paste any Wikipedia link
- 🔤 **Words**: every page word and guess is embedded once, then cached in the `words` table
- ✅ **Validity**: checked against the page, the cache, or a local lexicon, so no network call per guess

## 📚 Lexicon

Built from Wiktionary words and inflections plus Wikipedia article titles, stored in `server/assets/lexicon-{fr,en}.txt`.

To regenerate:

1. Put the [kaikki.org](https://kaikki.org) extracts `kaikki-{fr,en}.jsonl` in `.cache/lexicon/`
2. Add the `{fr,en}wiki-latest-all-titles-in-ns0.gz` dumps there too
3. Run `node scripts/build-lexicon.mjs`

## 🎛️ Tuning

| What | Where |
|---|---|
| Nearness threshold | `NEAR_MIN` in `server/api/games/[id]/guess.post.ts` |
| Heat colors | `HEAT_MIN` / `HEAT_MAX` in `app/composables/useGame.ts` |
| Gate words | `GATE_WORDS` in `server/utils/wiki.ts` |

## ☁️ Deploy on Vercel

Create a Turso database, then set:

- `NUXT_TURSO_DATABASE_URL`
- `NUXT_TURSO_AUTH_TOKEN`
- `NUXT_VOYAGE_API_KEY`

## 📄 License

Wiktionary data is CC BY-SA, via [kaikki.org](https://kaikki.org).
