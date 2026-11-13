VEXO COIN — WITHDRAWAL MANAGEMENT UPDATE
========================================
Firebase project: vexo-v2
Frontend: static site (GitHub Pages compatible)
Backend: Firebase Cloud Functions v2, Node.js 20, Realtime Database

WHAT THIS UPDATE ADDS
---------------------
- GOD-only withdrawal queue with status filtering.
- Approve or reject a withdrawal request with a required reason.
- Withdrawal amount is reserved (deducted from the user's internal balance)
  when the request is submitted. A rejected request is refunded exactly once.
- A request can be marked PAID only after it is APPROVED.
- GOD records a TON transaction hash and optional note after independently
  verifying the transfer on TON Explorer.
- Duplicate transaction hashes are blocked.
- User withdrawal page shows destination, status, review note and tx hash.
- User transaction history is available through a callable function.
- Withdrawal actions are written to adminAudit.
- Realtime Database rules keep client writes disabled and index the request UID.

IMPORTANT LIMITATIONS / SAFETY
-----------------------------
- This update does NOT make an automatic TON transfer. It deliberately never
  stores a wallet seed phrase or private key and does not sign transactions.
- The GOD operator must send TON from a separately controlled wallet, verify
  the exact recipient and amount on TON Explorer, then record the transaction
  hash in GOD Panel. Marking a request PAID is an administrator attestation,
  not an on-chain verification performed by this backend.
- The project has not been deployed to the user's Firebase project or tested
  against live funds from this environment. Run Firebase Emulator tests first.
- No conversion rate between Gold/Silver/Bronze/VXB and TON/USD is defined by
  this code. Do not promise cash value or enable real-money redemption until
  reserves, rates, fraud controls and applicable legal requirements are reviewed.
- TON Connect wallet linking is separate from a withdrawal payment. Never ask
  users for seed phrases/private keys.

DEPLOYMENT (OWNER / GOD ACCOUNT REQUIRED)
-----------------------------------------
1. Back up the current Firebase Realtime Database and deployed site.
2. Use a trusted environment with Node.js 20+ and Firebase CLI.
3. In the project folder run:
     firebase login
     firebase use vexo-v2
     cd functions && npm install && cd ..
     firebase deploy --only database,functions
4. Publish the website files to the configured GitHub Pages repository.
5. Confirm the current GitHub Pages URL matches the TON Connect manifest URL
   in tonconnect-manifest.json and js/withdraw.js.
6. Sign in with the GOD account, then force-refresh the ID token after custom
   claims are assigned. Open admin.html and confirm GOD authorization.
7. Test with Firebase Emulator / test accounts: submit request, verify balance
   reservation, approve, reject/refund, retry refund, record a unique tx hash,
   reject duplicate hashes, and inspect adminAudit.
8. Only after review, use small testnet transfers. Do not test with mainnet money
   until the recipient, network, amount and operational controls are verified.

FUNCTIONS ADDED / UPDATED
-------------------------
- requestWithdrawal (now reserves balance and requires a TON destination)
- listMyWithdrawals
- listMyTransactions
- adminListWithdrawals
- adminReviewWithdrawal (approve / reject + one-time refund)
- adminMarkWithdrawalPaid (approved only; unique transaction hash)
- adminDashboardStats (includes pending withdrawals)

Existing Firebase Web API config is public client configuration, not an Admin
SDK secret. Keep all service-account credentials, TON signing keys and API
secrets out of the website repository.
