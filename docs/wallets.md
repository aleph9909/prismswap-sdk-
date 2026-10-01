# Wallet integration

`@prismswap/escrow-sdk/wallet-standard` exposes `listPrismSwapWallets()` and `connectPrismSwapWallet(wallet, cluster, optionalAccountAddress)`. Present the list to the user. Wallets register dynamically; refresh or subscribe to your application's wallet discovery lifecycle. If more than one compatible account is returned, ask the user to choose and pass its exact address. The adapter requires `solana:signTransaction` and checks the selected chain/account; signing is distinct from broadcasting.

For an existing wallet integration, no replacement login/provider stack is needed:

```ts
const prismWallet = {
  publicKey: hostWallet.publicKey,
  signTransaction: transaction => hostWallet.signTransaction(transaction),
}
const result = await client.executeStep(step, prismWallet, showApprovalDialog)
```

The wallet must sign without sending. Do not pass `signAndSendTransaction` as `signTransaction`: the SDK must first save the known signature, then own broadcasting and confirmation. Both legacy messages and v0 messages are represented by `VersionedTransaction`; ensure the host wallet supports that representation. A disconnected/changed wallet requires a new preparation.

Importing the package does not access `window` or connect a wallet, so it is compatible with server rendering. Call Wallet Standard discovery and browser storage adapters in client-side UI code. The package is framework independent; React, Vue, Svelte and plain JavaScript apps can use the same client and approval callback. A dedicated React widget is future work.
