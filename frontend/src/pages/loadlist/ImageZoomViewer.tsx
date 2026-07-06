import React, { useEffect, useRef, useState } from 'react'

interface ImageZoomViewerProps { src: string; onClose: () => void }

export function ImageZoomViewer({ src, onClose }: ImageZoomViewerProps) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging = useRef<{ x: number; y: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setScale(s => Math.min(8, s * 1.25))
      if (e.key === '-') setScale(s => Math.max(0.5, s / 1.25))
      if (e.key === '0') { setScale(1); setOffset({ x: 0, y: 0 }) }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setScale(s => Math.max(0.5, Math.min(8, s * factor)))
  }
  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    setOffset({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y })
  }
  const endDrag = () => { dragging.current = null }
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinch.current = { dist: Math.hypot(dx, dy), scale }
    } else if (e.touches.length === 1) {
      dragging.current = { x: e.touches[0].clientX - offset.x, y: e.touches[0].clientY - offset.y }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinch.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const d = Math.hypot(dx, dy)
      setScale(Math.max(0.5, Math.min(8, pinch.current.scale * (d / pinch.current.dist))))
    } else if (e.touches.length === 1 && dragging.current) {
      setOffset({ x: e.touches[0].clientX - dragging.current.x, y: e.touches[0].clientY - dragging.current.y })
    }
  }
  const onTouchEnd = () => { dragging.current = null; pinch.current = null }

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center touch-none" onClick={onClose}>
      <div className="absolute top-3 right-3 flex gap-2 z-10" onClick={e => e.stopPropagation()}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScale(s => Math.max(0.5, s / 1.25))}>−</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}>100%</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScale(s => Math.min(8, s * 1.25))}>+</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Sluiten</button>
      </div>
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
        onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={endDrag} onMouseLeave={endDrag}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onClick={e => e.stopPropagation()}
      >
        <img
          src={src} alt="Origineel vergroot" draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: dragging.current || pinch.current ? 'none' : 'transform 0.05s linear',
            maxWidth: 'none', maxHeight: 'none',
          }}
          className="pointer-events-none"
        />
      </div>
    </div>
  )
}
