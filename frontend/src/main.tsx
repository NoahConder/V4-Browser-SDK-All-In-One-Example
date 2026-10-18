import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { loadSettings } from './services/settings'
import { applyTheme } from './services/theme'
import './styles/globals.css'

// Resolve the Appearance setting to data-theme before the first paint so the
// page never flashes the other theme (see services/theme.ts).
applyTheme(loadSettings().theme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)