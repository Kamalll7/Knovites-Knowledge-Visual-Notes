import './spike.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installBrowserBridge } from './browser-bridge'
import { SpikeApp } from './SpikeApp'

installBrowserBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpikeApp />
  </StrictMode>,
)
