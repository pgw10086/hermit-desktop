import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QuickRetrievalApp } from './QuickRetrievalApp.js'

const root = document.querySelector<HTMLElement>('#root')
if (root === null) throw new Error('Quick Retrieval root 不存在')

createRoot(root).render(
  <StrictMode>
    <QuickRetrievalApp />
  </StrictMode>,
)
