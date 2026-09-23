/**
 * De app volledig verversen vanuit de app zelf.
 *
 * Waarom dit nodig is: op de iPhone draait de app zonder browserbalk. Er is
 * geen herlaadknop en de standaard "naar beneden trekken" werkt daar niet op
 * de pagina zelf. Bovendien bevriest iOS de app bij het wegschakelen in plaats
 * van hem te herladen, waardoor een nieuwe versie soms dagen blijft hangen.
 * Op Android gebeurt dat wel vanzelf. Uitloggen was tot nu toe de enige manier
 * om een verse start af te dwingen; dat is met deze functie niet meer nodig.
 *
 * De inlog blijft staan: die zit in localStorage en wordt hier niet aangeraakt.
 */

/** Caches die we bij het verversen weggooien omdat er verouderde data in zit. */
const WEG = ['api-cache']

/** Caches die we laten staan omdat ze duur zijn om opnieuw op te halen. */
const BEWAREN = ['media-cache', 'images-cache', 'google-fonts-webfonts']

/**
 * Haalt de nieuwste versie op en herlaadt daarna de pagina.
 *
 * Zonder verbinding wordt alleen herladen; de opgeslagen versie blijft dan
 * heel, zodat een chauffeur zonder bereik de app niet stuk kan verversen.
 */
export async function verversApp(): Promise<void> {
  const online = navigator.onLine !== false

  try {
    if (online && 'caches' in window) {
      const namen = await caches.keys()
      await Promise.all(
        namen
          .filter((naam) => WEG.some((w) => naam.includes(w)) && !BEWAREN.includes(naam))
          .map((naam) => caches.delete(naam)),
      )
    }

    if (online && 'serviceWorker' in navigator) {
      const registraties = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        registraties.map(async (registratie) => {
          // Haalt een eventuele nieuwe versie binnen. De service worker is
          // ingesteld met skipWaiting, dus die neemt het meteen over.
          await registratie.update()
          registratie.waiting?.postMessage({ type: 'SKIP_WAITING' })
        }),
      )
    }
  } catch {
    // Lukt het bijhalen niet, dan herladen we alsnog met wat er al is.
  }

  herlaad()
}

/**
 * Herlaadt de pagina op de huidige route.
 *
 * `location.reload()` wordt op iOS in appmodus soms genegeerd wanneer de
 * pagina net uit de achtergrond komt. Opnieuw navigeren naar hetzelfde adres
 * werkt daar wel betrouwbaar.
 */
function herlaad(): void {
  const adres = window.location.href
  window.location.replace(adres)
}
