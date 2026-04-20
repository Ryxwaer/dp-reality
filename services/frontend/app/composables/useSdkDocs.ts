export const SDK_DOCS = `# Module SDK

A module is a single ESM bundle (\`.mjs\`) whose **default export** is a
factory function. When a user opens the module's configuration page the
frontend downloads the bundle, imports it as a Blob URL, and calls
\`factory(host)\` to obtain a Vue component.

\`\`\`ts
export default function (host: ModuleHost) {
  const { h, ref, defineComponent, saveBot, existingBot, moduleId } = host

  return defineComponent({
    setup() {
      const name = ref(existingBot?.name ?? '')
      const active = ref(existingBot?.active ?? true)
      // ...build your own config refs here

      async function onSubmit(e: Event) {
        e.preventDefault()
        await saveBot({
          name: name.value,
          active: active.value,
          config: { /* serializable object */ }
        })
      }

      return () => h('form', { onSubmit },
        /* your UI here — h(), JSX, or a compiled render fn */)
    }
  })
}
\`\`\`

## The \`host\` object

The host bridges the module back to the main Vue app and the backend. You
**must not** \`import\` Vue directly — use the primitives from \`host\` so the
module shares the app's Vue instance.

| Key              | What it is                                                |
|------------------|-----------------------------------------------------------|
| \`h\`              | Vue \`h()\` render function.                                |
| \`defineComponent\`| Vue \`defineComponent()\`.                                  |
| \`ref\`, \`reactive\`, \`computed\`, \`watch\`, \`onMounted\` | Reactivity primitives. |
| \`saveBot(payload)\` | \`POST /api/bots\` or \`PATCH /api/bots/:id\` under the hood. Returns a promise. |
| \`existingBot\`   | \`null\` on create, a \`{ id, name, config, active }\` object on edit. |
| \`moduleId\`      | The module's MongoDB id — handy if you want to re-fetch or link back. |

## Workflow

1. \`cd services/module-sdk/template\`
2. Copy the template into a new folder under \`services/module-sdk/\` and
   update the \`package.json\` name.
3. Edit \`src/module.ts\`. Use the exported types from \`host-types.ts\` for
   autocomplete.
4. \`pnpm install && pnpm build\` — \`build.mjs\` runs \`esbuild\` and emits
   \`dist/module.mjs\`.
5. Upload \`dist/module.mjs\` on this page together with a name, short
   description and the markdown documentation.
6. Open **Modules → Use module** to create a bot using your new module.

## Documentation tips

- The **Description** is the one-liner shown on the module card.
- The **Documentation** you write here is rendered on the right-hand side
  of the bot configuration page. It supports full markdown (headings,
  tables, fenced code, links). Keep it focused on *how to fill the form*
  and *what config shape you save* — that's what bot creators need.

## Saving the bot config

\`saveBot\` accepts:

\`\`\`ts
interface SaveBotPayload {
  name: string
  active?: boolean
  config: Record<string, unknown> // opaque to the frontend
  expires_at?: string | null
}
\`\`\`

The \`config\` object is stored as-is under \`users.bots[].config\` and is
read by the Go notifier. The notifier currently expects the shape used by
the built-in Sreality/Bazos modules — see their documentation for the
canonical schema.

## Security

This is a POC. Uploaded bundles execute in *every* signed-in user's
browser when they open them. Only upload code you wrote or read end-to-end.
There is no sandbox, CSP nonce, or origin isolation — treat each module as
if it has full access to the user's session.
`

export function useSdkDocs(): string {
  return SDK_DOCS
}
