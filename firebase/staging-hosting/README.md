# JadeKey-Test: isolated Firebase Hosting package

**Project / Hosting site:** `jadekey-test`. **Plan:** Spark (no billing).
**Production:** `jadekey.tech` / `jadekey-46f37` must remain unchanged.

The generated `public/` folder is a strict allowlist of scanner pages, client
scripts and public scanner model assets. It does **not** include the repository's
`.git`, `server`, `shop`, developer files, customer documents or source tokens.
Assets are pulled from the existing public `jadekey.tech` site and checked
against the pinned SHA-256 hashes. No private stone records are copied.

## Build (does not publish)

From the repository root:

```sh
node firebase/staging-hosting/build.mjs
node --test tests/*.test.mjs
```

## Hosting-only release (not yet executed)

Requires a Firebase CLI session authenticated **by the owner**. Stop if the
console reports a different project or asks to upgrade the billing plan.

```sh
cd firebase/staging-hosting
firebase deploy --only hosting --project jadekey-test
```

The config targets Hosting site `jadekey-test` explicitly. It contains no
Firestore Rules or Functions deployment. A successful release is expected to
show `https://jadekey-test.web.app/scan.html`.

## Separate GitHub Actions deployment (iPhone-compatible)

`.github/workflows/deploy-jadekey-test.yml` can run only when the owner
explicitly pushes a release tag beginning `deploy-jadekey-test-` on a reviewed
test-branch commit. Ordinary commits (including on `main`) and PR merges never
start a release. It does not deploy Cloudflare or GitHub Pages, and explicitly
deploys to Firebase project and Hosting site `jadekey-test`. It builds the
public bundle and runs tests before deployment. This does not publish Firestore
Rules, Functions or Auth.

The owner must first create a **dedicated service account in the test Firebase
project only**, scoped for Firebase Hosting deployments, then add its JSON key
as a GitHub Actions repository secret named
`FIREBASE_SERVICE_ACCOUNT_JADEKEY_TEST`. Keep this private; do not put the JSON
key in the repository, an issue, a pull request, or a chat message.
If the secret is absent, the Action refuses to publish.

## Tests that still block customer use

- Staging Firestore currently has production-mode deny-all rules. Candidate
  `firebase/firestore.rules` is not published and needs emulator validation.
- Confirm both Firebase Auth providers, authorized test domain, and admin
  email verification. A newly created Auth project does not inherit production
  accounts or their verified status.
- Add only fake/test stones to staging and run customer recovery, reset and
  admin edit tests. Never copy real customer private records.
- Check the scanner model loads on an actual iPhone before public rollout.
- Do not merge the draft production PR or attach `jadekey.tech` to staging.

**Hosting has been initialized in Firebase Console but currently shows
"Waiting for your first release". That does not mean this package is live.**
