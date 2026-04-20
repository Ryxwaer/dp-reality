# Seeded module bundles

This directory holds the authoritative `.mjs` bundles for the two built-in
modules (Sreality, Bazos) that are seeded into MongoDB the first time a user
lists `/api/modules`.

## How the pipeline works

1. Source of truth: `services/module-sdk/examples/<name>/dist/module.mjs`.
2. Copies kept here so the frontend is self-contained.
3. `pnpm seed:sync` (inside `services/frontend/`) reads these files and
   regenerates [`server/seeds/generated-bundles.ts`](../../seeds/generated-bundles.ts)
   — a committed TypeScript file that exports the bundle source as a string.
4. [`server/utils/seed-modules.ts`](../../utils/seed-modules.ts) imports the
   strings and upserts the two built-ins. The seeder is invoked lazily from
   `GET /api/modules` (idempotent, once per process) — no server restart
   needed to pick up updated bundles.

## Updating the built-ins

```bash
cd services/module-sdk/examples/sreality
pnpm build

cp dist/module.mjs ../../../frontend/server/assets/seed-modules/sreality.mjs

cd ../../../frontend
pnpm seed:sync
```

The next page view of `/modules` will refresh the module's `code`,
`description` and `documentation` in MongoDB.

## Notes

- The files here are **not** read at runtime. The seeder only sees
  `generated-bundles.ts`.
- Modules uploaded through the UI get a fresh `ObjectId` and are never
  touched by the seeder.
- Seeded modules use fixed `ObjectId`s: `…001` = Sreality, `…002` = Bazos.
