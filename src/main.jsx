import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Lower-end computers and phones (four or fewer processor threads, or 4 GB of memory or less)
// are marked here, before anything is drawn, so DubHub.css can give them lighter versions of some
// decoration: look for [data-lite] there. Browsers that don't say count as not lower-end.
if (navigator.hardwareConcurrency <= 4 || navigator.deviceMemory <= 4) {
  document.documentElement.dataset.lite = ''
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
