import { useState, useEffect, Fragment, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition, Combobox } from '@headlessui/react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  PlusIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  CheckCircleIcon,
  PlayCircleIcon,
  ArrowPathIcon,
  BellAlertIcon,
  ChatBubbleLeftRightIcon,
  UserPlusIcon,
  ClipboardDocumentListIcon,
  CalendarIcon,
  PencilSquareIcon,
  ArrowTopRightOnSquareIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import clsx from '@/utils/clsx'
import {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  changeTaskStatus,
  reassignTask,
  addTaskNote,
  sendTaskReminder,
  downloadTaskAttachment,
  Task,
  TaskListItem,
  TaskTab,
  TaskStatus,
  TaskPriority,
} from '@/api/tasks'
import { getUsers } from '@/api/users'
import { getInvoices } from '@/api/invoices'

const STATUS_COLORS: Record<TaskStatus, string> = {
  nieuw: 'bg-gray-100 text-gray-800',
  in_behandeling: 'bg-amber-100 text-amber-800',
  afgerond: 'bg-green-100 text-green-800',
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  laag: 'bg-slate-100 text-slate-600',
  normaal: 'bg-blue-100 text-blue-700',
  hoog: 'bg-red-100 text-red-700',
}

interface SimpleUser {
  id: string
  full_name: string
  email: string
}

interface SimpleInvoice {
  id: string
  factuurnummer: string
}

