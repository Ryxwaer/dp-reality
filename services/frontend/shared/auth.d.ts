declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
  }

  interface UserSession {
    loggedInAt: string
  }
}

export {}
