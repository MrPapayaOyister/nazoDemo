import { Toaster } from 'sonner'
import { AppEffects } from '@/app/AppEffects'
import { AppShell } from '@/app/AppShell'
import { LoginGate } from '@/features/auth/LoginGate'
import { PublicVerify } from '@/features/verify/PublicVerify'
import { useStore } from '@/store'

/** /r/<ref> is the target of the QR printed on every document. Someone scanning a
 *  paper letter has no identity and must not be asked for one, so this path is
 *  carved out ahead of the gate rather than living inside AppShell's routes. */
const isPublicVerifyRoute = () => window.location.pathname.startsWith('/r/')

function App() {
  // The login gate is the entry point until an identity is chosen (persisted).
  const sessionUserId = useStore((s) => s.sessionUserId)
  if (isPublicVerifyRoute()) {
    return (
      <>
        <AppEffects />
        <PublicVerify />
      </>
    )
  }
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
