# gitlab-unfurl-teams

A self-hosted Microsoft Teams link extension for GitLab merge requests, issues
and epics. It runs as a Node HTTP service; the Teams ZIP registers the extension
and contains no backend code.

**Default: keep details in GitLab.** `PREVIEW_MODE=link` returns a generic
“GitLab link” card with an Open in GitLab action. It does not fetch an entity,
look up a GitLab token, or disclose whether the reference exists.

**Optional: share metadata into Teams.** `PREVIEW_MODE=metadata` uses the sender's
GitLab OAuth grant to fetch a rich card. Everyone who can read the posted Teams
message can read its title, project path, author, assignees, labels, state and
pipeline, even without GitLab access. GitLab access revocation does not remove
existing cards. Teams retention applies.

Metadata mode requires a nonempty `PROJECT_ALLOWLIST` of approved namespace or
project prefixes. Confidential issues and epics are withheld. The allowlist is
approval to disclose metadata, not recipient authorization or OAuth token scoping.
Keep link mode if metadata must remain protected by each reader's GitLab access.

## Status and supported deployment

The JWT and OAuth adapters are implemented and tested locally, including real
RSA signatures and mocked Microsoft token-service contracts. A compiled Azure
reference template and independently runnable backend ZIP are provided. **Live
Teams sign-in, refresh, revocation and infrastructure acceptance are still required
before production approval.** See [the acceptance checklist](docs/ADMIN.md#acceptance-tests).

The reference deployment uses Azure App Service, a SingleTenant Azure Bot,
a managed identity for Key Vault access, and a bot client secret in metadata
mode. That managed identity is for secret access, not bot authentication.
UserAssignedMSI bot authentication and sovereign clouds are not implemented.
AWS Lambda and GCP Node entry points share the same runtime, but this repository
does not provide their infrastructure templates or deployment acceptance evidence.

## Recognized links

| Entity | Shape |
|---|---|
| Merge request | `/{namespace}/{project}/-/merge_requests/412` |
| Issue | `/{namespace}/{project}/-/issues/88` |
| Epic | `/groups/{namespace}/-/epics/17` |

Other links produce no application card. The configured GitLab origin must use
HTTPS. Credentials cannot be redirected to a host from the pasted URL. The
extension works on paste; it does not scan existing messages. Installation is
required. Microsoft documents authenticated link unfurling as unsupported on
mobile; qualify desktop/web separately during acceptance testing.
[Microsoft link-unfurling guidance](https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/link-unfurling)

## Install and administer

Follow [the administrator runbook](docs/ADMIN.md). It covers roles, Entra and
GitLab registration, network prerequisites, deployment, pilot installation,
credential rotation, disconnect/revocation, monitoring, upgrades and removal.
Review [the security pack](SECURITY-REVIEW.md) with the data owner first.

Build prerequisites: Node 22 or 24, pnpm 10.33.0, `zip` and `unzip`. Azure
provisioning also needs Azure CLI and Bicep. No container registry is required.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm package:backend
pnpm package:verify
```

This produces `artifacts/gitlab-unfurl-backend.zip`, a CycloneDX inventory of
bundled runtime dependencies, and `SHA256SUMS`. The verification extracts the ZIP
into a temporary directory and starts it without `node_modules` or credentials.
CI checks Node 22 and 24 and retains the backend artifact for 30 days.

The Teams ZIP is tenant-specific. Set the variables documented in `.env.example`
in your shell or deployment system, including real publisher, privacy and terms
URLs, then run:

```sh
pnpm package:teams
```

It writes `manifest/build/gitlab-unfurl-teams.zip` and validates it against the
vendored Microsoft v1.17 schema. Preserve `BOT_ID` and increment `APP_VERSION` for
updates. Use the same `GITLAB_ORIGIN` and `OAUTH_ORIGIN` for packaging and runtime.
The scripts do not automatically load `.env` files. Never put secrets in the ZIP.

## Architecture

- `packages/core`: URL policy, disclosure configuration, bounded GitLab requests,
  card rendering and log redaction. No web framework dependency.
- `packages/app`: Connector JWT verification, tenant/activity binding, Microsoft
  token service, sign-in/disconnect, request limits and readiness.
- `hosts/azure`, `hosts/gcp`: Node HTTP listeners. `hosts/aws`: Lambda adapter.
- `deploy/azure`: reference infrastructure using an existing approved subnet,
  vault, Entra application and operations action group.

Link mode needs Microsoft JWKS access but no GitLab grant or outbound bot secret.
Metadata mode additionally acquires a bot token from Entra, gets the sender's
GitLab token from the selected Microsoft token service, then performs one bounded
GET against the configured GitLab origin. Microsoft stores the user grants;
the backend processes access tokens in memory. No application database is used.

## Development

`pnpm preview --sample` renders an offline rich-card example. Live previews need
`GITLAB_TOKEN`; the developer tool is not a production token flow.
`pnpm dev` binds to loopback with mocked Connector verification. To exercise
rich cards locally, explicitly set `PREVIEW_MODE=metadata`, `PROJECT_ALLOWLIST`,
`GITLAB_ORIGIN`, and `GITLAB_TOKEN`. Never deploy this development entry point.

## Credits and license

The URL taxonomy was informed by [kiwicom/gitlab-unfurly](https://gitlab.com/kiwicom/gitlab-unfurly)
and GitLab reference filters. MIT: see [LICENSE](LICENSE).
