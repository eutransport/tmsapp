/**
 * Modern (strakke) factuur-layout: presets, editor en preview.
 * Wordt getoond in `TemplateEditorPage` wanneer `layoutStyle === 'modern'`.
 */
import type { ReactNode } from 'react'
import type {
  ModernLayoutConfig,
  ModernPresetKey,
  LogoMode,
  ModernVariant,
  InvoiceTemplate,
} from '@/types'

export interface ModernPreset {
  key: ModernPresetKey
  label: string
  accentColor: string
  logoMode: LogoMode
  variant: ModernVariant
}

/**
 * 10 stijl-presets. Elke preset combineert een kleur EN een layout-variant:
 * - classic : titel rechts, logo links, tabelheader in kleur (huidig)
 * - band    : brede gekleurde balk bovenaan met titel en logo op wit
 * - stacked : gecentreerd, grote titel boven — logo eronder
 * - minimal : geen fills, alleen dunne lijntjes en dunne accent-onderstreping
 */
export const MODERN_PRESETS: ModernPreset[] = [
  { key: 'nexora',    label: 'Nexora — band oranje',        accentColor: '#ea580c', logoMode: 'logo-left-text-right', variant: 'band' },
  { key: 'movento',   label: 'Movento — classic blauw',     accentColor: '#2563eb', logoMode: 'logo-left-text-right', variant: 'classic' },
  { key: 'rapido',    label: 'Rapido — stacked goud',       accentColor: '#d4a017', logoMode: 'logo-top-text-bottom', variant: 'stacked' },
  { key: 'greenway',  label: 'Greenway — minimal groen',    accentColor: '#65a30d', logoMode: 'logo-left-text-right', variant: 'minimal' },
  { key: 'northline', label: 'Northline — band zwart',      accentColor: '#111827', logoMode: 'logo-left-text-right', variant: 'band' },
  { key: 'flextrans', label: 'Flextrans — classic teal',    accentColor: '#0d9488', logoMode: 'logo-left-text-right', variant: 'classic' },
  { key: 'boxway',    label: 'Boxway — band donkerblauw',   accentColor: '#1e3a8a', logoMode: 'logo-left-text-right', variant: 'band' },
  { key: 'speedo',    label: 'Speedo — minimal rood',       accentColor: '#dc2626', logoMode: 'logo-left-text-right', variant: 'minimal' },
  { key: 'prime',     label: 'Prime — stacked paars',       accentColor: '#7c3aed', logoMode: 'logo-top-text-bottom', variant: 'stacked' },
  { key: 'elevate',   label: 'Elevate — minimal goud',      accentColor: '#c19a3b', logoMode: 'text-only',            variant: 'minimal' },
]

const VARIANT_LABELS: Record<ModernVariant, string> = {
  classic: 'Klassiek — titel rechts, tabel-header in kleur',
  band:    'Kleurband — brede accentbalk boven met titel',
  stacked: 'Gecentreerd — grote titel boven, logo eronder',
  minimal: 'Minimalistisch — alleen lijntjes, geen fills',
}

export const DEFAULT_MODERN_CONFIG: ModernLayoutConfig = {
  preset: 'prime',
  accentColor: '#7c3aed',
  logoMode: 'logo-top-text-bottom',
  variant: 'stacked',
  companyNameOverride: '',
  typeLabels: {
    verkoop: 'FACTUUR',
    credit: 'CREDITFACTUUR',
    inkoop: 'INKOOPFACTUUR',
  },
}

interface ModernConfigEditorProps {
  config: ModernLayoutConfig
  onChange: (next: ModernLayoutConfig) => void
  logoUrl?: string | null
  onLogoChanged?: (newLogoUrl: string | null) => void
}

/**
 * Zet een backend-geproduceerde logo-URL om naar iets dat vanuit de browser
 * werkt. De backend serializer bouwt soms een absolute URL zoals
 * `http://localhost/media/...` (zonder poort) wat 404 geeft wanneer de app
 * op een andere poort draait. We strippen dat weg en gebruiken de path.
 */
function normalizeLogoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Absolute URL → alleen path (+ query) behouden zodat de browser hem
  // relatief aan het huidige origin oplost.
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw)
      return u.pathname + u.search
    }
  } catch {
    /* val terug op raw */
  }
  return raw
}

