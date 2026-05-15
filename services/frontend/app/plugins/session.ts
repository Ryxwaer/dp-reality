/**
 * Hydrate the user session on app boot. Runs universally so the SSR
 * HTML and the client hydration both reflect the logged-in user, and
 * before any global route middleware fires (Nuxt plugins are
 * guaranteed to complete before `defineNuxtRouteMiddleware` runs).
 * `auth.global.ts` reads `useUserSession().loggedIn` synchronously and
 * relies on this plugin having populated the state.
 */
export default defineNuxtPlugin(async () => {
  const { fetch } = useUserSession()
  await fetch()
})
