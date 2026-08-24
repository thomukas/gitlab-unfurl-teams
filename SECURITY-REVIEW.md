# Security Review Pack

For the reviewer who must approve running this in your tenant. Every claim
here is checkable against the source. Run `pnpm test` to see the controls
pass: 146 tests, no network access required.

---

## The short version

The application holds **no shared GitLab credential** and **never chooses an
authenticated request destination from untrusted input**. Each GitLab request
is made as the authenticated Teams user, to one administrator-configured
GitLab origin, using a read-only OAuth scope. GitLab remains the
authorization authority for every project.

---

## The questions you are going to ask

| Question | Answer |
|---|---|
| What Microsoft Graph permissions does it request? | **None.** It is a bot endpoint. It reads no mailbox, no calendar, no directory. The manifest requests only `identity`. |
| What data leaves the tenant? | One HTTPS request per pasted link, to the configured GitLab origin only. It carries the project path and the entity number. |
| What does it store? | No application datastore. No database, no disk write, no cache. See "What is and is not stored" below. |
| What credentials does it hold? | The bot secret only. It holds **no** GitLab credential: the GitLab OAuth client secret lives in the Azure Bot Service connection, and user tokens live in the Microsoft-operated Bot Framework token service. |
| Whose GitLab data can a user see? | Their own, and only their own. The application acts as the signed-in user. |
| How broad is the GitLab scope? | `read_api`. Stated honestly, this grants read access to the GitLab API for **every resource accessible to that user**, not merely the pasted project. It is read-only: it cannot write, merge, approve or delete. It is the narrowest scope GitLab offers for reading issues and merge requests. |
| Can a pasted link redirect the credential elsewhere? | No. The destination comes from configuration only, and the validated reference deliberately carries no host. Redirects are refused outright. |
| What can a compromised instance do? | Read what a currently signed-in user can already read. Egress policy limits reach further. |
| How do we revoke one user? | The user revokes the authorization in GitLab, or an administrator deletes the Bot Service OAuth connection. No code change, no redeploy. |
| Does it let someone enumerate private projects? | No. `403` and `404` produce a byte-identical response. |
| Does it work without installing the app? | No, deliberately. `supportsAnonymizedPayloads` is absent. |

---

## Security invariants and the tests that prove them

| # | Invariant | Proven by |
|---|---|---|
| I1 | A GitLab token is never shared between Teams users | `packages/app/test/handler.test.ts` — "sends user A the token belonging to A, never to B" |
| I2 | A token is sent only to the configured origin | `packages/core/test/gitlab-client.test.ts` — "calls the configured origin, never a host from the ref"; `url-validator.test.ts` — "the returned ref carries no host"; `handler.test.ts` — "never calls GitLab when the URL fails validation" |
| I3 | Authenticated requests never follow redirects | `packages/core/test/gitlab-client.test.ts` — "sets redirect:error so a redirect cannot move the token", "fails rather than following a refused redirect" |
| I4 | GitLab communication requires HTTPS | `packages/core/test/config.test.ts` — rejects `http://`, `ftp://`, no-scheme; `url-validator.test.ts` — scheme rejections |
| I5 | Every request passes JWT validation | `packages/app/test/server.test.ts` — 401 without a header, 401 on a bad token, 401 when the verifier throws; `hosts/aws/test/deps.test.ts` — the unwired stub denies. **Partial: see "Not yet implemented" below.** |
| I6 | Only the expected invoke is processed | `packages/app/test/activity.test.ts` — 14 rejection cases; `handler.test.ts` — "never calls GitLab when the activity is rejected" |
| I7 | Token lookup is bound to the authenticated user | `packages/app/test/handler.test.ts` — "looks the token up by the authenticated user id, never a fixed one" |
| I8 | GitLab remains the authorization authority | By construction: the request carries the user's own token, so GitLab decides. The allowlist is a blast-radius control only. |
| I9 | No cross-user card reuse | `packages/core/test/card-builder.test.ts` — "always sets no-cache" |
| I10 | 403 and 404 are indistinguishable | `packages/core/test/gitlab-client.test.ts` — both map to `not-found`; `handler.test.ts` — "returns byte-identical responses for 403 and 404" |
| I11 | Tokens, JWTs, URLs and bodies are never logged | `packages/core/test/redact.test.ts`; `handler.test.ts` — "never logs the token, the full URL or the raw project path" |
| I12 | GitLab strings and URLs are bounded and validated | `packages/core/test/card-builder.test.ts` — 13 tests covering markdown links, bare URLs, hostile schemes, length and collection caps |
| I13 | Request, response and fan-out limits are enforced | `packages/core/test/gitlab-client.test.ts` — size cap, declared-length short circuit, timeout, "makes exactly one request per call"; `url-validator.test.ts` — URL length cap |
| I14 | Production egress is restricted | **Infrastructure. Not yet implemented.** |
| I15 | Bot credentials come from a managed secret store | **Infrastructure. Not yet implemented.** |

---

## Two design decisions worth your attention

**The validated reference carries no host.** `GitLabRef` is `{ kind, projectPath, iid }`.
The validator proves the pasted origin equals the configured origin, then
discards it. The client cannot be pointed anywhere by pasted input, because it
never receives a destination.

**Two checks exist because of verified parser behaviour, not caution.**

- `https://evil.com@gitlab.example.com/…` parses with an origin **equal to**
  the configured one and a username of `evil.com`. Origin equality alone does
  not catch it, so userinfo is checked explicitly.
- `https://gitlab.example.com/g%2Fp/-/issues/1` keeps `%2F` encoded in
  `pathname`. Decoding before splitting would turn `g%2Fp` into the different
  project `g/p`, so encoded separators are rejected before any decoding.

Both are in the rejection corpus in `packages/core/test/url-validator.test.ts`.

---

## What is and is not stored

The application has no intentional persistent datastore. Operational
infrastructure — container logs, load balancer logs, platform telemetry, error
tracing — may transiently process request metadata under your hosting
provider's retention policy.

The application MUST NOT log OAuth tokens, `Authorization` headers, full GitLab
URLs, request bodies or GitLab response bodies. `projectPath` is hashed, because
a path such as `/acquisition/project-x/` is itself confidential business
information. The entity number is dropped entirely, since it would narrow the
hash to a single item.

A log line looks like this:

```
{"host":"gitlab.example.com","outcome":"ok","latency_ms":182,"entity":"merge_request","project":"a3f9c1e40b27"}
```

---

## Not yet implemented

Stated plainly, because a review of a partly-built system is worthless without
it. These need live Azure resources and cannot be built or verified locally.

| Gap | Consequence today |
|---|---|
| `lookupToken` is not wired to the Bot Framework token service | Returns `null`. Every request gets the sign-in card. |
| `verifyJwt` is not wired to real JWKS validation | Returns `false`. Every request is refused with 401. |
| Egress policy (I14) | Not enforced. |
| Managed secret injection (I15) | Not enforced. |
| CI: audit, SAST, secret scanning, SBOM, image scanning | Not present. |

**Both credential stubs deny.** A deployment shipped in this state refuses every
request rather than serving one unauthenticated. `hosts/aws/test/deps.test.ts`
asserts this, so a future change that flips a stub to allow will fail the suite.
