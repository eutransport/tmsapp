import { useEffect, useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, Transition } from '@headlessui/react'
import { ClipboardDocumentCheckIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { getActiveTaskCount } from '@/api/tasks'

const SESSION_KEY = 'tms_task_popup_shown'

/**
 * Toont eenmalig per sessie een melding wanneer de gebruiker openstaande taken heeft.
 */
export default function ActiveTasksPopup() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [nieuw, setNieuw] = useState(0)

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return
    let cancelled = false
    const check = async () => {
      try {
        const res = await getActiveTaskCount()
        if (cancelled) return
        sessionStorage.setItem(SESSION_KEY, '1')
        if (res.open > 0) {
          setCount(res.open)
          setNieuw(res.nieuw)
          setOpen(true)
        }
      } catch {
        // stil falen — geen popup
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  const goToTasks = () => {
    setOpen(false)
    navigate('/tasks')
  }

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[60]" onClose={setOpen}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/50" />
        </Transition.Child>
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
              <Dialog.Panel className="w-full max-w-sm transform rounded-xl bg-white p-6 shadow-xl transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100">
                    <ClipboardDocumentCheckIcon className="h-6 w-6 text-primary-600" />
                  </div>
                  <button onClick={() => setOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <Dialog.Title className="mt-4 text-lg font-semibold text-gray-900">
                  {t('tasks.popup.title')}
                </Dialog.Title>
                <p className="mt-2 text-sm text-gray-600">
                  {t('tasks.popup.body', { count, nieuw })}
                </p>
                <div className="mt-6 flex justify-end gap-3">
                  <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    {t('tasks.popup.dismiss')}
                  </button>
                  <button onClick={goToTasks} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
                    {t('tasks.popup.view')}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}
