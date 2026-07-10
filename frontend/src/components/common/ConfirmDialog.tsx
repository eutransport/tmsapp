/**
 * Herbruikbare bevestigingsdialoog. Vervangt het lelijke browser-`confirm()`.
 *
 * Gebruik:
 *   const [state, setState] = useState<ConfirmState>(null)
 *   ...
 *   <ConfirmDialog
 *     state={state}
 *     onClose={() => setState(null)}
 *   />
 *
 * Openen:
 *   setState({
 *     title: 'Verwijderen?',
 *     message: 'Weet je het zeker?',
 *     variant: 'danger',
 *     onConfirm: async () => { ... },
 *   })
 */
import { Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { ExclamationTriangleIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline'

export type ConfirmVariant = 'danger' | 'warning' | 'info'

export interface ConfirmState {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
  onConfirm: () => void | Promise<void>
}

interface Props {
  state: ConfirmState | null
  onClose: () => void
}

export default function ConfirmDialog({ state, onClose }: Props) {
  const open = state !== null
  const variant = state?.variant || 'warning'

  const handleConfirm = async () => {
    if (!state) return
    try {
      await state.onConfirm()
    } finally {
      onClose()
    }
  }

  const iconWrap =
    variant === 'danger'
      ? 'bg-red-100 text-red-600'
      : variant === 'info'
        ? 'bg-primary-100 text-primary-600'
        : 'bg-amber-100 text-amber-600'
  const confirmBtn =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
      : variant === 'info'
        ? 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500'
        : 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
  const Icon = variant === 'info' ? QuestionMarkCircleIcon : ExclamationTriangleIcon

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-150"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-150"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-100"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md rounded-lg bg-white shadow-xl">
                <div className="p-5 sm:p-6">
                  <div className="sm:flex sm:items-start">
                    <div className={`mx-auto flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full sm:mx-0 sm:h-10 sm:w-10 ${iconWrap}`}>
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left flex-1">
                      <Dialog.Title as="h3" className="text-base font-semibold text-gray-900">
                        {state?.title}
                      </Dialog.Title>
                      <div className="mt-2 text-sm text-gray-600">
                        {state?.message}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col-reverse gap-2 rounded-b-lg bg-gray-50 px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  >
                    {state?.cancelLabel || 'Annuleren'}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 ${confirmBtn}`}
                  >
                    {state?.confirmLabel || 'Bevestigen'}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
