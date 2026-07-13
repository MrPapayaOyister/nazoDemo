import { Toaster } from 'sonner'
import { AppEffects } from '@/app/AppEffects'
import { AppShell } from '@/app/AppShell'
import { LoginGate } from '@/features/auth/LoginGate'
import { useStore } from '@/store'

function App() {
  // The login gate is the entry point until an identity is chosen (persisted).
  const sessionUserId = useStore((s) => s.sessionUserId)
  return (
    <>
      <AppEffects />
      {sessionUserId == null ? <LoginGate /> : <AppShell />}
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
