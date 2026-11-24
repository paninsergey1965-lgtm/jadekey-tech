# JadeKey customer recovery — staging checklist

These changes are for `jadekey-test` only. Main, production Firebase
(`jadekey-46f37`) and the real catalog must remain untouched. A staging
release tag deploys the separate tested rules from
`firebase/staging-firestore/firestore.rules`; it must never deploy the old
review example `firebase/firestore.rules` to production.

## Critical staging gates

1. Back up the full Firestore database, including `jk2_stones`,
   `jk2_patches`, `jk2_private` and all catalog registrations. Do not
   run production migrations or reset active stones without tested backups.
2. Deploy the accompanying `staging-firestore/firestore.rules` **only to the
   staging project**. The tag-only GitHub workflow runs emulator tests first:
   anonymous visitor
   may view scanner metadata but cannot read clients/audits, owner may
   create/update own `jk2_clients` only with verified email, and admin
   can list clients and perform atomic edits. Only after these tests
   and owner approval may equivalent rules be applied to production.
3. Staging denies access to all unlisted collections. Scanner fingerprints
   are public, but private profiles and email indexes are not. **This is
   not a production security audit:** until a server validates purchases,
   an authenticated user could forge an activation over REST. Keep real
   customers and all 70 real stones out of staging.
4. In the **staging Firebase project**, enable Authentication → Sign-in
   method → **Email/Password** and **Anonymous**. Keep Anonymous enabled
   to preserve current stone owners. Do not enable production settings yet.
5. **Spark quota:** Sign-in *links* are limited to five emails/day on Spark,
   so the staging customer flow now uses **email + password** with
   `VERIFY_EMAIL`. Address verification supports 1000 emails/day on Spark;
   password resets support 150/day. Do not reintroduce email-link sign-in
   as a required buyer step or switch to Blaze without owner approval.
6. Test registration and confirmation on iOS Safari **and** the native app.
   Verify email/password links the existing anonymous UID without changing
   stone ownership, including when the owner already has an activated
   stone. Check `email_verified` on a freshly refreshed Firebase token,
   and confirm only verified addresses enter `jk2_clients`.
   Then test login/recovery on another phone, password reset, wrong password,
   lost localStorage, and emails that arrive after a delay. Check the real
   Firebase email action link end-to-end; do not infer verification from
   an email having been sent or a green button.
7. Test verification and password reset delivery to mail.ru, Yandex and
   Gmail, including Spam folders. Keep email/password provider enabled.
8. Verify existing 70 catalog stones remain searchable by camera and
   activation works for an anonymous user after release. Do a test
   activation and reset **in staging**, verifying photos, embeddings,
   patches and JK registration are preserved.
9. The new activation screen requires explicit data-consent. Privacy text
   and data retention/deletion policy need legal review before launch.
   The modified `privacy.html` in this branch is a draft, **not legal approval**.
10. Old live stones still contain owner's names in public `jk2_stones`.
    New activations use a generic public name. Migration of historical
    names needs a separate owner-approved batch after backup; do not
    overwrite catalog names or original registration records.
    **A second legacy privacy issue remains:** `jk2_private` documents with
    `share: true` are readable in full, including birth date in `profile`.
    The scanner now warns when enabling sharing, but genuine field-level
    privacy requires splitting public messages from the private profile
    (Firestore rules cannot hide individual fields in a readable document).
    Review already-shared stones and do not promise full privacy until a
    split-data migration is completed.
11. Admin controls include mode change, transfer to an already linked
    verified account and **activation reset**. Deleting a Firebase Auth
    user itself requires Admin SDK/service credentials (not supplied to
    browser code) and is **not** implemented. Never claim that an
    activation reset removes an Authentication user.
12. For every admin action, verify one Firestore `documents:commit`
    atomically writes the change and `jk2_adminlog` audit record.

## Rollback

Since main and production are untouched, the immediate rollback is to
leave this branch unpublished. If eventually deployed, restore the
previous published `scan.html`/`live.html` and retain the restrictive
Firestore Rules; do **not** revert the rules to re-expose client emails.
