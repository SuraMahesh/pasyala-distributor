import { ChevronDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Searchable select. Type any part of the code/name (several words OK), use ↑ ↓ Enter.
 */
export default function Combobox<T>({
  items,
  value,
  onChange,
  getId,
  getLabel,
  getSearch,
  renderItem,
  placeholder = 'Search…',
  autoFocus,
  disabled,
  className = '',
  emptyText = 'No match',
  max = 80,
}: {
  items: T[]
  value: number | null | undefined
  onChange: (id: number, item: T) => void
  getId: (t: T) => number
  getLabel: (t: T) => string
  getSearch?: (t: T) => string
  renderItem?: (t: T, active: boolean) => ReactNode
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  className?: string
  emptyText?: string
  max?: number
}) {
  const selected = items.find((t) => getId(t) === value)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const search = getSearch ?? getLabel
    if (!words.length) return items.slice(0, max)
    const query = words.join(' ')
    // best matches first: an exact code / word (THMN0030 before THMN0030-2), then a word that starts with the text, then anything containing it
    const rank = (t: T) => {
      const s = search(t).toLowerCase()
      const tokens = s.split(/\s+/)
      if (tokens.includes(query) || getLabel(t).toLowerCase() === query) return 0
      if (s.startsWith(query) || tokens.some((w) => w.startsWith(query))) return 1
      return 2
    }
    return items
      .filter((t) => words.every((w) => search(t).toLowerCase().includes(w)))
      .map((t, i) => ({ t, r: rank(t), i }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, max)
      .map((x) => x.t)
  }, [q, items, getSearch, getLabel, max])

  // the list is drawn in a portal with a fixed position, so a modal body or the phone's sticky totals bar cannot clip or cover it
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number; up: boolean } | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect()
      if (!r) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const width = Math.max(r.width, Math.min(420, vw - 32))
      const left = Math.max(8, Math.min(r.left, vw - width - 8))
      const below = vh - r.bottom - 8
      const up = below < 180 && r.top > below
      setBox({ left, width, up, top: up ? r.top - 4 : r.bottom + 4, maxHeight: Math.min(288, up ? r.top - 12 : below) })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open])

  useEffect(() => {
    listRef.current?.children[hi]?.scrollIntoView({ block: 'nearest' })
  }, [hi])

  const pick = (t: T) => {
    onChange(getId(t), t)
    setQ('')
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        autoFocus={autoFocus}
        disabled={disabled}
        className="input pr-8"
        placeholder={selected ? getLabel(selected) : placeholder}
        value={open ? q : selected ? getLabel(selected) : ''}
        onFocus={(e) => {
          setOpen(true)
          setHi(0)
          e.target.select()
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setHi(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHi((h) => Math.min(h + 1, list.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open && list[hi]) {
            e.preventDefault()
            pick(list[hi])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        role="combobox"
        aria-expanded={open}
      />
      <ChevronDown size={16} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-stone-400" />
      {open && box && createPortal(
        <ul
          ref={listRef}
          role="listbox"
          className="fixed z-[60] overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
          style={{ left: box.left, width: box.width, maxHeight: box.maxHeight, ...(box.up ? { bottom: window.innerHeight - box.top } : { top: box.top }) }}
        >
          {list.length === 0 && <li className="px-3 py-2 text-sm text-stone-500">{emptyText}</li>}
          {list.map((t, i) => (
            <li
              key={getId(t)}
              role="option"
              aria-selected={getId(t) === value}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(t)
              }}
              onMouseEnter={() => setHi(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === hi ? 'bg-brand-50' : ''}`}
            >
              {renderItem ? renderItem(t, i === hi) : getLabel(t)}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  )
}
