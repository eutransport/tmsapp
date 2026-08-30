import { useTranslation } from 'react-i18next'
import { Menu, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import clsx from '@/utils/clsx'

// Flag SVG components
const DutchFlag = () => (
  <svg className="w-5 h-4 rounded-sm" viewBox="0 0 640 480">
    <rect width="640" height="160" fill="#ae1c28" />
    <rect y="160" width="640" height="160" fill="#fff" />
    <rect y="320" width="640" height="160" fill="#21468b" />
  </svg>
)

const EnglishFlag = () => (
  <svg className="w-5 h-4 rounded-sm" viewBox="0 0 640 480">
    <path fill="#012169" d="M0 0h640v480H0z"/>
    <path fill="#FFF" d="m75 0 244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0h75z"/>
    <path fill="#C8102E" d="m424 281 216 159v40L369 281h55zm-184 20 6 35L54 480H0l240-179zM640 0v3L391 191l2-44L590 0h50zM0 0l239 176h-60L0 42V0z"/>
    <path fill="#FFF" d="M241 0v480h160V0H241zM0 160v160h640V160H0z"/>
    <path fill="#C8102E" d="M0 193v96h640v-96H0zM273 0v480h96V0h-96z"/>
  </svg>
)

const TurkishFlag = () => (
  <svg className="w-5 h-4 rounded-sm" viewBox="0 0 640 480">
    <rect width="640" height="480" fill="#e30a17" />
    <circle cx="240" cy="240" r="96" fill="#fff" />
    <circle cx="264" cy="240" r="76.8" fill="#e30a17" />
    <path fill="#fff" d="m380.4 240 68.4-22.2-42.3 58.2v-72l42.3 58.2z" />
  </svg>
)

interface Language {
  code: string
  name: string
  flag: React.ReactNode
}

const languages: Language[] = [
  { code: 'nl', name: 'Nederlands', flag: <DutchFlag /> },
  { code: 'en', name: 'English', flag: <EnglishFlag /> },
  { code: 'tr', name: 'Türkçe', flag: <TurkishFlag /> },
]

interface LanguageSwitcherProps {
  /**
   * Toon de talen direct onder elkaar in plaats van in een eigen dropdown.
   * Nodig op mobiel: daar staat de taalkiezer binnen het gebruikersmenu en
   * een dropdown binnen een dropdown laat het scherm wegflikkeren.
   */
  inline?: boolean
}

export default function LanguageSwitcher({ inline = false }: LanguageSwitcherProps) {
  const { i18n } = useTranslation()

  // resolvedLanguage vangt varianten als 'nl-NL' op en geeft gewoon 'nl' terug.
  const actieveCode = i18n.resolvedLanguage || i18n.language
  const currentLanguage = languages.find(lang => lang.code === actieveCode) || languages[0]

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code)
  }

  const vinkje = (
    <svg className="ml-auto h-4 w-4 text-primary-600" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  )

  if (inline) {
    return (
      <div className="flex flex-col gap-0.5">
        {languages.map((language) => (
          <button
            key={language.code}
            type="button"
            onClick={() => changeLanguage(language.code)}
            aria-pressed={actieveCode === language.code}
            className={clsx(
              actieveCode === language.code ? 'bg-primary-50 text-primary-700' : 'text-gray-700',
              'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm touch-manipulation'
            )}
          >
            {language.flag}
            <span>{language.name}</span>
            {actieveCode === language.code && vinkje}
          </button>
        ))}
      </div>
    )
  }

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
        {currentLanguage.flag}
        <span className="hidden sm:inline text-sm text-gray-700">{currentLanguage.name}</span>
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-50 mt-2 w-40 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
          {languages.map((language) => (
            <Menu.Item key={language.code}>
              {({ active }) => (
                <button
                  onClick={() => changeLanguage(language.code)}
                  className={clsx(
                    active ? 'bg-gray-50' : '',
                    actieveCode === language.code ? 'bg-primary-50 text-primary-700' : 'text-gray-700',
                    'flex w-full items-center gap-3 px-4 py-2 text-sm'
                  )}
                >
                  {language.flag}
                  <span>{language.name}</span>
                  {actieveCode === language.code && vinkje}
                </button>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  )
}
