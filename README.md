# dp-reality

Implementation companion to the master's thesis at BUT FIT. Architecture,
design decisions, module model, notification flow, and deployment
rationale live in the thesis (`dp-doc/chapters/`) — this README only
covers how to actually run the stack.

## Development

```bash
cp .env.example .env
docker compose -f compose.dev.yml up --build
```

`compose.dev.yml` is a **standalone** dev stack — do not merge it with
`compose.yml`. It publishes service ports to the host, uses a local
bridge network (no `nginx-proxy-manager` needed locally), points the
mailer at the dev SMTP server, and enables `docker compose watch`
live-reload blocks. `compose.yml` is reserved for production.

- Dashboard: http://localhost:3000
- RabbitMQ management: http://localhost:15672

MongoDB is **not** spun up by the stack; point `MONGODB_URI` at an
external instance.

## Production deploy (Portainer on Fedora CoreOS)

Stack type: **Repository**. Portainer clones the repo, reads
`compose.yml`, and injects stack variables. Host prerequisites:

1. An `nginx-proxy-manager` stack is already running and has created
   the `nginx-proxy-manager_default` network. The frontend attaches to
   that network so NPM can proxy to `dp-reality-frontend:3000` by
   container DNS — no host ports are published by this stack.
2. Portainer stack variables (or a host-side `.env` next to
   `compose.yml`) provide every `${VAR}` the compose file references —
   see `.env.example` for the full list. Non-secret tuning (SMTP host,
   from-address, scrape intervals) is baked into `compose.yml`.
3. External MongoDB is reachable from the host.

SELinux on CoreOS is a non-issue here: the stack uses only named
volumes (no host bind mounts), so the Docker daemon handles labeling
and the `:z`/`:Z` mount suffixes aren't needed.
