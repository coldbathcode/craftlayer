# ADR 0048 — Remote MCP carries the caller's own agent token and holds none

Status: adopted for master plan step C4 on 2026-11-12. Built and verified locally over real HTTP against a stand-in API. Not deployed on the family VPS; that state is on the [status board](../../plan/STATUS.md).

## Context

The MCP server ([ADR 0035](0035-agent-token-authority.md), [ADR 0041](0041-agent-requests.md)) spoke only stdio, so an agent had to run on a machine holding a checkout of this repository and a token in its configuration. The plan asks for a Streamable HTTP endpoint on the VPS, behind the private access layer, with token validation and rate limits. A long-lived network service that speaks for agents is a new place to get authority wrong, so the question is what it is allowed to hold and decide.

## Decision

1. **A second entry point, the same tools.** `apps/mcp/dist/remote-main.js` serves the tools of the stdio server over Streamable HTTP at `POST /mcp`, with the official SDK transport (1.32.2). No tool was added, removed or changed. It uses `node:http` directly and adds no dependency.
2. **The service holds no token.** Every request must carry the caller's own agent token as `Authorization: Bearer cla_…`. A request without a well-formed one is answered `401` with `WWW-Authenticate: Bearer` before any MCP handling. The token lives in memory for that one request, is forwarded to the API unchanged, and is never stored or logged.
3. **The API stays the only authority.** The service checks only the token's shape. Scope, expiry, revocation and the creating adult's current authority are decided by the API on every tool call, exactly as for stdio, so a revoked token fails on its next call and surfaces as an ordinary tool error. Listing tools does not call the API; a well-formed but unknown token can therefore see the tool catalogue, which is public in this repository, and nothing else.
4. **Stateless.** Each request builds a fresh MCP server and transport and discards them with the response; replies are plain JSON. There are no sessions to steal or resume, no server-initiated stream (`GET` and `DELETE` are answered `405`), and nothing to lose on restart.
5. **One family per deployment.** The organization comes from the service's own `CRAFTLAYER_ORGANIZATION`, never from the caller, because the API requires the organization header and a token does not name its organization on the wire. The API still checks that the token belongs to that organization; one from another family is refused there. A multi-family host would need the API to derive the organization from the token, which is a change to the API and not made here.
6. **Private by construction.** The service refuses to start on anything but a loopback address unless `CRAFTLAYER_MCP_ALLOW_NON_LOOPBACK_BIND=true` is set, which the Compose overlay does only because the container's port is published on the host's `127.0.0.1`. It is reached through `tailscale serve` (HTTPS on the family tailnet) and never through a public port. Plain HTTP to the API is refused unless it is this machine or the operator states it is a private container network.
7. **Host and Origin are checked before the token.** `Host` must name an allowlisted hostname (port ignored) and any `Origin` must be allowlisted exactly; with the default empty origin list every browser origin is refused. This is the DNS-rebinding defence. The SDK transport's own options for this are deprecated in favour of checks outside it, so the check is ours, made before the transport sees the request.
8. **Fixed limits in memory.** Sixty requests a minute per token (keyed by a SHA-256 of the token, at most 10,000 keys, new keys refused when full) and three hundred a minute for everyone together, counted before the token check so unauthenticated traffic is bounded too. Over the limit is `429` with `Retry-After`. Bodies are capped at 64 KiB (declared or streamed) and a request is abandoned with `504` after 30 seconds. All four are settable by environment within hard bounds.
9. **Logs are codes.** One line per request with an outcome code and status. No token, header, body, tool name or argument is written.

## Consequences

- The plan's "OAuth-style token validation" and the management architecture's issuer, signature, audience and discovery checks are **not** built. Agent tokens are opaque secrets validated by the API, and the endpoint is reachable only inside the tailnet. A client that insists on OAuth discovery cannot connect; clients that accept a fixed bearer header can. Exposing this endpoint beyond the private layer would need that work and a new decision first.
- The limits reset when the service restarts and are per process. That is acceptable for one small instance; the API's own limits and checks are unaffected.
- Anyone on the tailnet can spend the shared allowance without a token. Tailnet membership is the outer gate; the per-minute window bounds the nuisance.
- A stolen token works from any tailnet device until it is revoked or expires, as it already does against the API directly. Revocation remains immediate.
- The API sees every remote agent call arriving from the service's container address. Audit attribution is unchanged because it comes from the token.
- The API's remote-management gate ([ADR 0042](0042-two-factor-sign-in.md)) is decided per deployment, not per request, so forwarded agent calls meet the same gate as the dashboard. This has not been exercised on the VPS; the first deployment must check a read and a request end to end.
