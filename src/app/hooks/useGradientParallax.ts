import {useEffect} from 'react'

type GradientParallaxOptions = {
  maxTranslatePx?: number
}

export function useGradientParallax(options: GradientParallaxOptions = {}) {
  const {maxTranslatePx = 18} = options

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const gradients = Array.from(document.querySelectorAll<HTMLElement>('.bg-gradient'))
    if (gradients.length === 0) return

    const onMouseMove = (event: MouseEvent) => {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const dx = (event.clientX - cx) / cx
      const dy = (event.clientY - cy) / cy

      gradients.forEach((el, index) => {
        const depth = (index + 1) / gradients.length
        const x = dx * maxTranslatePx * depth
        const y = dy * maxTranslatePx * depth
        el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
      })
    }

    window.addEventListener('mousemove', onMouseMove, {passive: true})
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [maxTranslatePx])
}
