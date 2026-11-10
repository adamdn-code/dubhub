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

// The map's code (Leaflet and MapLibre, about three quarters of the site's JavaScript) is its own
// file that only downloads when the Map tab is opened, so the Now page starts sooner. This adds a
// "prefetch" hint for it to the built page: once the page has loaded and the connection is idle,
// the browser fetches it in the background (without running it), so opening the map doesn't wait
// on a download. Browsers that don't prefetch just fetch it when the tab is opened.
function prefetchLazyCode() {
  return {
    name: 'prefetch-lazy-code',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        return Object.values(bundle ?? {})
          .filter((file) => file.type === 'chunk' && file.isDynamicEntry)
          .map((file) => ({
            tag: 'link',
            attrs: { rel: 'prefetch', href: `/${file.fileName}`, as: 'script', crossorigin: true },
            injectTo: 'head',
          }))
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), recordStats(), prefetchLazyCode()],
})
