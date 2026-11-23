# JadeKey customer recovery — staging checklist

This branch is **not deployed**. It contains client UI, account recovery,
customer administration and an example Rules migration. The current main
branch and production Firestore must not be modified as part of review.

## Critical staging gates

1. Back up the full Firestore database, including `jk2_stones`,
   `jk2_patches`, `jk2_private` and all catalog registrations. Do not
   run production migrations or reset active stones without tested backups.
2. Deploy the accompanying `firestore.rules` **to a staging Firebase
   project first** and run Firestore emulator tests: anonymous visitor
   may view scanner metadata but cannot read clients/audits, owner may
   create/update own `jk2_clients` only with verified email, and admin
   can list clients and perform atomic edits. Only after these tests
   and owner approval may equivalent rules be applied to production.
3. Firestore's existing catchall policy permits broad reads and writes on
   other collections. This release only closes the two new collections;
   it does not claim to be a complete security audit.
4. Confirm `jadekey.tech` is in Firebase Authentication → Authorized domains
   (seen in the supplied screenshot). Email/Password, Email link and
   Anonymous must all remain enabled. Never turn off Anonymous for
   existing customers.
5. **Spark quota:** Firebase Authentication provides only five email-link
   sign-in emails/day on Spark. Do **not** require email from all buyers
   while this plan is in effect. Changing to Blaze requires the owner's
   separate approval and a billing budget/alerts.
6. Test sign-up on iOS Safari, link completion in the **same browser**,
   recovery on a different phone, and lost localStorage. Verify the UID
   stays the same on the original phone and the stone remains visible.
   Follow the actual Firebase action URL end-to-end; do not infer success
   from a 'Done' message or from an email merely being sent.
   The email action landing page must reach `/scan.html` with an `oobCode`.
   If Firebase's default Hosting handler does not forward that code,
   configure the Email link **action URL** in Authentication → Templates
   to `https://jadekey.tech/email-action.html` (only after deploying and
   verifying the staging equivalent). Merely authorizing the domain is
   not sufficient. Never change email templates on production untested.
7. Test delivery to mail.ru, Yandex and Gmail, including Spam folders.
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
