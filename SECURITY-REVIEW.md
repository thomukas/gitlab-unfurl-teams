# Security review pack

## Release status

This checkout requires deployment acceptance testing before production approval.
The shared host adapter verifies Connector JWTs and integrates the Microsoft
OAuth token service. Offline tests verify real RSA signatures and mocked token
service contracts; they do not prove live Teams authentication or cloud controls.
Only Microsoft public-cloud, SingleTenant bots are supported.

## Sharing boundary

`PREVIEW_MODE=link` is the default. It returns a generic card and a canonical
GitLab link, without looking up a token or fetching an entity. It does not reveal
whether an item exists. The destination contains the reference the user pasted;
query strings, fragments and trailing subpaths are removed.

`PREVIEW_MODE=metadata` is an explicit disclosure setting. It requires a
nonempty `PROJECT_ALLOWLIST` of approved namespace/project prefixes. The sender's
OAuth grant authorizes the API read. Every reader of the posted Teams message
can see the card's title, project, author, assignees, labels, state and pipeline.
Readers do not need GitLab permissions. Confidential issues/epics are withheld;
non-confidential items in private projects can still be sensitive.

Approve prefixes only when this disclosure is acceptable, including the audiences
in chats/channels and any guests. No-cache controls preview reuse, not the access
or retention of a posted message. Revoking GitLab access does not retract cards.
If GitLab must authorize each reader, keep link mode and view details in GitLab.

## Credentials and data flows

- No Microsoft Graph or resource-specific consent permissions are requested;
  the manifest requests identity only.
- Metadata mode uses `read_api`, which grants broad read access to resources
  accessible to the GitLab user, not just the allowlisted projects. The allowlist
  constrains this application's normal behavior, not a stolen token's scope.
- The configured Microsoft token service stores user OAuth grants. The Azure Bot
  OAuth connection holds the GitLab OAuth client secret. The backend processes
  returned GitLab access tokens in memory and holds a bot credential.
- A compromised backend can steal tokens it processes and abuse its bot identity.
  Read-only scopes, egress restrictions and a secret store reduce risk; they do
  not make backend compromise harmless or restrict it to the currently open chat.
- In metadata mode, GitLab API results pass through the backend to Microsoft
  Teams. Posted cards become message content subject to tenant retention and
  discovery controls. There is no application database or entity cache.
- Infrastructure logs and telemetry have separate access and retention controls.
  Do not enable body/header capture or token-bearing URL capture at proxies.
- Choose token-service region, hosting region and network routes with the data
  owner. Using your own Azure subscription alone is not a data residency guarantee.

GitLab documents the grant at <https://docs.gitlab.com/integration/oauth_provider/>.
Microsoft documents token storage at
<https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-concept-authentication>.

## Implemented controls and evidence

| Control | Evidence |
|---|---|
| Generic cards by default; metadata requires approved prefixes | `config.test.ts`, `handler.test.ts` |
| Confidential entity metadata withheld | `gitlab-client.test.ts`, `handler.test.ts` |
| HTTPS, exact configured origin, no userinfo or encoded separators | `config.test.ts`, `url-validator.test.ts` |
| API destination constructed from trusted configuration; redirects refused | `gitlab-client.test.ts` |
| Connector signature, issuer, bot audience, lifetime, Teams key endorsement and service URL; tenant/recipient binding | `jwt.test.ts` |
| Query-link and caller-bound account actions only | `activity.test.ts`, `handler.test.ts` |
| 64 KiB inbound body, deadline, concurrency and per-user/process rate guards | `server.test.ts` |
| Sender identity selects token | `handler.test.ts`; token-service tests bind user, connection and channel |
| No preview cache reuse | `card-builder.test.ts` |
| 403/404 have identical response bodies | `handler.test.ts`; not a guarantee of identical timing |
| Sanitized and bounded card text and action URLs | `card-builder.test.ts` |
| One GitLab request with deadline and response-size cap | `gitlab-client.test.ts` |
| Allowlisted log fields omit tokens, raw URLs and bodies | `redact.test.ts`, `handler.test.ts` |
| Dependency audit and CodeQL workflows, SHA-pinned actions | `.github/workflows/` |

Namespace hashes in logs are pseudonymous correlation identifiers. Unsalted
hashes of guessable project paths are not anonymization. Restrict log access.

## Revocation and operations

A user can revoke the grant under GitLab **Edit profile → Access → Applications**.
Removing a Teams app does not establish that its GitLab authorization was revoked.
The extension's **Disconnect GitLab** action removes only the authenticated
caller's token-service connection after confirmation. It never accepts a target
user from the action data. GitLab-side revocation is a separate step. A GitLab
401 invalidates the stored token and returns a new sign-in action.
Deleting the shared Azure Bot OAuth connection affects the entire integration;
it is not a per-user revocation procedure.

The runtime enforces bounded network calls, input size, 40 concurrent invokes,
30 invokes per user per minute and 600 per process per minute. These are local
process guards; a shared gateway is needed for limits across replicas.
`/healthz` is liveness. `/readyz` verifies JWKS availability and, in metadata mode,
bot credential acquisition. It does not prove the OAuth connection or GitLab is
reachable. Correlation IDs and fixed error categories are emitted without raw
upstream errors. OAuth state/code validation is delegated to Microsoft's token
service, with caller-bound sign-in links and code forwarding on resumed invokes.
The Azure reference template supplies a Key Vault reference, a dedicated secret
reader, restricted ingress/SCM, logs and baseline alerts. It requires an existing
approved subnet and routes outbound traffic through it; the network owner must
supply and test the actual egress policy. It is a compiled reference, not evidence
of a completed deployment. See `docs/ADMIN.md` for roles and live acceptance.
Backend packaging bundles the runtime, records its source commit and produces a
CycloneDX inventory and checksums. CI verifies the isolated ZIP. Teams packages
require real publisher URLs and pass the vendored Microsoft schema validator. CI includes
an audit and SAST workflow. Secret-scanning configuration still needs to be
verified for the repository. There is no container image in the reference path;
an organization choosing containers must add image scanning. Test live sign-in, refresh, revocation,
restricted projects, cross-audience sharing and failure recovery in a dedicated
tenant before deployment approval.

Implementation references: [Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication),
[Microsoft token-service protocol](https://github.com/microsoft/botbuilder-dotnet/blob/main/libraries/Swagger/TokenAPI.json),
[OAuth regional endpoints](https://learn.microsoft.com/en-us/azure/bot-service/ref-oauth-redirect-urls).
