import { useAuthStore } from '@/stores/authStore'

// Opdrachtgever en charter delen dezelfde schermen voor uren, tol en kaart,
// maar elk met een eigen, afgeschermd endpoint. De backend bepaalt wat er
// werkelijk terugkomt; dit kiest alleen het juiste adres.
export const portaalBasis = (): '/portaal' | '/charter' =>
  useAuthStore.getState().user?.rol === 'charter' ? '/charter' : '/portaal'
