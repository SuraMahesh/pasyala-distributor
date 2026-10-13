import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

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
    return (words.length ? items.filter((t) => words.every((w) => search(t).toLowerCase().includes(w))) : items).slice(0, max)
  }, [q, items, getSearch, getLabel, max])

  useEffect(() => {
    listRef.current?.children[hi]?.scrollIntoView({ block: 'nearest' })
  }, [hi])

  const pick = (t: T) => {
    onChange(getId(t), t)
    setQ('')
    setOpen(false)
  }

  return (
    <div className={`relative ${className}`}>
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
      {open && (
        <ul ref={listRef} className="absolute z-30 mt-1 max-h-72 w-full min-w-[min(420px,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg" role="listbox">
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
        </ul>
      )}
    </div>
  )
}
