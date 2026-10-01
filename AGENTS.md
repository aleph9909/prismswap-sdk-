# PrismSwap integration and contribution guide

The product name is PrismSwap. This repository is the complete source and documentation dependency for its public SDK. Keep all runtime imports inside this package or declared public npm dependencies. Never add private-repository URLs, source dependencies, credentials, account keypair files, infrastructure configuration, or private history.

When integrating a web app:

1. Read `README.md`, `docs/integration.md`, `docs/assets.md` and `docs/recovery.md`.
2. Use `PrismSwapClient` and a wallet selected by the user. Inject the existing wallet's `publicKey` and `signTransaction` if the host already has a wallet integration.
3. Persist one offer JSON document before the first transaction. Both UIs must use exactly the same document. Do not regenerate IDs, nonce, amounts or expiry when the taker loads it or on a retry.
4. Persist pending signatures with `localStoragePendingStore` in browsers or an equivalent durable store in the host. Check `reconcilePending()` after refresh or an interrupted send. Never automatically re-sign an uncertain transaction.
5. Build UI actions around `prepareNext`, explicit review, `executeStep`, and a fresh next preparation. Use `create` only for the first maker action. A `null` preparation is not a success/completion message.
6. Show participants, program/cluster, exact assets and lamports, immutable destinations, fees, account rent and current action before wallet approval. Derive UI copy from the current prepared step. Do not treat a funding or acceptance approval as a final swap.
7. Keep cancellation and delivery accessible. Precommit returns go to original depositors; committed claims go to counterparties. Committed trades cannot be cancelled; an empty claim plan or absent account is not platform completion evidence.
8. For the first integration, use SOL/classic SPL/extension-free Token-2022 unit collectibles. Do not silently drop unsupported assets or map Core/pNFT/cNFT assets to classic SPL. Read `docs/assets.md` before using advanced session builders.
9. Protect privileged provider credentials in the host's backend. A browser RPC URL must be public or appropriately origin-restricted. This SDK does not need an application API token or a private key.

Use only the reference program identities in `src/config.ts`, or an explicitly selected compatible deployment. Verify the RPC genesis hash and executable program. Test local/sandbox and live two-wallet scenarios before claiming deployment acceptance.

For changes to this repository, run `npm ci`, `npm run check`, and `npm run example:build`. Preserve instruction discriminators, account ordering, enum ordinals, offsets, commitment domain bytes and fee math. Compare wire changes against `contracts/prismswap-session-v4.json` and the frozen ABI tests. New forward behavior must not disable exits or confuse chain evidence with platform lifecycle authority.
