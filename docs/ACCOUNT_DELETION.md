# Account Logout and Deletion

MEJay account identity and entitlements are stored in Neon PostgreSQL. The old Cloudflare D1 deletion commands are not the production account-deletion path.

## Logout

`POST /api/auth/logout` deletes the active server session and expires the `mejay_session` cookie. The client clears cached identity, plan, Stripe customer, guest, and auth-bypass state only after the API confirms success.

## Self-service deletion

`DELETE /api/account` always derives the account from the authenticated session. It does not accept a user ID. The request body must contain the current email:

```json
{
  "email": "user@example.com",
  "forfeitFullProgram": false
}
```

Deletion policy:

- Free accounts may be deleted immediately.
- Pro subscriptions must be canceled and must reach the end of the paid period. `cancel_at_period_end` alone does not permit deletion.
- Active, trialing, past-due, and unpaid subscription states block deletion.
- Full Program owners must send `forfeitFullProgram: true`, permanently forfeiting the purchase and license.
- Provider owners with other members must transfer ownership before deleting their account.
- Ordinary provider members may delete their account without deleting the shared provider catalog.
- A sole provider owner deletes the provider profile and its marketplace catalog.

Successful deletion removes sessions, entitlements, authentication codes, provider membership or sole-owned provider data, marketplace staff access, and the user record in one transaction. Marketplace audit rows are retained only after provider/user identity and JSON snapshots are anonymized.

After server deletion succeeds, the browser removes IndexedDB tracks and playlists, settings, license activation, checkout state, guest identity, auth bypass, and other `mejay:` storage keys.

## Verification

From `api/`:

```bash
npm run typecheck
npm test
npm run build
```

Run migration and deletion integration tests against an isolated Neon branch through `TEST_DATABASE_URL`. Never run destructive fixtures against production.