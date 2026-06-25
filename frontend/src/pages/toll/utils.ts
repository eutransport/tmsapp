// Shared formatting utilities for toll registration pages

export function formatBedrag(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : value
  if (isNaN(num)) return '€0,00'
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(num)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}
