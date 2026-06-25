import { useState, useEffect, Fragment } from 'react'
import { Combobox, Transition } from '@headlessui/react'
import { CheckIcon, ChevronUpDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { getUsers } from '@/api/users'
import type { User } from '@/types'
import clsx from '@/utils/clsx'

interface UserComboboxProps {
  value: User | null
  onChange: (user: User | null) => void
  placeholder?: string
  disabled?: boolean
}

/**
 * Searchable user picker backed by GET /auth/users/?search=.
 * Debounced server-side search; shows full name + email.
 */
export default function UserCombobox({ value, onChange, placeholder, disabled }: UserComboboxProps) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await getUsers({ search: query, is_active: 'true', page_size: 20 })
        if (active) setUsers(res.results)
      } catch {
        if (active) setUsers([])
      } finally {
        if (active) setLoading(false)
      }
    }, 250)
    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [query])

  return (
    <Combobox value={value} onChange={onChange} disabled={disabled} nullable>
      <div className="relative">
        <div className="relative w-full cursor-default overflow-hidden rounded-lg border border-gray-300 bg-white text-left focus-within:ring-2 focus-within:ring-primary-500">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <Combobox.Input
            className="w-full border-none py-2.5 pl-10 pr-10 text-sm leading-5 text-gray-900 focus:ring-0 disabled:bg-gray-100"
            displayValue={(u: User | null) => u?.full_name || ''}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder || 'Zoek gebruiker...'}
          />
          <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="h-5 w-5 text-gray-400" />
          </Combobox.Button>
        </div>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          afterLeave={() => setQuery('')}
        >
          <Combobox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none">
            {loading && (
              <div className="px-4 py-2 text-gray-500">Laden...</div>
            )}
            {!loading && users.length === 0 && (
              <div className="px-4 py-2 text-gray-500">Geen gebruikers gevonden</div>
            )}
            {users.map((u) => (
              <Combobox.Option
                key={u.id}
                value={u}
                className={({ active }) =>
                  clsx(
                    'relative cursor-pointer select-none py-2 pl-10 pr-4',
                    active ? 'bg-primary-600 text-white' : 'text-gray-900'
                  )
                }
              >
                {({ selected, active }) => (
                  <>
                    <div className="flex flex-col">
                      <span className={clsx('truncate', selected ? 'font-semibold' : 'font-normal')}>
                        {u.full_name}
                      </span>
                      <span className={clsx('truncate text-xs', active ? 'text-primary-100' : 'text-gray-500')}>
                        {u.email}
                      </span>
                    </div>
                    {selected && (
                      <span className={clsx('absolute inset-y-0 left-0 flex items-center pl-3', active ? 'text-white' : 'text-primary-600')}>
                        <CheckIcon className="h-5 w-5" />
                      </span>
                    )}
                  </>
                )}
              </Combobox.Option>
            ))}
          </Combobox.Options>
        </Transition>
      </div>
    </Combobox>
  )
}
