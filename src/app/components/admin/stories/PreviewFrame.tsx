import {useEffect, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'

/**
 * Renders children inside an iframe of a real width, with the app's styles copied in, so
 * responsive layouts (Tailwind breakpoints follow the iframe's width) look exactly as they will
 * on that device. Clicks on links are swallowed so the preview never navigates away.
 */
export function PreviewFrame({width, title, children}: {width: number | '100%'; title: string; children: ReactNode}) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [mount, setMount] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const doc = frame?.contentDocument
    if (!doc) return
    doc.open()
    doc.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#0a0a0b"><div id="preview-root"></div></body></html>')
    doc.close()
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.appendChild(node.cloneNode(true))
    const root = doc.getElementById('preview-root')!
    const block = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('a')) event.preventDefault()
    }
    doc.addEventListener('click', block, true)
    setMount(root)
    return () => doc.removeEventListener('click', block, true)
  }, [frame])

  return <div className="mx-auto overflow-hidden rounded-md border border-white/10 bg-[#0a0a0b]" style={{width: width === '100%' ? '100%' : `${width}px`, maxWidth: '100%'}}>
    <iframe ref={setFrame} title={title} className="block h-[70vh] w-full" />
    {mount && createPortal(children, mount)}
  </div>
}
