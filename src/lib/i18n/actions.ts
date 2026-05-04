'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { LOCALE_COOKIE, isLocale } from './translate'

/**
 * Ola P4 · P4-4 — Server action para persistir el locale elegido por el
 * usuario en la cookie `x-locale`.
 *
 * Se invoca desde el `<LanguageSwitcher>` (client) cuando el usuario
 * cambia de idioma. Al venir desde server action podemos:
 *   - Setear la cookie httpOnly=false (legible desde JS) con SameSite=lax.
 *   - Disparar `revalidatePath('/')` para que el resto de server
 *     components renderice con el nuevo locale en la siguiente request.
 *
 * Si el valor recibido no es un locale soportado, no hace nada (defensa
 * contra cookies/forms manipulados).
 */
export async function setLocaleAction(locale: string): Promise<void> {
  if (!isLocale(locale)) return
  const oneYear = 60 * 60 * 24 * 365
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: oneYear,
    sameSite: 'lax',
  })
  // Invalida los renders SSR cacheados por path para que la próxima
  // navegación recoja el nuevo locale.
  revalidatePath('/', 'layout')
}