export default function TasksPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthStore()
  const isAdmin = user?.rol === 'admin'
  const canManage = isAdmin || (user?.module_permissions?.includes('manage_tasks') ?? false)
  const canViewInvoices = isAdmin || user?.rol === 'gebruiker' || (user?.module_permissions?.includes('view_invoices') ?? false)

  const [tab, setTab] = useState<TaskTab>('mine')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [loading, setLoading] = useState(true)

  // Create/edit modal
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [formTitel, setFormTitel] = useState('')
  const [formOmschrijving, setFormOmschrijving] = useState('')
  const [formPrioriteit, setFormPrioriteit] = useState<TaskPriority>('normaal')
  const [formVervaldatum, setFormVervaldatum] = useState('')
  const [formAssignee, setFormAssignee] = useState<SimpleUser | null>(null)
  const [formInvoice, setFormInvoice] = useState<SimpleInvoice | null>(null)
  const [formBijlage, setFormBijlage] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  // Detail panel
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [noteInput, setNoteInput] = useState('')
  const [showReassign, setShowReassign] = useState(false)

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<TaskListItem | null>(null)

  // User search for combobox
  const [userQuery, setUserQuery] = useState('')
  const [userOptions, setUserOptions] = useState<SimpleUser[]>([])
  const [invoiceQuery, setInvoiceQuery] = useState('')
  const [invoiceOptions, setInvoiceOptions] = useState<SimpleInvoice[]>([])

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTasks({ tab, status: statusFilter, search, page_size: 100 })
      setTasks(res.results)
    } catch {
      toast.error(t('tasks.toast.error'))
    } finally {
      setLoading(false)
    }
  }, [tab, statusFilter, search, t])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // Debounce search
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput), 350)
    return () => clearTimeout(h)
  }, [searchInput])

  // User search (debounced)
  useEffect(() => {
    if (!canManage) return
    const h = setTimeout(async () => {
      try {
        const res = await getUsers({ search: userQuery, page_size: 20, is_active: 'true' })
        const list = res.results ?? []
        setUserOptions(
          list.map((u) => ({
            id: u.id,
            full_name: u.full_name || `${u.voornaam ?? ''} ${u.achternaam ?? ''}`.trim() || u.email,
            email: u.email,
          }))
        )
      } catch {
        // ignore
      }
    }, 300)
    return () => clearTimeout(h)
  }, [userQuery, canManage])

  // Invoice search (debounced)
  useEffect(() => {
    if (!canViewInvoices || !showFormModal) return
    const h = setTimeout(async () => {
      try {
        const res = await getInvoices({ search: invoiceQuery, page_size: 20, ordering: '-factuurdatum' })
        const list = res.results ?? []
        setInvoiceOptions(
          list.map((inv) => ({
            id: inv.id,
            factuurnummer: inv.factuurnummer,
          }))
        )
      } catch {
        // ignore
      }
    }, 300)
    return () => clearTimeout(h)
  }, [invoiceQuery, canViewInvoices, showFormModal])

  const availableTabs: { key: TaskTab; label: string }[] = [
    { key: 'mine', label: t('tasks.tabs.mine') },
    ...(canManage ? [{ key: 'assigned_by_me' as TaskTab, label: t('tasks.tabs.assignedByMe') }] : []),
    ...(isAdmin ? [{ key: 'all' as TaskTab, label: t('tasks.tabs.all') }] : []),
  ]

  const openCreate = () => {
    setEditingTask(null)
    setFormTitel('')
    setFormOmschrijving('')
    setFormPrioriteit('normaal')
    setFormVervaldatum('')
    setFormAssignee(null)
    setFormInvoice(null)
    setFormBijlage(null)
    setInvoiceQuery('')
    setShowFormModal(true)
  }

  const openEdit = (task: Task) => {
    setEditingTask(task)
    setFormTitel(task.titel)
    setFormOmschrijving(task.omschrijving)
    setFormPrioriteit(task.prioriteit)
    setFormVervaldatum(task.vervaldatum ? task.vervaldatum.slice(0, 10) : '')
    setFormInvoice(task.factuur ? { id: task.factuur.id, factuurnummer: task.factuur.factuurnummer } : null)
    setFormBijlage(null)
    setInvoiceQuery('')
    setShowFormModal(true)
  }

  const handleSave = async () => {
    if (!formTitel.trim()) return
    setSaving(true)
    try {
      if (editingTask) {
        await updateTask(editingTask.id, {
          titel: formTitel.trim(),
          omschrijving: formOmschrijving,
          prioriteit: formPrioriteit,
          factuur_id: canViewInvoices ? (formInvoice?.id ?? null) : undefined,
          bijlage: formBijlage,
          vervaldatum: formVervaldatum || null,
        })
        toast.success(t('tasks.toast.updated'))
        if (detailTask?.id === editingTask.id) {
          openDetail(editingTask.id)
        }
      } else {
        await createTask({
          titel: formTitel.trim(),
          omschrijving: formOmschrijving,
          prioriteit: formPrioriteit,
          factuur_id: canViewInvoices ? (formInvoice?.id ?? null) : undefined,
          bijlage: formBijlage,
          vervaldatum: formVervaldatum || null,
          toegewezen_aan_id: canManage && formAssignee ? formAssignee.id : null,
        })
        toast.success(t('tasks.toast.created'))
      }
      setShowFormModal(false)
      fetchTasks()
    } catch {
      toast.error(t('tasks.toast.error'))
    } finally {
      setSaving(false)
    }
  }

  const openDetail = useCallback(async (id: string, syncUrl = true) => {
    setDetailLoading(true)
    setShowReassign(false)
    if (syncUrl) {
      const next = new URLSearchParams(searchParams)
      next.set('task', id)
      setSearchParams(next, { replace: true })
    }
    try {
      const task = await getTask(id)
      setDetailTask(task)
    } catch {
      toast.error(t('tasks.toast.error'))
    } finally {
      setDetailLoading(false)
    }
  }, [searchParams, setSearchParams, t])

  const closeDetail = useCallback(() => {
    setDetailTask(null)
    const next = new URLSearchParams(searchParams)
    next.delete('task')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const taskId = searchParams.get('task')
    if (taskId && taskId !== detailTask?.id) {
      openDetail(taskId, false)
      return
    }
    if (!taskId && detailTask) {
      setDetailTask(null)
    }
  }, [searchParams, detailTask, openDetail])

  const handleStatusChange = async (task: Task | TaskListItem, status: TaskStatus) => {
    try {
      await changeTaskStatus(task.id, status)
      toast.success(t('tasks.toast.statusChanged'))
      fetchTasks()
      if (detailTask?.id === task.id) openDetail(task.id)
    } catch {
      toast.error(t('tasks.toast.error'))
    }
  }

  const handleAddNote = async () => {
    if (!detailTask || !noteInput.trim()) return
    try {
      await addTaskNote(detailTask.id, noteInput.trim())
      setNoteInput('')
      toast.success(t('tasks.toast.noteAdded'))
      openDetail(detailTask.id)
      fetchTasks()
    } catch {
      toast.error(t('tasks.toast.error'))
    }
  }

  const handleReassign = async (u: SimpleUser | null) => {
    if (!detailTask || !u) return
    try {
      await reassignTask(detailTask.id, u.id)
      toast.success(t('tasks.toast.reassigned'))
      setShowReassign(false)
      openDetail(detailTask.id)
      fetchTasks()
    } catch {
      toast.error(t('tasks.toast.error'))
    }
  }

  const handleReminder = async (task: Task) => {
    try {
      await sendTaskReminder(task.id)
      toast.success(t('tasks.toast.reminderSent'))
    } catch {
      toast.error(t('tasks.toast.error'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteTask(deleteTarget.id)
      toast.success(t('tasks.toast.deleted'))
      setDeleteTarget(null)
      if (detailTask?.id === deleteTarget.id) closeDetail()
      fetchTasks()
    } catch {
      toast.error(t('tasks.toast.error'))
    }
  }

  const handleDownloadAttachment = async (task: Task) => {
    try {
      const blob = await downloadTaskAttachment(task.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = task.bijlage_naam || 'bijlage'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error(t('tasks.toast.error'))
    }
  }

  const formatDate = (d: string | null) => {
    if (!d) return '—'
    return new Date(d).toLocaleDateString()
  }

  const StatusBadge = ({ status }: { status: TaskStatus }) => (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[status])}>
      {t(`tasks.status.${status}`)}
    </span>
  )

  const PriorityBadge = ({ priority }: { priority: TaskPriority }) => (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', PRIORITY_COLORS[priority])}>
      {t(`tasks.priority.${priority}`)}
    </span>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardDocumentListIcon className="h-7 w-7 text-primary-600" />
            {t('tasks.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t('tasks.subtitle')}</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 transition-colors"
        >
          <PlusIcon className="h-5 w-5" />
          {t('tasks.newTask')}
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4 overflow-x-auto">
          {availableTabs.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={clsx(
                'whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                tab === tabItem.key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              )}
            >
              {tabItem.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('tasks.placeholders.search')}
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-primary-500 focus:ring-primary-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatus | '')}
          className="rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
        >
          <option value="">{t('tasks.filterStatus')}</option>
          <option value="nieuw">{t('tasks.status.nieuw')}</option>
          <option value="in_behandeling">{t('tasks.status.in_behandeling')}</option>
          <option value="afgerond">{t('tasks.status.afgerond')}</option>
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-16 text-center">
          <ClipboardDocumentListIcon className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-900">{t('tasks.noTasks')}</p>
          <p className="mt-1 text-sm text-gray-500">{t('tasks.noTasksHint')}</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{t('tasks.fields.titel')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{t('tasks.fields.status')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{t('tasks.fields.prioriteit')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{t('tasks.fields.toegewezenAan')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{t('tasks.fields.vervaldatum')}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {tasks.map((task) => (
                  <tr
                    key={task.id}
                    onClick={() => openDetail(task.id)}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{task.titel}</div>
                      {task.notes_count > 0 && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                          <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" />
                          {task.notes_count}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
                    <td className="px-4 py-3"><PriorityBadge priority={task.prioriteit} /></td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {task.toegewezen_aan?.full_name ?? <span className="text-gray-400">{t('tasks.unassigned')}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(task.vervaldatum)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {task.status !== 'afgerond' ? (
                          <button
                            onClick={() => handleStatusChange(task, 'afgerond')}
                            title={t('tasks.markDone')}
                            className="rounded p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600"
                          >
                            <CheckCircleIcon className="h-5 w-5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusChange(task, 'nieuw')}
                            title={t('tasks.reopen')}
                            className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <ArrowPathIcon className="h-5 w-5" />
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteTarget(task)}
                          title={t('tasks.delete')}
                          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => openDetail(task.id)}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm active:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-gray-900">{task.titel}</h3>
                  <StatusBadge status={task.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <PriorityBadge priority={task.prioriteit} />
                  {task.toegewezen_aan && (
                    <span className="inline-flex items-center gap-1">
                      <UserPlusIcon className="h-3.5 w-3.5" />
                      {task.toegewezen_aan.full_name}
                    </span>
                  )}
                  {task.vervaldatum && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {formatDate(task.vervaldatum)}
                    </span>
                  )}
                  {task.notes_count > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" />
                      {task.notes_count}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create / Edit Modal */}
      <Transition.Root show={showFormModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={setShowFormModal}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-900/50" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 sm:items-center">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 translate-y-4 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:scale-95">
                <Dialog.Panel className="relative w-full max-w-lg transform rounded-xl bg-white p-6 shadow-xl transition-all">
                  <div className="flex items-center justify-between">
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      {editingTask ? t('tasks.editTask') : t('tasks.newTask')}
                    </Dialog.Title>
                    <button onClick={() => setShowFormModal(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">{t('tasks.fields.titel')}</label>
                      <input
                        type="text"
                        value={formTitel}
                        onChange={(e) => setFormTitel(e.target.value)}
                        placeholder={t('tasks.placeholders.titel')}
                        className="mt-1 w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">{t('tasks.fields.omschrijving')}</label>
                      <textarea
                        value={formOmschrijving}
                        onChange={(e) => setFormOmschrijving(e.target.value)}
                        placeholder={t('tasks.placeholders.omschrijving')}
                        rows={3}
                        className="mt-1 w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">{t('tasks.fields.prioriteit')}</label>
                        <select
                          value={formPrioriteit}
                          onChange={(e) => setFormPrioriteit(e.target.value as TaskPriority)}
                          className="mt-1 w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                        >
                          <option value="laag">{t('tasks.priority.laag')}</option>
                          <option value="normaal">{t('tasks.priority.normaal')}</option>
                          <option value="hoog">{t('tasks.priority.hoog')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">{t('tasks.fields.vervaldatum')}</label>
                        <input
                          type="date"
                          value={formVervaldatum}
                          onChange={(e) => setFormVervaldatum(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    {/* Assignee combobox - only for managers and only on create */}
                    {canManage && !editingTask && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">{t('tasks.fields.toegewezenAan')}</label>
                        <Combobox value={formAssignee} onChange={setFormAssignee} nullable>
                          <div className="relative mt-1">
                            <Combobox.Input
                              className="w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                              placeholder={t('tasks.placeholders.searchUser')}
                              displayValue={(u: SimpleUser | null) => u?.full_name ?? ''}
                              onChange={(e) => setUserQuery(e.target.value)}
                            />
                            <Combobox.Options className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
                              <Combobox.Option value={null} className={({ active }) => clsx('cursor-pointer px-3 py-2', active && 'bg-primary-50')}>
                                <span className="text-gray-400">{t('tasks.unassigned')}</span>
                              </Combobox.Option>
                              {userOptions.map((u) => (
                                <Combobox.Option key={u.id} value={u} className={({ active }) => clsx('cursor-pointer px-3 py-2', active && 'bg-primary-50')}>
                                  <div className="font-medium text-gray-900">{u.full_name}</div>
                                  <div className="text-xs text-gray-500">{u.email}</div>
                                </Combobox.Option>
                              ))}
                            </Combobox.Options>
                          </div>
                        </Combobox>
                      </div>
                    )}

                    {canViewInvoices && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">{t('tasks.fields.factuur')}</label>
                        <Combobox value={formInvoice} onChange={setFormInvoice} nullable>
                          <div className="relative mt-1">
                            <Combobox.Input
                              className="w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                              placeholder={t('tasks.placeholders.searchInvoice')}
                              displayValue={(inv: SimpleInvoice | null) => inv?.factuurnummer ?? ''}
                              onChange={(e) => setInvoiceQuery(e.target.value)}
                            />
                            <Combobox.Options className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
                              <Combobox.Option value={null} className={({ active }) => clsx('cursor-pointer px-3 py-2', active && 'bg-primary-50')}>
                                <span className="text-gray-400">{t('tasks.unassigned')}</span>
                              </Combobox.Option>
                              {invoiceOptions.map((inv) => (
                                <Combobox.Option key={inv.id} value={inv} className={({ active }) => clsx('cursor-pointer px-3 py-2', active && 'bg-primary-50')}>
                                  <div className="font-medium text-gray-900">{inv.factuurnummer}</div>
                                </Combobox.Option>
                              ))}
                            </Combobox.Options>
                          </div>
                        </Combobox>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700">{t('tasks.fields.bijlage')}</label>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(e) => setFormBijlage(e.target.files?.[0] || null)}
                        className="mt-1 w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button onClick={() => setShowFormModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      {t('tasks.cancel')}
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || !formTitel.trim()}
                      className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {editingTask ? t('tasks.save') : t('tasks.create')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Detail panel (fullscreen) */}
      <Transition.Root show={!!detailTask} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={closeDetail}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-900/50" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-start justify-center p-4 md:p-8">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 translate-y-2" enterTo="opacity-100 translate-y-0" leave="ease-in duration-150" leaveFrom="opacity-100 translate-y-0" leaveTo="opacity-0 translate-y-2">
                <Dialog.Panel className="w-full max-w-6xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
                  {detailTask && (
                    <>
                      <div className="border-b border-gray-200 px-6 py-4 md:px-8">
                        <div className="flex items-start justify-between gap-2">
                          <Dialog.Title className="text-xl font-semibold text-gray-900">{detailTask.titel}</Dialog.Title>
                          <button onClick={closeDetail} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                            <XMarkIcon className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <StatusBadge status={detailTask.status} />
                          <PriorityBadge priority={detailTask.prioriteit} />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-3 md:p-8">
                        <div className="md:col-span-2 space-y-5">
                          {detailLoading && (
                            <div className="flex justify-center py-4">
                              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary-600" />
                            </div>
                          )}

                          {detailTask.omschrijving && (
                            <p className="whitespace-pre-wrap text-sm text-gray-700">{detailTask.omschrijving}</p>
                          )}

                          <div>
                            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                              <ChatBubbleLeftRightIcon className="h-4 w-4" />
                              {t('tasks.notes')}
                            </h4>
                            <div className="mt-3 space-y-3">
                              {detailTask.notes.length === 0 ? (
                                <p className="text-sm text-gray-400">{t('tasks.noNotes')}</p>
                              ) : (
                                detailTask.notes.map((note) => (
                                  <div key={note.id} className="rounded-lg bg-gray-50 p-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-gray-700">{note.auteur?.full_name ?? '—'}</span>
                                      <span className="text-xs text-gray-400">{new Date(note.created_at).toLocaleString()}</span>
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{note.tekst}</p>
                                  </div>
                                ))
                              )}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <input
                                type="text"
                                value={noteInput}
                                onChange={(e) => setNoteInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                                placeholder={t('tasks.placeholders.note')}
                                className="flex-1 rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                              />
                              <button
                                onClick={handleAddNote}
                                disabled={!noteInput.trim()}
                                className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                              >
                                {t('tasks.addNote')}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <dl className="grid grid-cols-1 gap-3 text-sm">
                            <div>
                              <dt className="text-gray-500">{t('tasks.fields.toegewezenAan')}</dt>
                              <dd className="font-medium text-gray-900">{detailTask.toegewezen_aan?.full_name ?? t('tasks.unassigned')}</dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">{t('tasks.fields.aangemaaktDoor')}</dt>
                              <dd className="font-medium text-gray-900">{detailTask.aangemaakt_door?.full_name ?? '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">{t('tasks.fields.vervaldatum')}</dt>
                              <dd className="font-medium text-gray-900">{formatDate(detailTask.vervaldatum)}</dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">{t('tasks.createdAt')}</dt>
                              <dd className="font-medium text-gray-900">{formatDate(detailTask.created_at)}</dd>
                            </div>
                          </dl>

                          <div className="flex flex-wrap gap-2">
                            {detailTask.status !== 'in_behandeling' && detailTask.status !== 'afgerond' && (
                              <button onClick={() => handleStatusChange(detailTask, 'in_behandeling')} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100">
                                <PlayCircleIcon className="h-4 w-4" />
                                {t('tasks.markInProgress')}
                              </button>
                            )}
                            {detailTask.status !== 'afgerond' && (
                              <button onClick={() => handleStatusChange(detailTask, 'afgerond')} className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100">
                                <CheckCircleIcon className="h-4 w-4" />
                                {t('tasks.markDone')}
                              </button>
                            )}
                            {detailTask.status === 'afgerond' && (
                              <button onClick={() => handleStatusChange(detailTask, 'nieuw')} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100">
                                <ArrowPathIcon className="h-4 w-4" />
                                {t('tasks.reopen')}
                              </button>
                            )}
                            <button onClick={() => openEdit(detailTask)} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200">
                              <PencilSquareIcon className="h-4 w-4" />
                              {t('tasks.editTask')}
                            </button>
                          </div>

                          {canViewInvoices && detailTask.factuur && (
                            <button
                              onClick={() => navigate(`/invoices/${detailTask.factuur!.id}/edit?fromTask=${detailTask.id}`)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                              {detailTask.factuur.factuurnummer}
                            </button>
                          )}

                          {detailTask.bijlage_url && (
                            <button
                              onClick={() => handleDownloadAttachment(detailTask)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              <PaperClipIcon className="h-4 w-4" />
                              {detailTask.bijlage_naam || t('tasks.fields.bijlage')}
                            </button>
                          )}

                          {canManage && (
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => setShowReassign((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                                <UserPlusIcon className="h-4 w-4" />
                                {t('tasks.reassign')}
                              </button>
                              {detailTask.toegewezen_aan && (
                                <button onClick={() => handleReminder(detailTask)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                                  <BellAlertIcon className="h-4 w-4" />
                                  {t('tasks.sendReminder')}
                                </button>
                              )}
                            </div>
                          )}

                          {canManage && showReassign && (
                            <Combobox value={null} onChange={handleReassign}>
                              <div className="relative">
                                <Combobox.Input
                                  className="w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-primary-500 focus:ring-primary-500"
                                  placeholder={t('tasks.placeholders.searchUser')}
                                  onChange={(e) => setUserQuery(e.target.value)}
                                />
                                <Combobox.Options className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
                                  {userOptions.map((u) => (
                                    <Combobox.Option key={u.id} value={u} className={({ active }) => clsx('cursor-pointer px-3 py-2', active && 'bg-primary-50')}>
                                      <div className="font-medium text-gray-900">{u.full_name}</div>
                                      <div className="text-xs text-gray-500">{u.email}</div>
                                    </Combobox.Option>
                                  ))}
                                </Combobox.Options>
                              </div>
                            </Combobox>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Delete confirmation */}
      <Transition.Root show={!!deleteTarget} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setDeleteTarget(null)}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-900/50" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-sm transform rounded-xl bg-white p-6 shadow-xl transition-all">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">{t('tasks.delete')}</Dialog.Title>
                  <p className="mt-2 text-sm text-gray-600">{t('tasks.deleteConfirm')}</p>
                  <div className="mt-6 flex justify-end gap-3">
                    <button onClick={() => setDeleteTarget(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      {t('tasks.cancel')}
                    </button>
                    <button onClick={handleDelete} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
                      {t('tasks.delete')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>
    </div>
  )
}
