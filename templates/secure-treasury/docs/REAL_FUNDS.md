# Real-funds ladder (train the agent — do not skip steps)

Seeded v2 puzzles fix CircuitDAO-class bugs but are **not** mainnet-ready.
When the user asks for real funds / production / owner-bound / singleton / CAT,
**you** evolve the seeded files. Do not invent a mega-file.

## Phase A — already seeded (keep green)

- One `CREATE_COIN` per path; min-hold interest; `OWNER_PH` destinations
- Matched `claim-msg` across vault + treasury + `interest_payout`
- `tests/spend-samples.json` halves + `docs/PUZZLE_HASH.md`

## Phase B — owner-bound auth (do this first when asked)

1. Vault: replace protocol `AUTHORIZER_PK` with curried **`OWNER_PK`**. Every mode’s `AGG_SIG_ME` (50) must use `OWNER_PK`.
2. `interest_payout.clsp`: same — sign with **`OWNER_PK`**, keep curried `OWNER_PH` for `CREATE_COIN`.
3. Treasury: rename protocol key to **`TREASURY_PK`** (custodian of the **interest pool only**). Document the split in `docs/SECURITY.md`.
4. Update curry comments + `vault-ph` / `treasury-ph` argument names.
5. Re-run spend fixtures; refresh bare hash in `docs/PUZZLE_HASH.md`.

## Phase C — three-spend integration tests

1. Extend `tests/three-spend-claim.json` with explicit half sample names + shared `claim-msg`.
2. Add/extend fixtures so happy-path halves for vault mode 4, treasury pay, and payout all succeed.
3. Document that brun halves ≠ full mempool: note remaining gap (AGG_SIG aggregation / concurrent spend) in `docs/SECURITY.md`.
4. Prefer one `spend_check` / fixture run that names all three paths — do not burn steps rewriting puzzles from scratch.

## Phase D — singleton + CAT scaffold (design then minimal code)

1. Write `docs/SINGLETON_CAT.md` (or expand this file) covering:
   - Launcher → even coin → inner puzzle; lineage proof on spend
   - Why a bare recreate-by-`MOD_HASH` treasury is not a singleton
   - CAT2 wrap for BYC-like assets (hint only unless user asks for full CAT)
2. Optionally curry a `LAUNCHER_ID` / structural id into treasury recreate comments.
3. Do **not** claim mainnet readiness; leave external review checklist in `docs/SECURITY.md`.

## Done when (real-funds turn)

- [ ] Phase B keys renamed and signing correct
- [ ] Fixtures still pass; hash doc updated
- [ ] Phase C bundle metadata + notes accurate
- [ ] Phase D doc present; honest about remaining gaps
- [ ] `docs/SECURITY.md` states: vault/payout owner-bound; treasury custodian; review before mainnet
