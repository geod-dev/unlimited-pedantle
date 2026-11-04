import { loadGame } from '@/server/utils/game'

// Used after a win (or when giving up) to uncover the whole text.
export default defineEventHandler(async (event) => {
  const game = await loadGame(getRouterParam(event, 'id')!)
  return {
    title: game.title,
    url: game.url,
    words: game.tokens.map(t => (t.k === 'p' || t.k === 'br' ? null : t.s))
  }
})
