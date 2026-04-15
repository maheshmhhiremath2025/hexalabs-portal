# Security Notes — Plaintext Credentials

## Status

**Plaintext password storage in Mongo is NOT addressed in this work.**
This is a deliberate non-action, documented here so it's not forgotten.

## Where plaintext passwords currently live

| Collection | Field | Notes |
|---|---|---|
| `awsusers` | `password` | Pre-existing pattern from before this work. Set when the IAM user is created via `services/directSandbox.js`. |
| `sandboxusers` | `password` | Same — pre-existing Azure sandbox flow. |
| `sandboxdeployments` | `password` | New collection added by this work. Stores credentials returned by template-based deploys so they survive page refresh. |
| `users` | `password` | Pre-existing core user model. **Already bcrypt-hashed** via the auth flow — this one is fine. |

## Why this isn't fixed yet

1. **Ops needs to retrieve credentials.** The whole point of storing them is so ops can copy them and share with the customer. If we hash, we can't show them. Hashing only works if we encrypt-and-decrypt, not hash-and-compare.
2. **Field-level encryption (FLE) is non-trivial in this codebase.** It requires:
   - Picking a key management approach (Azure Key Vault, AWS KMS, env-var key, hardware token)
   - Wrapping every read site in a decrypt call
   - A migration script for existing rows
   - Key rotation strategy
   - Testing every read path
3. **The threat model is mid-priority.** A breach of the Mongo collection would expose ~weeks of training-account credentials. Not customer payment data, not user passwords (those are bcrypt'd), not API keys. Bad but not catastrophic.
4. **The pre-existing pattern is what it is.** The new `sandboxdeployments` collection follows the same pattern as `awsusers` so anyone touching the codebase has consistent expectations. Fixing one without the other would create asymmetric handling.

## What should be done (separate effort, prioritized)

### Option A: Mongo Client-Side Field Level Encryption (CSFLE)
- MongoDB native FLE with deterministic or random encryption per field
- Requires Mongo Enterprise OR a community workaround
- ~2-3 days work + key vault setup
- **Recommended for production**

### Option B: Application-level encryption with `crypto.createCipheriv`
- AES-256-GCM with key from a secret manager
- One helper function called from every read/write site
- ~1 day work + careful read-site audit
- Less robust than CSFLE (key handling is in app code) but works without Mongo Enterprise

### Option C: Move credentials to a real secret manager
- AWS Secrets Manager / Azure Key Vault / HashiCorp Vault
- Mongo stores only a secret ID; the actual password is fetched on read
- Cleanest but most invasive change

## What I did add to mitigate the risk

1. **Visibility filtering on the new endpoint**: `GET /sandbox-templates/:slug/deployments` only returns deployments where the current user is the deployer (or admin/superadmin). Non-admin users cannot enumerate other users' credentials.
2. **Soft delete for cleanup**: When ops clicks "Hide" on a deployment in the UI, the record is marked `state='deleted'` and stops appearing in listings. The cron cleanup eventually drops the actual cloud resource and the record can be hard-purged.
3. **TTL-based expiry**: Every `sandboxdeployments` row has an `expiresAt` (default 4 hours from creation). The new `sandboxDeploymentCleanup` cron drains them automatically. So the window of exposure for any given password is bounded.
4. **No logging of passwords**: I checked every `logger.info` / `logger.error` call I added — none of them log password values. Only usernames and IDs.

## What you should do today (operational mitigations)

These cost nothing and help immediately:

1. **Make sure `dockerfiles/backend/.env` is in `.gitignore`** — it has the Razorpay live key, AWS access key, Azure client secrets, Gmail app password, and now Claude API key. If this file leaks via git, all of those leak.
2. **Restrict Mongo network access** — bind to `127.0.0.1` only, never `0.0.0.0`. Your `docker-compose.yml` already does this for the production Mongo (`127.0.0.1:27017:27017`). Don't change that.
3. **Rotate the keys exposed in chat history** during this build session (the Claude API key was pasted in a prior message; treat it as compromised).
4. **Audit who has admin/superadmin role** — those users can call `GET /sandbox-templates/:slug/deployments` and see everyone's credentials. Keep that list small.
5. **Set up Mongo audit logging** for reads on the `sandboxdeployments`, `awsusers`, and `sandboxusers` collections. So if a leak happens, you have a trail.

## Summary

| Concern | Status | Owner |
|---|---|---|
| New `sandboxdeployments` plaintext passwords | Known, documented, not fixed | Future work |
| Pre-existing `awsusers` plaintext passwords | Known, documented, not fixed | Future work (pre-existing) |
| User account passwords | Bcrypt-hashed in `users` collection | OK |
| API keys in `.env` | Baked into container image at build time | Architectural concern, separate effort |
| Visibility (who can read deployments) | Admin-only via API filter | Done |
| TTL-bounded exposure window | 4 hours by default | Done |
| Cleanup of expired records | Automated via `sandboxDeploymentCleanup` cron | Done |

Bottom line: the new feature is no worse than the existing codebase on this
front, and adds several mitigations the existing flow didn't have.
The full fix is a separate effort that touches the entire codebase.
