import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// i18n initialization (must be imported before App)
import './i18n'

// Local font (no external requests to Google Fonts)
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'

import App from './App'
import './index.css'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'rgba(255, 255, 255, 0.98)',
            color: '#0f172a',
            border: '1px solid rgba(15, 23, 42, 0.08)',
            borderRadius: '12px',
            boxShadow: '0 20px 40px -12px rgba(15, 23, 42, 0.20), 0 6px 12px -6px rgba(15, 23, 42, 0.08)',
            padding: '12px 14px',
            fontSize: '14px',
            fontWeight: 500,
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#059669',
              secondary: '#ffffff',
            },
          },
          error: {
            duration: 5000,
            iconTheme: {
              primary: '#dc2626',
              secondary: '#ffffff',
            },
          },
        }}
      />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)

// Hide the boot splash once React has mounted. The splash script in
// index.html enforces a minimum display time so the "app opening" moment
// is perceivable, especially on PWA cold-start.
requestAnimationFrame(() => {
  ;(window as any).__hideAppSplash?.()
})
