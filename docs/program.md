# Program contract and release status

| Network | Reference program address |
| --- | --- |
| Mainnet | `6RqZ2jo91veL5WdfTxTGqwoeAxR4KU747Sq6a5rv9r2G` |
| Devnet/local test mapping | `AyVtdNjHeyjz1Ko8yyMWCddgtEk6o3xS32dCWmXKDFyH` |

These are reference deployment identities, not a guarantee that a selected RPC currently serves this exact program release. On 2026-10-01, read-only mainnet simulation successfully executed create/finalize with SOL-only fixture terms. The reference devnet program returned Anchor instruction-fallback error 101 for the session create instruction. No transaction was broadcast. See `deployment-probe.json`. Use a compatible alternative/updated test deployment on devnet; the SDK cannot upgrade a program. The direct client checks genesis identity and executable status, validates the fixed Config layout, and simulates every selected instruction. No live two-wallet acceptance run is included in this SDK release. Do not describe the successful first-step simulation as full deployment acceptance. For localnet pass the validator's actual `expectedGenesisHash` and compatible deployed program ID explicitly.

The session PDA is derived from `[utf8('session'), maker bytes, taker bytes, nonce little-endian u64]`. Config is derived from `[utf8('config')]`. Session account discriminator is `2b146fbcb0948c45`. The session header is 161 bytes including discriminator and vector length; each asset slot is 68 bytes. Immutable commitment bytes are at offset 125. Config encodes 135 bytes; reference deployments allocate 140 bytes with five zero padding bytes. Both encodings are supported, and unknown/nonzero padding fails closed.

`contracts/prismswap-session-v4.json` contains the public session instruction/account/type/error ABI. `src/session` contains pure codecs and unsigned planners; no program source or infrastructure credentials are required. Instructions are `create_session_v4`, `append_slots_v4`, `finalize_manifest_v4`, `deposit_asset_v4`, `start_accept_v4`, `commit_trade_v4`, `release_asset_v4`, `cancel_session_v4`, `withdraw_asset_v4`, and `close_session_v4`.

Branding is PrismSwap. Deployed discriminators, seeds, historical commitment-domain bytes, enum ordinals and fixed account order remain byte-compatible. Product renaming must not alter a signed or on-chain contract. The canonical protocol and golden vectors in this repository provide commitment compatibility independent of private source access.

Only a live program enforces custody and transfer authority. Client validation/simulation is additional evidence, not a replacement. Upgrade authority and live program changes are outside this SDK's control; verify your chosen release operationally.

Packages are prerelease and not published to npm. There is no publishing/deployment workflow here. Future work includes API/Oracle onboarding and inbox synchronization, complete advanced-asset adapters, React/hosted widgets, mobile-native adapters, and autonomous agent permissions. Source integrity hashes in `source-integrity.json` record reviewed reference content; the new public repository was created without importing any private Git history.
