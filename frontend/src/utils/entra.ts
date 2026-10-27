/**
 * Inloggen via Microsoft Entra ID.
 *
 * De instellingen komen van de server, zodat er niets in de frontend hoeft te
 * worden ingebakken en de knop vanzelf verdwijnt als de koppeling uitstaat.
 *
 * MSAL wordt pas ingeladen op het moment dat iemand daadwerkelijk op de knop
 * drukt. Zo betaalt niemand die gewoon met e-mail en wachtwoord inlogt voor
 * een bibliotheek die hij niet gebruikt.
 */
import type { PublicClientApplication } from '@azure/msal-browser'

import { authApi } from '@/api/auth'

export interface EntraConfig {
  enabled: boolean
  client_id?: string
  authority?: string
  tenant_type?: string
  tenant_name?: string
}

let instantie: PublicClientApplication | null = null

/**
 * Of er meegekeken mag worden met MSAL. Alleen handmatig aan te zetten met
 * `localStorage.entraDebug = '1'`; het inlogproces laat anders geen enkel
 * spoor na wanneer het vastloopt.
 */
function meekijkenGewenst(): boolean {
  try {
    return localStorage.getItem('entraDebug') === '1'
  } catch {
    return false
  }
}

// Microsoft hangt het antwoord achter een `#` in de URL. De router van de
// applicatie wist dat fragment al voordat React-effecten draaien, dus leggen
// we het vast op het allervroegste moment: bij het laden van deze module.
//
// Het is nadrukkelijk eenmalig. Blijft het staan, dan meldt de applicatie
// iemand na het uitloggen meteen weer aan met hetzelfde antwoord.
let binnengekomenFragment =
  typeof window === 'undefined' ? '' : window.location.hash

