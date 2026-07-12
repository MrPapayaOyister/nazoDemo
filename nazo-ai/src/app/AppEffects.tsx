import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'

/** Syncs theme + language/direction to <html>, and registers the router
 *  navigator so AI `navigate` side-effects can route. Renders nothing. */
export function AppEffects() {
  const theme = useStore((s) => s.ui.theme)
  const lang = useStore((s) => s.ui.lang)
  const setNavigator = useStore((s) => s.setNavigator)
  const navigate = useNavigate()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    const el = document.documentElement
    el.setAttribute('lang', lang)
    el.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
  }, [lang])

  useEffect(() => {
    setNavigator((to: string) => navigate(to))
  }, [navigate, setNavigator])

  return null
}
