import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// After each production build on Vercel (every push: a change or a scrape), save a snapshot of
// DubHub's numbers for the moderators' Stats page. See scripts/record-stats.mjs.
function recordStats() {
  return {
    name: 'record-stats',
    apply: 'build',
    async closeBundle() {
      if (process.env.VERCEL_ENV !== 'production') return
      const { recordStats } = await import('./scripts/record-stats.mjs')
      await recordStats()
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), recordStats()],
})
