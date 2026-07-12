import { Toaster } from 'sonner'
import { AppEffects } from '@/app/AppEffects'
import { AppShell } from '@/app/AppShell'

function App() {
  return (
    <>
      <AppEffects />
      <AppShell />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: 'rounded-xl',
          style: {
            background: 'var(--bg-surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          },
        }}
      />
    </>
  )
}

export default App
