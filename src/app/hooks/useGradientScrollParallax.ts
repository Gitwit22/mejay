import {useEffect} from 'react'

export function useGradientScrollParallax() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const gradients = Array.from(document.querySelectorAll<HTMLElement>('.mejay-about .bg-gradient'))
    if (gradients.length === 0) return

    let ticking = false

    const onScroll = () => {
      if (ticking) return

      ticking = true
      window.requestAnimationFrame(() => {
        const scrolled = window.pageYOffset || 0

        gradients.forEach((gradient, index) => {
          const speed = (index + 1) * 0.1
          gradient.style.transform = `translate3d(0, ${(scrolled * speed).toFixed(2)}px, 0)`
        })

        ticking = false
      })
    }

    document.addEventListener('scroll', onScroll, {passive: true})
    onScroll()

    return () => {
      document.removeEventListener('scroll', onScroll)
    }
  }, [])
}
