# Integrating your UI

## Inputs

Your app supplies a Solana RPC `Connection`, explicit cluster/program identity, and a connected user wallet that signs `VersionedTransaction` values. The SDK never receives a seed phrase, private key, service token or Oracle credential.

Offer JSON contains version, cluster, program ID, maker, taker, nonce, trade/proposal UUIDs, ordered assets and whole-second UTC expiry. Lamports and nonce are decimal **strings**; never convert user amounts through floating point. `createOffer` generates IDs and a random u64 nonce, validates both sides, and computes the frozen canonical commitment through `offerCommitment`.

Persist and exchange this document through your existing app backend, a share link, clipboard, or messaging. It contains public trade terms. The SDK does not operate negotiation, notifications or listing discovery. Validate imported JSON with `validateOffer`. Each participant should inspect the counterparty and all terms before signing. Loading JSON alone approves nothing.

## One button per step

```ts
const step = await client.prepareNext(offer, wallet.publicKey, action)
if (!step) return showWaitingForTheOtherWallet()
renderStepReview(step)
const receipt = await client.executeStep(step, wallet, showApprovalDialog)
saveReceipt(receipt)
```

`action` is `'create'`, `'continue'`, `'cancel'` or `'claim'`. `create` is an explicit first maker action. `continue` requires an existing session. The client re-reads state, checks the immutable terms and next signer, selects only an unfinished leg, builds idempotent destination ATA setup, obtains a blockhash and simulates before exposing a prepared transaction. The prepared step includes protocol fee math and estimated session rent. Network and destination-account creation fees remain separate.

The host's review callback must return `true` to request a wallet signature. Execution verifies that the transaction and displayed terms have not changed, rechecks the RPC/program identity, re-reads state and fees, and checks blockhash validity. Prepared steps are single use. A declined/expired/changed step must be prepared again after the user's next explicit action.

Every call executes one transaction. The SDK does not automatically loop, sign batches, swap wallet identities or resend transactions. One client should coordinate a given wallet in a UI; avoid parallel signing coordinators across tabs. When a submission becomes uncertain, the persisted receipt blocks new signing until reconciliation.

## Phase behavior

| Chain phase | Next action |
| --- | --- |
| Account absent | Only explicit maker `create`; absence is not completion |
| Building | Maker resumes the original manifest and finalizes it |
| MakerDepositing | Maker deposits the next unfinished collectible |
| Open | Taker records acceptance; maker waits |
| TakerDepositing | Taker deposits the next unfinished collectible, then commits |
| Committed | Payer delivers unfinished collectibles to fixed counterparties, then closes |
| Cancelling | Payer returns unfinished deposits to their original owners, then closes |

Maker SOL leaves the wallet at creation. Taker SOL and the taker protocol fee leave at commit. Acceptance alone does not transfer the taker's SOL. NFT delivery after commit is separate from the irreversible entitlement decision.

## Host responsibilities

Use a durable pending store, save confirmed receipts, render the full offer and current action, keep recovery accessible, and use a compatible deployed program. Browser storage is one reasonable receipt adapter; server or desktop hosts can implement `PendingTransactionStore` themselves. Never call `createOffer` again to retry the same trade.

This direct path observes chain state and does not create a PrismSwap platform trade record. If you later add platform API/Oracle integration, only authenticated Oracle-backed platform state may declare platform lifecycle completion. The package's protocol subpath contains the canonical commitment contract, not an activated API service.
