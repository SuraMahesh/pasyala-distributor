import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import AuthGate from './components/AuthGate'
import { ConfirmProvider } from './components/Confirm'
import { ApiError } from './lib/api'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </ConfirmProvider>
      <Toaster richColors closeButton position="top-right" toastOptions={{ className: 'text-sm' }} />
    </QueryClientProvider>
  </StrictMode>,
)
