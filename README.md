# PrismSwap SDK

Connect your web application's UI directly to the **PrismSwap Solana escrow**. Your users keep their assets in their wallets until they explicitly approve a deposit. The SDK prepares transactions; the connected wallet signs them.

The fastest path is `PrismSwapClient`: **RPC + wallet + shared offer JSON**. It does not require a PrismSwap API credential, hosted widget, embedded wallet provider, or access to another repository. It works with a custom UI or the runnable example here.

## Try the example

```bash
git clone https://github.com/aleph9909/prismswap-sdk-.git
cd prismswap-sdk-
npm ci
npm run example
```

Open the local URL printed by Vite. Choose a network, connect a Wallet Standard wallet, define both sides, create offer JSON, and share the exact JSON with the counterparty. Each person prepares and approves their own next step. No network is selected automatically. Mainnet create/finalize passed read-only simulation; the reference devnet deployment currently rejects the session instruction and requires an updated or alternative compatible test deployment. See [deployment evidence](docs/deployment-probe.json). No transactions were broadcast in this verification.

## Install in your app

This package is **not published to npm yet**. Install a reviewed commit from this public repository, or build and install its tarball:

```bash
# Replace COMMIT_SHA with the reviewed public SDK commit you intend to use.
npm install 'git+https://github.com/aleph9909/prismswap-sdk-.git#COMMIT_SHA'

# Alternatively, in an SDK checkout:
npm ci
npm pack
# In your app:
npm install /absolute/path/to/prismswap-escrow-sdk-0.1.0.tgz
```

Node 22+ is used for development; modern browsers run the built SDK. The package ships ESM and TypeScript declarations. The `prepare` script builds a Git installation; `npm pack` includes prebuilt files.

## Minimal integration

```ts
import { Connection } from '@solana/web3.js'
import {
  PrismSwapClient, createOffer, localStoragePendingStore,
  PRISMSWAP_MAINNET_PROGRAM_ID,
} from '@prismswap/escrow-sdk'
import {
  listPrismSwapWallets, connectPrismSwapWallet,
} from '@prismswap/escrow-sdk/wallet-standard'

// Let the user select from this list; never silently pick among wallets/accounts.
const wallets = listPrismSwapWallets()
// Mainnet is an explicit choice and uses real assets. Test on a compatible sandbox first.
const wallet = await connectPrismSwapWallet(wallets[selectedWalletIndex], 'mainnet-beta')
const client = new PrismSwapClient({
  connection: new Connection('https://api.mainnet-beta.solana.com', 'confirmed'),
  cluster: 'mainnet-beta',
  programId: PRISMSWAP_MAINNET_PROGRAM_ID,
  pendingStore: localStoragePendingStore(localStorage),
})

// The maker creates and persists this once. Share it with the taker's UI.
const offer = createOffer({
  cluster: 'mainnet-beta', programId: PRISMSWAP_MAINNET_PROGRAM_ID,
  maker: wallet.publicKey.toBase58(), taker: counterpartyAddress,
  expiresAt: '2027-01-01T00:00:00Z',
  assets: [
    { side: 'maker', index: 0, kind: 'spl', mint: collectibleMint, amount: '1' },
    { side: 'taker', index: 0, kind: 'sol', lamports: '100000000' },
  ],
})

// Render the step's participants, terms, action, destinations and fees in your UI.
// Use 'create' only for the first maker step; use 'continue' after that.
const step = await client.prepareNext(offer, wallet.publicKey, 'create')
if (step) {
  const receipt = await client.executeStep(step, wallet, async step => {
    return await showYourApprovalDialog(step) // Must resolve true to proceed.
  })
  persistReceipt(receipt) // Chain confirmation, not platform lifecycle completion.
}
```

After every confirmed step, prepare again using `'continue'`. There is one wallet approval per step. A `null` step means this wallet has no next action; it can mean the counterparty must act. Existing wallet adapters can be used by passing `{ publicKey, signTransaction }`; see [wallet integration](docs/wallets.md).

## What works now

| Surface | Available behavior |
| --- | --- |
| Direct client | SOL plus up to 8 classic SPL or extension-free Token-2022 unit collectibles per side |
| Wallet integration | Wallet Standard discovery/selection and a small injected signing interface |
| Transaction flow | Create/finalize manifest, maker deposits, taker acceptance/deposits, commit, delivery, close |
| Recovery | Resume from validated chain state, precommit cancellation/returns, postcommit incoming claims |
| Safety | Genesis/program/owner/PDA/terms checks, simulation, review binding, explicit signing, durable pending-signature adapter |
| Advanced session module | Five asset instruction rails, PDA/account codecs, fee math and commit lookup-table preparation |

The direct client accepts **collectibles**, with amount `1`, mint supply `1`, decimals `0`, no freeze authority, and no Token-2022 extensions. It intentionally rejects arbitrary fungible token quantities and advanced asset kinds. Core, pNFT and cNFT instruction builders are present under `@prismswap/escrow-sdk/session`; automatic proof/metadata admission adapters for those rails are future work. See [supported assets](docs/assets.md).

## What a trade does

The maker escrows the SOL contribution, fee reserve, bond and account rent at creation, then deposits collectibles. The taker records acceptance and deposits collectibles. Commit makes both recipients' entitlements final, moves the SOL contributions, and pays protocol fees. Collectible delivery occurs in subsequent transactions and can resume independently. **A committed trade cannot be cancelled.**

Every release goes to the immutable counterparty; every precommit return goes to the original depositor. Permissionless delivery still requires the transaction payer's wallet approval.

The direct client reports RPC evidence only. It does not register trades in the PrismSwap inbox, operate an Oracle, or assert platform lifecycle completion. Server API onboarding, platform synchronization, advanced high-level asset adapters, React widgets, hosted widgets, mobile packages, and agent delegation are future work. They are not prerequisites for the direct standard-collectible escrow path.

## Read next

- [Step-by-step integration](docs/integration.md)
- [Instructions for coding agents](AGENTS.md)
- [Wallets and UI approval](docs/wallets.md)
- [Assets and advanced builders](docs/assets.md)
- [Recovery and unknown submissions](docs/recovery.md)
- [Program contract and deployment limits](docs/program.md)
- [Security](SECURITY.md)

`npm run check` verifies TypeScript, ABI/fee/planner/transport regressions, the browser bundle, an isolated packed-package consumer, and source/Git-history secret patterns. `npm run example:build` builds the runnable browser example. These checks do not replace a live two-wallet acceptance run or a security audit.
