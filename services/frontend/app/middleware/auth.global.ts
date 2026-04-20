const PUBLIC_ROUTES = ['/login', '/register']
const PUBLIC_PREFIXES = ['/unsubscribe']

export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

  const isPublic
    = PUBLIC_ROUTES.includes(to.path)
      || PUBLIC_PREFIXES.some(p => to.path.startsWith(`${p}/`))

  if (!loggedIn.value && !isPublic) {
    return navigateTo({
      path: '/login',
      query: to.fullPath === '/' ? undefined : { redirect: to.fullPath }
    })
  }

  if (loggedIn.value && PUBLIC_ROUTES.includes(to.path)) {
    return navigateTo('/')
  }
})
