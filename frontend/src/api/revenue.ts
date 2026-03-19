/**
 * Revenue & Expenses API
 */
import api from './client'

// Types
export interface Expense {
  id: string
  omschrijving: string
  categorie: string
  categorie_display: string
  bedrag: number
  btw_bedrag: number
  totaal: number
  datum: string
  bedrijf?: string
  bedrijf_naam?: string
  voertuig?: string
  voertuig_kenteken?: string
  chauffeur?: string
  chauffeur_naam?: string
  notities: string
  bijlage?: string
  created_by?: string
  created_by_naam?: string
  created_at: string
  updated_at: string
}

export interface ExpenseCategory {
  value: string
  label: string
}

export interface CreateExpenseData {
  omschrijving: string
  categorie: string
  bedrag: number
  btw_bedrag?: number
  totaal?: number
  datum: string
  bedrijf?: string
  voertuig?: string
  chauffeur?: string
  notities?: string
  bijlage?: File
}

export interface ExpenseSummaryItem {
  categorie: string
  categorie_display: string
  totaal: number
  aantal: number
}

export interface RevenueDataPoint {
  period: string
  label: string
  income: number
  credit: number
  expenses: number
  profit: number
}

export interface RevenueResponse {
  period_type: 'week' | 'month' | 'quarter' | 'year'
  year: number
  start_date: string
  end_date: string
  data: RevenueDataPoint[]
  totals: {
    income: number
    credit: number
    expenses: number
    profit: number
    collected: number
    outstanding: number
  }
  summary: {
    avg_income: number
    avg_expenses: number
    avg_profit: number
    profit_margin: number
  }
}

export interface ForecastPeriod {
  income: number
  expenses: number
  profit: number
}

export interface ForecastResponse {
  lookback_months: number
  data_months: number
  avg_monthly_income: number
  avg_monthly_expenses: number
  avg_monthly_profit: number
  trend: 'up' | 'down' | 'stable'
  forecast: {
    month: ForecastPeriod
    quarter: ForecastPeriod
    half_year: ForecastPeriod
    year: ForecastPeriod
  }
  monthly_trend: {
    month: string
    income: number
    expenses: number
    profit: number
  }[]
}

// Expenses API
export const expensesApi = {
  getAll: async (params?: { 
    categorie?: string
    start_date?: string
    end_date?: string
    search?: string 
  }): Promise<Expense[]> => {
    const response = await api.get('/invoicing/expenses/', { params })
    return response.data.results || response.data
  },

  getOne: async (id: string): Promise<Expense> => {
    const response = await api.get(`/invoicing/expenses/${id}/`)
    return response.data
  },

  create: async (data: CreateExpenseData): Promise<Expense> => {
    // Use FormData if there's a file
    if (data.bijlage) {
      const formData = new FormData()
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (value instanceof File) {
            formData.append(key, value)
          } else {
            formData.append(key, String(value))
          }
        }
      })
      const response = await api.post('/invoicing/expenses/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      return response.data
    }
    
    const response = await api.post('/invoicing/expenses/', data)
    return response.data
  },

  update: async (id: string, data: Partial<CreateExpenseData>): Promise<Expense> => {
    const response = await api.patch(`/invoicing/expenses/${id}/`, data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/invoicing/expenses/${id}/`)
  },

  getCategories: async (): Promise<ExpenseCategory[]> => {
    const response = await api.get('/invoicing/expenses/categories/')
    return response.data
  },

  getSummary: async (startDate?: string, endDate?: string): Promise<ExpenseSummaryItem[]> => {
    const params: any = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    const response = await api.get('/invoicing/expenses/summary/', { params })
    return response.data
  },
}

// Revenue API
export const revenueApi = {
  getData: async (params: {
    period?: 'week' | 'month' | 'quarter' | 'year'
    year?: number
  }): Promise<RevenueResponse> => {
    const response = await api.get('/invoicing/revenue/', { params })
    return response.data
  },

  getYears: async (): Promise<number[]> => {
    const response = await api.get('/invoicing/revenue/years/')
    return response.data.years
  },

  getForecast: async (): Promise<ForecastResponse> => {
    const response = await api.get('/invoicing/revenue/forecast/')
    return response.data
  },
}
