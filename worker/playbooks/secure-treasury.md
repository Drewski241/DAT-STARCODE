# Secure treasury / savings playbook

User is asking about a **compromised treasury** or savings↔treasury interaction (CircuitDAO-class).

## First action
Copy / adapt `templates/secure-treasury/` — read `VULNERABILITY.md`, then implement real `(mod` puzzles.

## Done when
1. Exactly **one** `CREATE_COIN` per spend path (no sibling coins with forged curried state).
2. Deposit time **curried**; interest requires min hold (blocks same-block flash interest).
3. Interest from principal × rate × elapsed — never a solution-supplied discounted balance.
4. Treasury amount covers interest; destinations are 32-byte atoms.
5. Docs explain announcement / concurrent treasury spend for the interest leg.
6. Run `clvm_verify` / `puzzle_hash` before finishing.

## Forbidden
- Multiple `CREATE_COIN`s from a singleton vault/treasury “for convenience”
- Paying interest in the eve/first block after deposit
- Trusting solution atoms for accrued interest or puzzle hashes without AGG_SIG / curry
- Common Lisp stubs