export function ModernConfigEditor({
  config,
  onChange,
  logoUrl: _logoUrl,
  onLogoChanged: _onLogoChanged,
}: ModernConfigEditorProps) {
  const update = (patch: Partial<ModernLayoutConfig>) => onChange({ ...config, ...patch })
  const updateLabel = (key: 'verkoop' | 'credit' | 'inkoop', value: string) =>
    onChange({ ...config, typeLabels: { ...config.typeLabels, [key]: value } })

  return (
    <div className="space-y-5">
      {/* Info: logo & bedrijfsnaam komen automatisch uit de administratie */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Het logo en de bedrijfsnaam op de factuur worden automatisch bepaald door
        de gekozen <b>administratie</b>. Als een administratie geen logo/naam heeft,
        valt het terug op de algemene instellingen (Instellingen &rarr; Bedrijf).
        Beheer dit onder <b>Instellingen &rarr; Administraties</b>.
      </div>

      <div>
        <h3 className="font-medium mb-2">Preset</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
          {MODERN_PRESETS.map(p => {
            const active = config.preset === p.key
            return (
              <button
                key={p.key}
                type="button"
                onClick={() =>
                  update({
                    preset: p.key,
                    accentColor: p.accentColor,
                    logoMode: p.logoMode,
                    variant: p.variant,
                  })
                }
                className={`text-left rounded-md border p-2 text-sm transition ${
                  active
                    ? 'border-primary-500 ring-2 ring-primary-200 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-4 w-4 rounded"
                    style={{ backgroundColor: p.accentColor }}
                  />
                  <span className="truncate">{p.label}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Layout variant</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(Object.keys(VARIANT_LABELS) as ModernVariant[]).map(v => (
            <label
              key={v}
              className={`flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer ${
                (config.variant || 'classic') === v
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <input
                type="radio"
                name="modernVariant"
                checked={(config.variant || 'classic') === v}
                onChange={() => update({ variant: v })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium capitalize">{v}</span>
                <span className="block text-xs text-gray-500">{VARIANT_LABELS[v]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Accentkleur</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.accentColor}
            onChange={e => update({ accentColor: e.target.value })}
            className="h-9 w-16 border rounded cursor-pointer"
          />
          <input
            type="text"
            value={config.accentColor}
            onChange={e => update({ accentColor: e.target.value })}
            className="border rounded p-2 text-sm w-32"
            placeholder="#7c3aed"
          />
          <span className="text-xs text-gray-500">
            Gebruikt voor titel, tabel-header en TOTAAL-balk.
          </span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Logo &amp; bedrijfsnaam</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            { v: 'logo-left-text-right', l: 'Logo links, naam rechts' },
            { v: 'logo-top-text-bottom', l: 'Logo boven, naam eronder' },
            { v: 'logo-only', l: 'Alleen logo' },
            { v: 'text-only', l: 'Alleen tekst (bedrijfsnaam)' },
          ] as const).map(opt => (
            <label
              key={opt.v}
              className={`flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer ${
                config.logoMode === opt.v
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <input
                type="radio"
                name="logoMode"
                checked={config.logoMode === opt.v}
                onChange={() => update({ logoMode: opt.v })}
              />
              <span>{opt.l}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Als er geen logo in de instellingen staat, wordt de bedrijfsnaam
          automatisch op de logo-plek getoond.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Bedrijfsnaam override</label>
        <input
          type="text"
          value={config.companyNameOverride || ''}
          onChange={e => update({ companyNameOverride: e.target.value })}
          className="w-full border rounded p-2 text-sm"
          placeholder="Leeg = neem de naam van de gekozen administratie"
        />
        <p className="mt-1 text-xs text-gray-500">
          Laat leeg om automatisch de <b>naam van de administratie</b> te gebruiken
          (of de algemene bedrijfsnaam als er geen administratie is gekoppeld).
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Bedankt-tekst <span className="text-gray-500 font-normal">(onderaan de factuur)</span>
        </label>
        <input
          type="text"
          value={config.thankYouText || ''}
          onChange={e => update({ thankYouText: e.target.value })}
          className="w-full border rounded p-2 text-sm"
          placeholder="bijv. Bedankt! of Thank you!"
        />
        <p className="text-xs text-gray-500 mt-1">
          Laat leeg om geen bedanktekst te tonen. Wordt in accent-kleur en cursief afgedrukt.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Titels in kop</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Verkoop</label>
            <input
              type="text"
              value={config.typeLabels?.verkoop ?? 'FACTUUR'}
              onChange={e => updateLabel('verkoop', e.target.value)}
              className="w-full border rounded p-2 text-sm uppercase"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Credit</label>
            <input
              type="text"
              value={config.typeLabels?.credit ?? 'CREDITFACTUUR'}
              onChange={e => updateLabel('credit', e.target.value)}
              className="w-full border rounded p-2 text-sm uppercase"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Inkoop</label>
            <input
              type="text"
              value={config.typeLabels?.inkoop ?? 'INKOOPFACTUUR'}
              onChange={e => updateLabel('inkoop', e.target.value)}
              className="w-full border rounded p-2 text-sm uppercase"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

interface ModernPreviewProps {
  config: ModernLayoutConfig
  companyName?: string
  companyAddress?: string   // multi-line, \n gescheiden
  companyPhone?: string
  companyEmail?: string
  companyIban?: string
  companyKvk?: string
  companyBtw?: string
  logoUrl?: string | null
}

const DEMO_LINES = [
  { o: 'Transport dienstverlening', a: 1, p: 750, t: 750 },
  { o: 'Brandstoftoeslag', a: 1, p: 125, t: 125 },
  { o: 'Wachttijd', a: 2, p: 60, t: 120 },
  { o: 'Administratiekosten', a: 1, p: 25, t: 25 },
]

function LogoOrName({
  logoMode,
  logoImg,
  showText,
  name,
  textColorClass = 'text-gray-900',
  size = 'lg',
}: {
  logoMode: LogoMode
  logoImg: ReactNode
  showText: boolean
  name: string
  textColorClass?: string
  size?: 'md' | 'lg' | 'xl'
}) {
  const textSize = size === 'xl' ? 'text-xl' : size === 'md' ? 'text-base' : 'text-lg'
  if (logoMode === 'logo-top-text-bottom') {
    return (
      <div className="flex flex-col gap-1">
        {logoImg}
        {showText && <div className={`font-bold ${textSize} ${textColorClass}`}>{name}</div>}
      </div>
    )
  }
  if (logoMode === 'logo-left-text-right') {
    return (
      <div className="flex items-center gap-3">
        {logoImg}
        {showText && <div className={`font-bold ${textSize} ${textColorClass}`}>{name}</div>}
      </div>
    )
  }
  if (logoMode === 'logo-only' && logoImg) return <>{logoImg}</>
  return <div className={`font-bold ${textSize} ${textColorClass}`}>{name}</div>
}

/**
 * WYSIWYG-preview van de moderne PDF-layout per variant.
 * De uiteindelijke PDF wordt server-side gerenderd, dus 100% pixelparity
 * is niet vereist — deze preview toont voornamelijk de layout-structuur.
 */
export function ModernPreview({
  config,
  companyName,
  companyAddress,
  companyPhone,
  companyEmail,
  companyIban,
  companyKvk,
  companyBtw,
  logoUrl,
}: ModernPreviewProps) {
  const accent = config.accentColor || '#7c3aed'
  const name = (config.companyNameOverride?.trim() || companyName || 'Uw Bedrijf B.V.').trim()
  const title = config.typeLabels?.verkoop || 'FACTUUR'
  const variant: ModernVariant = config.variant || 'classic'
  const thankYou = (config.thankYouText || '').trim()

  const addressLines = (companyAddress || 'Transportweg 15\n1234 KL Plaatsnaam')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
  const contactBits = [companyPhone, companyEmail].filter(Boolean).join(' · ')
  const iban = companyIban || 'NL72 TRIA 0123 4567 89'
  const kvk = companyKvk || '12345678'
  const btw = companyBtw || 'NL1234.56.789.B01'

  const cleanLogoUrl = normalizeLogoUrl(logoUrl)

  const wantLogo =
    config.logoMode === 'logo-only' ||
    config.logoMode === 'logo-left-text-right' ||
    config.logoMode === 'logo-top-text-bottom'
  const wantText =
    config.logoMode === 'text-only' ||
    config.logoMode === 'logo-left-text-right' ||
    config.logoMode === 'logo-top-text-bottom'
  const hasLogo = wantLogo && !!cleanLogoUrl
  const showText = wantText || (wantLogo && !cleanLogoUrl) // fallback

  const logoImg = hasLogo ? (
    <img src={cleanLogoUrl!} alt="" className="h-16 w-auto object-contain" />
  ) : null

  const isMinimal = variant === 'minimal'
  const headerBg = isMinimal ? 'transparent' : accent
  const headerColor = isMinimal ? '#111827' : '#ffffff'

  // --- Address block (gedeeld tussen alle varianten) ---
  const addressBlock = (
    <div className="grid grid-cols-[1fr_auto] gap-6 pb-3">
      <div>
        <div className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">
          Gefactureerd aan
        </div>
        <div className="mt-1 font-semibold text-gray-900">Klantnaam B.V.</div>
        <div className="text-gray-700">Straatnaam 1</div>
        <div className="text-gray-700">1234 AB Plaatsnaam</div>
        <div className="text-gray-500 text-xs mt-1">KVK: 12345678</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">
          Factuurgegevens
        </div>
        <div className="mt-1 text-gray-800">
          Factuurnummer: <span className="font-semibold">F-2026-0001</span>
        </div>
        <div className="text-gray-800">Factuurdatum: 26-07-2026</div>
        <div className="text-gray-800">Vervaldatum: 25-08-2026</div>
      </div>
    </div>
  )

  const linesTable = (
    <table className="w-full text-xs">
      <thead>
        <tr
          style={{
            backgroundColor: headerBg,
            color: headerColor,
            borderBottom: isMinimal ? `2px solid ${accent}` : undefined,
          }}
        >
          <th className="text-left py-2 px-2 font-semibold">Omschrijving</th>
          <th className="text-right py-2 px-2 font-semibold w-16">Aantal</th>
          <th className="text-right py-2 px-2 font-semibold w-20">Prijs</th>
          <th className="text-right py-2 px-2 font-semibold w-20">Totaal</th>
        </tr>
      </thead>
      <tbody>
        {DEMO_LINES.map((r, i) => (
          <tr key={i} className="border-b border-gray-100">
            <td className="py-2 px-2 text-gray-800">{r.o}</td>
            <td className="py-2 px-2 text-right text-gray-800">{r.a}</td>
            <td className="py-2 px-2 text-right text-gray-800">€ {r.p.toFixed(2)}</td>
            <td className="py-2 px-2 text-right text-gray-800">€ {r.t.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  const totalsBlock = (
    <div className="mt-4 flex justify-end">
      <table className="text-xs">
        <tbody>
          <tr>
            <td className="text-gray-600 pr-6 py-1 uppercase font-semibold">Subtotaal</td>
            <td className="text-right py-1">€ 1.020,00</td>
          </tr>
          <tr>
            <td className="text-gray-600 pr-6 py-1 uppercase font-semibold">BTW (21%)</td>
            <td className="text-right py-1">€ 214,20</td>
          </tr>
          {isMinimal ? (
            <tr style={{ borderTop: `2px solid ${accent}` }}>
              <td className="pr-6 py-2 uppercase font-bold" style={{ color: accent }}>
                Totaal
              </td>
              <td className="text-right py-2 font-bold" style={{ color: accent }}>
                € 1.234,20
              </td>
            </tr>
          ) : (
            <tr>
              <td
                className="pr-6 py-2 uppercase font-bold text-white"
                style={{ backgroundColor: accent, paddingLeft: 12 }}
              >
                Totaal
              </td>
              <td
                className="text-right py-2 font-bold text-white"
                style={{ backgroundColor: accent, paddingRight: 12 }}
              >
                € 1.234,20
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  const paymentDetails = (
    <div className="mt-6 border rounded-md p-3 text-[11px] bg-gray-50 border-gray-200">
      <div className="text-[10px] font-bold uppercase text-gray-500 tracking-wide mb-1">
        Betaalgegevens
      </div>
      <div className="grid grid-cols-3 gap-2 text-gray-700">
        <div>
          <span className="text-gray-500">IBAN:</span> {iban}
        </div>
        <div>
          <span className="text-gray-500">KVK:</span> {kvk}
        </div>
        <div>
          <span className="text-gray-500">BTW:</span> {btw}
        </div>
      </div>
    </div>
  )

  // --- Top info-strip (adres + banking) — bij alle varianten behalve minimal ---
  const isDarkStrip = variant === 'band'
  const stripBg = isDarkStrip ? accent : 'transparent'
  const stripText = isDarkStrip ? 'text-gray-100' : 'text-gray-700'
  const stripLabel = isDarkStrip ? 'text-gray-300' : 'text-gray-500'
  const stripName = isDarkStrip ? 'text-white' : 'text-gray-900'
  const topInfoBar = variant === 'minimal' ? null : (
    <div
      className={`flex items-start justify-between gap-6 text-[11px] leading-tight ${
        isDarkStrip ? 'px-5 py-3 -mx-6 -mt-6 mb-4' : 'pb-2 mb-4 border-b-2'
      }`}
      style={{
        backgroundColor: stripBg,
        borderColor: isDarkStrip ? undefined : accent,
      }}
    >
      <div className={stripText}>
        <div className={`font-bold ${stripName}`}>{name}</div>
        {addressLines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        {contactBits && <div>{contactBits}</div>}
      </div>
      <div className={`${stripText} min-w-[8rem]`}>
        <div className="grid grid-cols-[auto_1fr] gap-x-2">
          <span className={`font-bold ${stripLabel}`}>IBAN</span>
          <span>: {iban}</span>
          <span className={`font-bold ${stripLabel}`}>KVK</span>
          <span>: {kvk}</span>
          <span className={`font-bold ${stripLabel}`}>BTW</span>
          <span>: {btw}</span>
        </div>
      </div>
    </div>
  )

  // --- Top header per variant ---
  let topHeader: ReactNode
  if (variant === 'band') {
    // De dark strip staat al bovenaan; deze rij is een clean header
    // (logo links + grote FACTUUR rechts in accent) zoals Nordic/Altura.
    topHeader = (
      <div className="flex items-center justify-between gap-4 pb-5">
        <LogoOrName
          logoMode={config.logoMode}
          logoImg={logoImg}
          showText={showText}
          name={name}
          size="xl"
        />
        <div
          className="text-3xl font-bold tracking-wide uppercase"
          style={{ color: accent }}
        >
          {title}
        </div>
      </div>
    )
  } else if (variant === 'stacked') {
    topHeader = (
      <div className="flex flex-col items-center text-center pb-5 border-b" style={{ borderColor: accent }}>
        <div
          className="text-3xl font-extrabold tracking-widest uppercase"
          style={{ color: accent }}
        >
          {title}
        </div>
        <div className="mt-2">
          <LogoOrName
            logoMode={config.logoMode}
            logoImg={logoImg}
            showText={showText}
            name={name}
            size="md"
          />
        </div>
      </div>
    )
  } else if (variant === 'minimal') {
    topHeader = (
      <div className="flex items-end justify-between gap-4 pb-3 mb-4 border-b border-gray-300">
        <LogoOrName
          logoMode={config.logoMode}
          logoImg={logoImg}
          showText={showText}
          name={name}
          size="md"
        />
        <div className="text-sm font-semibold tracking-widest uppercase text-gray-700">
          {title}
        </div>
      </div>
    )
  } else {
    // classic
    topHeader = (
      <div className="flex items-start justify-between gap-4 pb-5">
        <LogoOrName
          logoMode={config.logoMode}
          logoImg={logoImg}
          showText={showText}
          name={name}
        />
        <div
          className="text-2xl font-bold tracking-wide uppercase"
          style={{ color: accent }}
        >
          {title}
        </div>
      </div>
    )
  }

  return (
    <div
      className="bg-white border rounded-lg shadow-sm p-6 text-sm flex flex-col"
      style={{ minHeight: '700px' }}
    >
      {topInfoBar}
      {topHeader}
      {addressBlock}
      <div className="border-t border-gray-200 my-3" />
      <div className="flex-1">
        {linesTable}
        {totalsBlock}
        {isMinimal && paymentDetails}
        {thankYou && (
          <div className="mt-8 text-right">
            <div
              className="text-2xl italic"
              style={{ color: accent, fontFamily: 'Georgia, serif' }}
            >
              {thankYou}
            </div>
            <div className="text-[10px] text-gray-500 mt-1">voor uw vertrouwen</div>
          </div>
        )}
      </div>
      <div className="border-t border-gray-200 mt-6 pt-2 text-[10px] text-gray-500 flex justify-between">
        <div>Factuur F-2026-0001</div>
        <div>Pagina 1</div>
      </div>
    </div>
  )
}

/**
 * Kleine helper: bepaal de te tonen modern config uit een template (met
 * defaults). Ook bruikbaar bij het openen van een bestaand template.
 */
export function extractModernConfig(t: InvoiceTemplate | null | undefined): ModernLayoutConfig {
  const cfg = (t?.layout as unknown as { modern?: ModernLayoutConfig } | undefined)?.modern
  return { ...DEFAULT_MODERN_CONFIG, ...(cfg || {}) }
}
