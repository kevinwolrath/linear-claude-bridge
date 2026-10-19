# linear-claude-bridge

Turns a Linear issue assignment into a Claude Code job on the `.45` machine.

## Intended flow

`Linear assignment → webhook → bridge on .45 → queued Claude Code job → target repository → Linear/GitHub workflow`

The bridge does **not** replace Claude's existing Linear workflow. Its job is to notice the assignment, route the issue to the correct repository, and launch the equivalent of `Start QUE-123`.

## Current state

Bootstrap implementation includes:

- `GET /health`
- `POST /webhooks/linear`
- HMAC-SHA256 verification against the exact raw request body
- 60-second webhook timestamp validation
- `Linear-Delivery`/event diagnostic logging
- Dockerfile and Compose configuration for `.45`

Queueing, Claude assignment filtering, repository routing and the Claude runner are the next implementation slice.

## Local/Docker setup

1. Copy `.env.example` to `.env`.
2. In Linear, create a webhook under **Settings → API → Webhooks** and copy its signing secret into `LINEAR_WEBHOOK_SECRET`.
3. The public webhook URL must route to:

   `POST /webhooks/linear`

4. Start the service:

   `docker compose up --build -d`

5. Verify:

   `GET http://localhost:8080/health`

Linear requires the webhook endpoint itself to be publicly reachable over HTTPS. For `.45`, put a Cloudflare Tunnel/Worker or equivalent ingress in front rather than opening the machine directly to the internet.

## Security

Linear signs the raw webhook body using HMAC-SHA256 and supplies the signature in `Linear-Signature`. The raw bytes must be verified before JSON parsing. Stale webhook timestamps are rejected to reduce replay risk.

Never commit `.env`, webhook secrets, Claude credentials, GitHub credentials or Linear credentials.

## Repository routing

Routing will be configuration-driven. Planned example:

```env
REPOSITORY_ROUTES_JSON={"QUE":"/repos/quest-forge","DIN":"/repos/dinosaur-duel"}
```

Repository paths will be mounted into the Docker container on `.45`.

## Issue

Implementation is tracked in GitHub Issue #1: **Build Linear → Claude bridge MVP**.
