import { useStore, useAiMessages } from '@/store'

/**
 * The single AI seam. Today it plays scripted scenarios; a `live` Claude service
 * could be dropped in behind the same interface without touching any UI.
 */
export function useAI() {
  const run = useStore((s) => s.run)
  const isRunning = useStore((s) => s.ai.isRunning)
  const runningAction = useStore((s) => s.ai.runningAction)
  const messages = useAiMessages()
  const undoLast = useStore((s) => s.undoLast)
  const clearMessages = useStore((s) => s.clearMessages)
  const newChat = useStore((s) => s.newChat)
  return { mode: 'scripted' as const, run, isRunning, runningAction, messages, undoLast, clearMessages, newChat }
}
