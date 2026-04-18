export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  modules: ['@nuxtjs/tailwindcss'],

  runtimeConfig: {
    mongodbUri: process.env.MONGODB_URI ?? '',
  },
})
