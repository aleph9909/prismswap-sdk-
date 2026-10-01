# Recovery and unknown submissions

Persist the offer, confirmed receipts, and `PendingTransactionStore` before sending. The SDK knows the transaction signature after the wallet signs and writes the pending receipt **before** broadcasting. A send or confirmation error throws `PrismSwapSubmissionError` with that receipt; it does not prove that the transaction failed.

```ts
try {
  await client.executeStep(step, wallet, showApprovalDialog)
} catch (error) {
  if (error instanceof PrismSwapSubmissionError) {
    showKnownSignature(error.pending.signature)
    const result = await client.reconcilePending() // Read-only; never resends.
    showReconciliation(result)
  } else throw error
}
```

`pending` means the RPC has not provided confirmed/finalized evidence for the known signature. Keep it and check again, including after a refresh. `confirmed` or `failed` clears the pending block; prepare from fresh chain state before any new signature. A null signature-status response, account absence, elapsed time, or blockhash expiry alone does not clear it. If a dropped signature never becomes observable, use independent chain/history evidence and operator review to resolve the persisted receipt; there is deliberately no automatic force-clear method. Do not delete the receipt as a retry strategy.

To cancel a precommit session, prepare with `'cancel'` and approve successive fresh steps. The program decides whether the actor can initiate cancellation in the current phase. The maker can cancel before commitment; the taker can exit during its funding phase; expiry permits recovery under the program's rules. Cancellation starts an unwind; it does not prove custody is empty. Returns go to the original depositor, and the remaining bond/rent/uncommitted maker SOL return to the maker at close.

To resume delivery after commitment, use `'continue'` for permissionless delivery to both recipients or `'claim'` for this participant's incoming collectibles. Each instruction fixes the recipient from the original parties, even when a different payer signs. Neither participant needs the other's signature for postcommit delivery. A committed session cannot be cancelled. A `null` claim may mean that another recipient still has pending delivery.

An absent account is not an authoritative terminal result. Persist classified closing transaction receipts and, when using the PrismSwap platform, wait for its authenticated Oracle-backed lifecycle state. The direct client returns `'rpc'` authority on observations and receipts so your UI can state exactly what was verified.
