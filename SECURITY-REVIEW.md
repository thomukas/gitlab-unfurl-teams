# Security review pack

## Release status

This checkout is not approved for production. The host JWT and OAuth adapters
are deny-only stubs. Local tests cover the implemented boundaries; they do not
prove live Teams authentication or deployment controls.

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
| Only expected authenticated activity shape processed | `activity.test.ts`, `server.test.ts` |
| Sender identity selects token | `handler.test.ts`; real token adapter still pending |
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
Deleting the shared Azure Bot OAuth connection affects the entire integration;
it is not a per-user revocation procedure. Per-user token-service disconnect and
credential rotation require a tested operational procedure before rollout.

Egress policy, managed secret injection, inbound request limits, production
monitoring and release/deployment automation are not provided yet. CI includes
an audit and SAST workflow; secret-scanning configuration, SBOMs and any image
scanning must be verified separately. Test live sign-in, refresh, revocation,
restricted projects, cross-audience sharing and failure recovery in a dedicated
tenant before deployment approval.
