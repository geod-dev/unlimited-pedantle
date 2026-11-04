import { createClient, type Client } from '@libsql/client'

let client: Client | null = null
let ready: Promise<void> | null = null

export async function useDb(): Promise<Client> {
  if (!client) {
    const cfg = useRuntimeConfig()
    client = createClient({ url: cfg.tursoDatabaseUrl, authToken: cfg.tursoAuthToken || undefined })
  }
  ready ??= client
    .batch([
      // One embedding per (word, language). `w` keeps its accents (embeddings must be precise), `f` is the
      // accent-folded form used to match what players type. A row also means "this is a valid word".
      'CREATE TABLE IF NOT EXISTS embeddings (w TEXT NOT NULL, lang TEXT NOT NULL, f TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (w, lang))',
      'CREATE INDEX IF NOT EXISTS idx_embeddings_lang_f ON embeddings (lang, f)',
      'CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, lang TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)'
    ])
    .then(() => undefined)
  await ready
  return client
}
