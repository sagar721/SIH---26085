import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode is intentionally omitted: its dev-only double-invoke of effects
// (mount -> cleanup -> mount) races with MapLibre GL's shared worker pool
// teardown/recreate, causing the map to intermittently fail to load tiles.
createRoot(document.getElementById('root')!).render(<App />)