/** Of Microsoft ons zojuist heeft teruggestuurd met een antwoord. */
export function heeftMicrosoftAntwoord(): boolean {
  return /[#&](code|error|id_token)=/.test(binnengekomenFragment)
}

// Staat op `true` zolang een antwoord van Microsoft wordt gecontroleerd. In dat
// venster mag niets worden opgeruimd: de applicatie logt bij een verlopen token
// automatisch uit, en dat valt precies samen met de terugkeer van Microsoft.
let bezigMetVerwerken = false

// Onthoudt dat er al automatisch een tweede poging is gedaan. Staat bewust in
// sessionStorage: de herkansing betekent een omweg langs Microsoft, dus een
// variabele in het geheugen overleeft dat niet.
const HERKANSING = 'entra.herkansing'

function herkansingGebruikt(): boolean {
  try {
    return sessionStorage.getItem(HERKANSING) === '1'
  } catch {
    // Zonder sessionStorage kunnen we het niet bijhouden. Dan liever geen
    // herkansing dan een eindeloze reeks omwegen.
    return true
  }
}

function markeerHerkansing(): void {
  try {
    sessionStorage.setItem(HERKANSING, '1')
  } catch {
    // Niet kunnen onthouden is niet erg genoeg om het inloggen te stoppen.
  }
}

function vergeetHerkansing(): void {
  try {
    sessionStorage.removeItem(HERKANSING)
  } catch {
    // Zie hierboven.
  }
}

/**
 * Wist de sporen van een Microsoft-aanmelding. Nodig bij uitloggen, anders
 * kan de applicatie de bewaarde sessie stilletjes opnieuw gebruiken.
 */
export function vergeetMicrosoftSessie(): void {
  if (bezigMetVerwerken || heeftMicrosoftAntwoord()) return
  wisMicrosoftGegevens()
}

// MSAL bewaart lang niet alles onder een sleutel met "msal" erin. De
// aanmelding zelf wel (`msal.<clientid>.request.params`), maar de tokens en
// het account komen erna binnen onder sleutels als
// `<account>-login.windows.net-idtoken-<clientid>-...`. Werden die niet
// gewist, dan bleef iemand na het uitloggen bij Microsoft aangemeld.
const MSAL_SLEUTEL = /(^|\.)msal|-(id|access|refresh)token-|-login\.(windows\.net|microsoftonline\.com)-/i

function wisMicrosoftGegevens(): void {
  binnengekomenFragment = ''
  instantie = null
  try {
    for (const sleutel of Object.keys(sessionStorage)) {
      if (MSAL_SLEUTEL.test(sleutel)) {
        sessionStorage.removeItem(sleutel)
      }
    }
  } catch {
    // Geen toegang tot sessionStorage: dan valt er ook niets te wissen.
  }
}

async function geefInstantie(config: EntraConfig): Promise<PublicClientApplication> {
  if (instantie) return instantie

  // Resten van een andere app-registratie blokkeren MSAL stilletjes. Weghalen
  // vóór het aanmaken van de instantie, anders is de blokkade er al.
  ruimVastgelopenPogingOp(config.client_id, true)

  const msal = await import('@azure/msal-browser')

  // MSAL vertrouwt login.microsoftonline.com vanzelf. Een eigen External
  // ID-tenant staat daar niet op en moet expliciet worden toegestaan.
  const eigenAuthority =
    config.tenant_type === 'external' && config.tenant_name
      ? [`${config.tenant_name}.ciamlogin.com`]
      : []

  instantie = new msal.PublicClientApplication({
    auth: {
      clientId: config.client_id!,
      authority: config.authority!,
      knownAuthorities: eigenAuthority,
      // Een eigen, lege pagina. Zou de applicatie hier laden, dan herschrijft
      // de router de URL en verdwijnt het antwoord van Microsoft voordat MSAL
      // het kan lezen. Deze URI moet in Entra geregistreerd staan.
      redirectUri: `${window.location.origin}/blank.html`,
    },
    cache: {
      // Niet in localStorage: het Microsoft-token hoeft de sessie niet te
      // overleven, want wij geven na het inloggen ons eigen token uit.
      cacheLocation: 'sessionStorage',
    },
    system: {
      loggerOptions: {
        // Standaard stil. Zet `localStorage.entraDebug = '1'` om mee te kijken
        // wanneer het inloggen vastloopt; zonder dit is er geen enkel spoor.
        loggerCallback: (_niveau: unknown, bericht: string) => {
          if (!meekijkenGewenst()) return
          // eslint-disable-next-line no-console
          console.log('[entra]', bericht)
        },
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Verbose,
      },
    },
  })

  await instantie.initialize()

  return instantie
}

/**
 * Haalt de blokkade weg van een eerdere, vastgelopen inlogpoging.
 *
 * Met `alleenVreemde` worden uitsluitend markeringen van een ánder client-ID
 * verwijderd. Die laat MSAL zelf nooit opruimen, waardoor een gewisselde
 * app-registratie inloggen blijvend blokkeert zonder zichtbare foutmelding.
 */
function ruimVastgelopenPogingOp(huidigClientId?: string, alleenVreemde = false): void {
  try {
    for (const sleutel of Object.keys(sessionStorage)) {
      if (!sleutel.includes('interaction.status')) continue

      if (alleenVreemde) {
        const waarde = sessionStorage.getItem(sleutel)
        let vanOnsZelf = true
        try {
          vanOnsZelf = JSON.parse(waarde ?? '{}')?.clientId === huidigClientId
        } catch {
          // Onleesbare inhoud is per definitie niet van ons.
          vanOnsZelf = false
        }
        if (vanOnsZelf) continue
      }

      sessionStorage.removeItem(sleutel)
    }
  } catch {
    // Geen toegang tot sessionStorage: dan valt er ook niets op te ruimen.
  }
}

export async function haalEntraConfig(): Promise<EntraConfig> {
  try {
    return await authApi.entraConfig()
  } catch {
    // De inlogpagina mag nooit stuklopen omdat deze optionele koppeling
    // onbereikbaar is.
    return { enabled: false }
  }
}

/**
 * Stuurt de bezoeker naar het Microsoft-inlogscherm.
 *
 * Bewust géén pop-up: daarbij moet de applicatie het aparte venster uitlezen,
 * en dat loopt in de praktijk stuk op browserbeveiliging. Deze route gebruikt
 * het gewone tabblad en werkt daardoor ook op telefoons.
 *
 * Deze functie keert normaal gesproken niet terug; de browser navigeert weg.
 */
export async function logInBijMicrosoft(config: EntraConfig): Promise<void> {
  if (!config.enabled || !config.client_id || !config.authority) {
    throw new Error('Inloggen via Microsoft is niet beschikbaar.')
  }

  const app = await geefInstantie(config)
  ruimVastgelopenPogingOp(config.client_id)

  await app.loginRedirect({
    scopes: ['openid', 'profile', 'email'],
    prompt: 'select_account',
  })
}

/**
 * Rondt een terugkeer van Microsoft af en geeft het id-token terug.
 * Geeft `null` als er niets af te ronden valt.
 */
export async function voltooiMicrosoftAanmelding(
  config: EntraConfig,
): Promise<string | null> {
  if (!heeftMicrosoftAntwoord() || !config.enabled || !config.client_id) {
    return null
  }

  // Vanaf hier mag er niets meer gewist worden tot de controle klaar is.
  bezigMetVerwerken = true
  try {
    const app = await geefInstantie(config)

    // Direct verbruiken: het antwoord van Microsoft is eenmalig. Zou het
    // blijven staan, dan logt de applicatie iemand na het uitloggen meteen
    // weer in.
    const fragment = binnengekomenFragment
    binnengekomenFragment = ''
    try {
      window.history.replaceState(null, '', window.location.pathname)
    } catch {
      // Adresbalk opschonen is netjes maar niet noodzakelijk.
    }

    // Het fragment wordt meegegeven omdat de router het uit de adresbalk heeft
    // gehaald voordat deze code draait.
    const resultaat = await app.handleRedirectPromise({ hash: fragment })
    vergeetHerkansing()
    return resultaat?.idToken ?? null
  } catch (fout) {
    // Een halfvergane poging mag de volgende niet blokkeren: opruimen, zodat
    // opnieuw inloggen meteen werkt zonder de pagina te hoeven verversen.
    wisMicrosoftGegevens()
    const code = (fout as { errorCode?: string })?.errorCode
    if (code === 'state_mismatch' || code === 'invalid_state') {
      // Dit overkomt mensen vooral vlak na het uitloggen: de aanmelding die
      // net begon, kon niet worden teruggevonden. Handmatig nog een keer op
      // de knop drukken helpt altijd, dus doen we dat zelf. Eén keer, anders
      // blijft de browser heen en weer stuiteren als het echt stuk is.
      if (!herkansingGebruikt()) {
        markeerHerkansing()
        await logInBijMicrosoft(config)
        return null
      }
      throw new Error('De aanmelding bij Microsoft is verlopen. Probeer het opnieuw.')
    }
    throw fout
  } finally {
    bezigMetVerwerken = false
  }
}
