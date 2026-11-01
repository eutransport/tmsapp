import { useThemeStore, themes, Theme } from '@/stores/themeStore'
import { CheckCircleIcon, SwatchIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'

export default function ThemeSelector() {
  const { t } = useTranslation()
  const { currentTheme, setTheme } = useThemeStore()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
          <SwatchIcon className="h-5 w-5" />
          {t('settings.colorTheme')}
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          {t('settings.chooseColorCombination')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            isSelected={currentTheme.id === theme.id}
            onSelect={() => setTheme(theme.id)}
          />
        ))}
      </div>
    </div>
  )
}

interface ThemeCardProps {
  theme: Theme
  isSelected: boolean
  onSelect: () => void
}

function ThemeCard({ theme, isSelected, onSelect }: ThemeCardProps) {
  const { t } = useTranslation()
  
  return (
    <button
      onClick={onSelect}
      className={`
        relative p-4 rounded-lg border-2 transition-all text-left
        ${isSelected 
          ? 'border-royal-500 ring-2 ring-royal-200' 
          : 'border-gray-200 hover:border-gray-300'
        }
      `}
      style={{ backgroundColor: theme.colors.backgroundSecondary }}
    >
      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2">
          <CheckCircleIcon className="h-5 w-5 text-royal-500" />
        </div>
      )}

      {/* Theme name */}
      <div 
        className="font-medium text-sm mb-3"
        style={{ color: theme.colors.text }}
      >
        {t(theme.nameKey)}
      </div>

      {/* Color preview */}
      <div className="space-y-2">
        {/* Sidebar preview */}
        <div className="flex items-center gap-2">
          <div 
            className="w-8 h-6 rounded"
            style={{ backgroundColor: theme.colors.sidebar }}
          />
          <span className="text-xs text-gray-500">{t('settings.sidebar')}</span>
        </div>

        {/* Primary color preview */}
        <div className="flex items-center gap-2">
          <div 
            className="w-8 h-6 rounded"
            style={{ backgroundColor: theme.colors.primary }}
          />
          <span className="text-xs text-gray-500">{t('settings.primary')}</span>
        </div>

        {/* Background preview */}
        <div className="flex items-center gap-2">
          <div 
            className="w-8 h-6 rounded border border-gray-200"
            style={{ backgroundColor: theme.colors.background }}
          />
          <span className="text-xs text-gray-500">{t('settings.background')}</span>
        </div>

        {/* Accent preview */}
        <div className="flex items-center gap-2">
          <div 
            className="w-8 h-6 rounded"
            style={{ backgroundColor: theme.colors.accent }}
          />
          <span className="text-xs text-gray-500">{t('settings.accent')}</span>
        </div>
      </div>

      {/* Mini UI preview */}
      <div 
        className="mt-3 p-2 rounded border"
        style={{ 
          backgroundColor: theme.colors.background,
          borderColor: theme.colors.cardBorder 
        }}
      >
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-8 rounded"
            style={{ backgroundColor: theme.colors.sidebar }}
          />
          <div className="flex-1">
            <div 
              className="h-2 w-full rounded mb-1"
              style={{ backgroundColor: theme.colors.card, border: `1px solid ${theme.colors.cardBorder}` }}
            />
            <div 
              className="h-4 w-1/2 rounded"
              style={{ backgroundColor: theme.colors.primary }}
            />
          </div>
        </div>
      </div>
    </button>
  )
}
