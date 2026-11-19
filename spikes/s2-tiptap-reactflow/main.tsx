import '@xyflow/react/dist/style.css'
import '../../src/index.css'
import './spike.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpikeApp } from './SpikeApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpikeApp />
  </StrictMode>,
)
