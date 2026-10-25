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

async function geefInstantie(config: EntraConfig): Promise<PublicClientApplication> {
  if (instantie) return instantie

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
      // Gelijk aan de redirect-URI die in Entra geregistreerd staat.
      redirectUri: window.location.origin,
    },
    cache: {
      // Niet in localStorage: het Microsoft-token hoeft de sessie niet te
      // overleven, want wij geven na het inloggen ons eigen token uit.
      cacheLocation: 'sessionStorage',
    },
  })

  await instantie.initialize()
  return instantie
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
 * Opent het Microsoft-inlogscherm en geeft het id-token terug.
 */
export async function logInBijMicrosoft(config: EntraConfig): Promise<string> {
  if (!config.enabled || !config.client_id || !config.authority) {
    throw new Error('Inloggen via Microsoft is niet beschikbaar.')
  }

  const app = await geefInstantie(config)
  const resultaat = await app.loginPopup({
    scopes: ['openid', 'profile', 'email'],
    prompt: 'select_account',
  })

  if (!resultaat.idToken) {
    throw new Error('Microsoft gaf geen token terug.')
  }

  return resultaat.idToken
}
