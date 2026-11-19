import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { SpikeApp } from './SpikeApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpikeApp />
  </StrictMode>,
)
