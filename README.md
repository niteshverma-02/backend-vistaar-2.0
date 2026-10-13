# Vistaar API v2

Backend for **Vistaar 2.0** — the Vistaar app ("you place → we deliver →
you earn") and its HO portal screens. A fresh rewrite: new `/api/v2`
routes and new `vistaar_v2_*` collections on the shared `CRM-Database`.

Same stack and layout as `prasar-backend` and `franchise-offline-hub`:
NestJS 11 on Fastify, Mongoose, zod-validated env, one response envelope.

## Run it

```bash
pnpm install
cp .env.example .env        # fill MONGODB_URI (beta)
pnpm start:dev              # http://localhost:3000/api/v2/health
                            # Swagger at /docs when SWAGGER_ENABLED=true
```

Before calling any change done:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Where things are

- `CLAUDE.md` — the working rules (layers, envelope, auth, collections).
- `docs/README.md` — index of the contract docs handed to the app and HO portal developers.
- `docs/DATABASE.md` — every collection this service reads or writes.
- `docs/PROD-CHECKLIST.md` — what must exist in production before a feature goes live.
