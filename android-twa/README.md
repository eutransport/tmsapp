# TMS Android-app (Play Store) — TWA via Bubblewrap

Deze map bevat de configuratie om de bestaande PWA
(`https://tms.moveo-bv.nl`) te verpakken als Android-app (Trusted Web
Activity) en te publiceren in de Google Play Store.

> De Android-app is een dun schilletje rond de live PWA. Inhoudelijke
> updates aan de web-app verschijnen automatisch in de app. Je bouwt
> alleen een nieuwe `.aab` als je het icoon, de naam of het versienummer
> wijzigt.

---

## Eenmalige vereisten

1. **Java JDK 17** geïnstalleerd (`java -version`).
2. **Node.js** (heb je al).
3. **Android SDK** — Bubblewrap kan deze bij eerste build automatisch
   downloaden, of installeer Android Studio.
4. **Google Play Developer-account** ($25 eenmalig). Kies bij voorkeur een
   **organisatie-account** (bedrijfsverificatie) — dan vervalt de eis van
   een 14-daagse gesloten test met 12 testers die voor persoonlijke
   accounts geldt.
5. Bubblewrap CLI:
   ```powershell
   npm install -g @bubblewrap/cli
   ```

---

## Stap 1 — Project initialiseren

Voer dit één keer uit vanuit deze map (`android-twa/`):

```powershell
cd android-twa
bubblewrap init --manifest https://tms.moveo-bv.nl/manifest.webmanifest
```

- Neem de waarden over uit `twa-manifest.json` (package: `nl.moveobv.tms`).
- Bubblewrap maakt een **signing key** (`android.keystore`) aan.
  **Bewaar deze key + wachtwoord veilig** (bijv. in een password manager).
  Raak je de key kwijt, dan kun je nooit meer een update publiceren onder
  dezelfde app.

## Stap 2 — Bouwen

```powershell
bubblewrap build
```

Output:
- `app-release-bundle.aab` → dit upload je naar de Play Store.
- `app-release-signed.apk` → voor lokaal testen op een toestel.
- De **SHA-256 fingerprint** wordt getoond (en staat in de keystore).

De fingerprint ophalen kan ook met:
```powershell
keytool -list -v -keystore android.keystore -alias android
```

## Stap 3 — Digital Asset Links koppelen

1. Kopieer de SHA-256 fingerprint uit stap 2.
2. Plak die in `frontend/public/.well-known/assetlinks.json` op de plek van
   `REPLACE_WITH_SHA256_FINGERPRINT_FROM_BUBBLEWRAP_BUILD`.
3. Deploy de frontend opnieuw.
4. Controleer dat dit bereikbaar is en exact klopt:
   ```
   https://tms.moveo-bv.nl/.well-known/assetlinks.json
   ```
   Verifieer via: https://developers.google.com/digital-asset-links/tools/generator

> Klopt de fingerprint niet, dan toont de app alsnog de browser-adresbalk.

## Stap 4 — Testen op een toestel

```powershell
bubblewrap install
```
(of installeer `app-release-signed.apk` handmatig). Controleer dat de app
**zonder** adresbalk opent en correct inlogt.

## Stap 5 — Publiceren in de Play Store

1. Maak in [Play Console](https://play.google.com/console) een nieuwe app.
2. Upload `app-release-bundle.aab` (Production of Internal testing track).
3. Vul de Store-vermelding in:
   - App-icoon **512×512** PNG
   - Feature graphic **1024×500** PNG
   - Minimaal 2 telefoon-screenshots
   - Korte + volledige beschrijving
   - **Privacybeleid-URL** (verplicht)
4. Vul de vragenlijsten in: **Data safety**, **Content rating**,
   **Target audience & content**, **App access** (geef testlogin als de
   app achter login zit — anders keurt Google af).
5. Lever in voor review.

---

## Updates publiceren

Alleen nodig bij wijziging van icoon/naam/native-config:
1. Verhoog `appVersionCode` (+1) en `appVersionName` in `twa-manifest.json`.
2. `bubblewrap update` en `bubblewrap build`.
3. Upload de nieuwe `.aab` met **dezelfde keystore**.

## Belangrijke aandachtspunten

- **App access**: jullie TMS zit achter login. Geef Google een
  testaccount, anders wordt de review afgekeurd ("login required").
- **Push-notificaties**: werken in TWA via web push (jullie hebben al
  `sw-push.js`). Op Android 13+ vraagt de app netjes om toestemming.
- **Keystore = heilig**: zonder de originele keystore geen updates meer.
