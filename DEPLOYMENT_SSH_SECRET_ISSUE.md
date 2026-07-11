# Deploy to Dev — `appleboy/scp-action` SSH Authentication Failure

## 1. Summary

The **Deploy — Development** workflow's `deploy-dev` job fails at the "Copy artefact to Dev
server" step (`appleboy/scp-action@v1`). This is a missing/misconfigured **GitHub Environment
secret**, not a code or workflow-logic bug — no source file change can fix it. It must be
resolved in the repository's GitHub settings by someone with admin access.

## 2. Where it happens

- **Workflow:** `.github/workflows/deploy.yml`
- **Job:** `deploy-dev` (`environment: development`)
- **Step:** `Copy artefact to Dev server` (`uses: appleboy/scp-action@v1`)
- **Trigger:** any push to `main` (the job runs after `build-and-test` and `publish` succeed)

The same secret set is also consumed by:
- `.github/workflows/release.yml` → `deploy-dev` job (identical secrets, triggered on version tags)
- `.github/workflows/release.yml` → `deploy-uat` job (equivalent `UAT_*` secrets)
- `.github/workflows/release.yml` → `deploy-prod` job (equivalent `PROD_*` secrets)

So this is not a one-off — if `DEV_SSH_KEY` is missing, **every workflow that deploys to Dev**
will fail the same way, and the equivalent `UAT_SSH_KEY` / `PROD_SSH_KEY` secrets should be
checked too before they're needed.

## 3. Raw error

```
Run appleboy/scp-action@v1
Run echo "$GITHUB_ACTION_PATH" >> $GITHUB_PATH
Run entrypoint.sh
Downloading drone-scp-1.8.0-linux-amd64 from https://github.com/appleboy/drone-scp/releases/download/v1.8.0
======= CLI Version Information =======
Drone SCP version 1.8.0
=======================================
2026/07/06 02:07:40 Error: can't connect without a private SSH key or password
Error: Process completed with exit code 1.
```

## 4. Root cause

`appleboy/scp-action` (and the matching `appleboy/ssh-action` step right after it) requires
either a `key` (private SSH key) or a `password` input to authenticate to the target host. In
`deploy.yml`:

```yaml
- name: Copy artefact to Dev server
  uses: appleboy/scp-action@v1
  with:
    host: ${{ secrets.DEV_HOST }}
    username: ${{ secrets.DEV_USER }}
    key: ${{ secrets.DEV_SSH_KEY }}
    port: ${{ secrets.DEV_PORT }}
    source: api.zip
    target: /tmp/
```

`key: ${{ secrets.DEV_SSH_KEY }}` resolved to an **empty string**, so the action had nothing to
authenticate with and drone-scp refused to even attempt a connection. GitHub Actions silently
resolves an undefined/unset secret to `""` rather than failing the workflow at expansion time,
which is why this only surfaces here, deep in the third-party action's own validation.

This means one of the following is true in the repo's GitHub settings:
- `DEV_SSH_KEY` was never created, or
- `DEV_SSH_KEY` exists at the wrong scope (e.g. a repository secret when the job pins
  `environment: development`, or vice versa — environment secrets and repository secrets do not
  automatically fall back to one another), or
- `DEV_SSH_KEY` exists but is empty/blank.

## 5. Required secrets (full picture)

| Environment | Secrets required | Used by |
|---|---|---|
| `development` | `DEV_HOST`, `DEV_USER`, `DEV_SSH_KEY`, `DEV_PORT`, `DEV_CONNECTION_STRING`, `DEV_JWT_SECRET` | `deploy.yml` → `deploy-dev`, `release.yml` → `deploy-dev` |
| `uat` | `UAT_HOST`, `UAT_USER`, `UAT_SSH_KEY`, `UAT_PORT`, `UAT_CONNECTION_STRING`, `UAT_JWT_SECRET` | `release.yml` → `deploy-uat` |
| `production` | `PROD_HOST`, `PROD_USER`, `PROD_SSH_KEY`, `PROD_PORT`, `PROD_CONNECTION_STRING`, `PROD_JWT_SECRET` | `release.yml` → `deploy-prod` |

Only `*_HOST`, `*_USER`, `*_SSH_KEY`, `*_PORT` are needed to fix *this specific* SCP/SSH error.
`*_CONNECTION_STRING` and `*_JWT_SECRET` are consumed later in the same job (written into
`appsettings.Production.json` on the target server) — worth confirming they're populated too so
the fix doesn't just move the failure one step further down the job.

## 6. How to fix

This must be done by someone with **admin access to the GitHub repository**
(`Trust-Internship/trust-digital-communication`).

1. **Generate a dedicated deploy keypair** (don't reuse a personal SSH key):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy-dev" -f dev_deploy_key -N ""
   ```
   This produces `dev_deploy_key` (private) and `dev_deploy_key.pub` (public).

2. **Authorize the public key on the Dev server**, under the account the workflow will log in
   as (`DEV_USER`):
   ```bash
   ssh dev-server "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys" < dev_deploy_key.pub
   ```
   Verify permissions are correct on the server: `~/.ssh` = `700`, `authorized_keys` = `600`.

3. **Add the private key as a GitHub Environment secret**, not a repository secret, since
   `deploy-dev` pins `environment: development`:
   - GitHub → repo → **Settings** → **Environments** → **development** → **Environment secrets**
     → **Add secret**
   - Name: `DEV_SSH_KEY`
   - Value: the full contents of `dev_deploy_key` (the private key file), including the
     `-----BEGIN OPENSSH PRIVATE KEY-----` / `-----END OPENSSH PRIVATE KEY-----` lines, no
     trailing modifications.

4. **While in that Environment secrets page, confirm the other three are also present and
   correct**: `DEV_HOST`, `DEV_USER`, `DEV_PORT` (typically `22` unless the server uses a
   non-standard port).

5. **Delete the local private key file** (`dev_deploy_key`) once it's pasted into GitHub — don't
   leave deploy keys sitting on a laptop or commit them anywhere in the repo.

6. Repeat steps 1–5 for `uat` (`UAT_*`) and `production` (`PROD_*`) environments before those
   deploy stages are exercised, to avoid hitting the identical failure later in the pipeline.

## 7. How to verify the fix

- Re-run the failed workflow run from the GitHub Actions UI ("Re-run failed jobs"), or push a new
  commit to `main` to trigger `deploy.yml` fresh.
- The `Copy artefact to Dev server` step should complete without the drone-scp error.
- The following step, `Deploy on Dev server` (`appleboy/ssh-action`), uses the **same**
  `DEV_SSH_KEY` — if step 6 succeeds, step 7 should authenticate the same way. If it fails
  separately, re-check that the public key was appended to the correct user's
  `authorized_keys` on the Dev server (not a different user than `DEV_USER`).

## 8. Related, but distinct, CI issue

This is unrelated to the `ConnectionStrings 'DefaultConnection' not found` failure fixed
separately in `deploy.yml`'s/`release.yml`'s **`build-and-test`** job (see
`docs/HANDOVER.md` §5's note on `ConnectionStrings__DefaultConnection`, and the fix commit adding
that env var). That earlier issue was a missing **plain env var** consumed directly by the .NET
app's own configuration binding during test startup. This issue is a missing **GitHub Environment
secret** consumed by a third-party SSH action in a later, separate job (`deploy-dev`) that only
runs after `build-and-test` already passes. Fixing one does not fix the other.
