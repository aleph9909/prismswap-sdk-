# Asset support

| Asset | Direct `PrismSwapClient` | Low-level session module |
| --- | --- | --- |
| SOL | Yes; aggregate lamports per side | Yes |
| Classic SPL collectible | Yes; amount 1, supply 1, decimals 0, no freeze authority | Yes; unit principal |
| Token-2022 collectible | Yes; same collectible rules and no mint/account extensions | Yes; restricted unit principal |
| Metaplex Core | Future high-level admission adapter | Builders, collection binding and postcommit delivery planners included |
| pNFT | Future metadata/authorization adapter | Builders and rule-set accounts included; authoritative reconstruction metadata required on resume |
| cNFT | Future DAS/proof adapter | Builders with fresh-proof callbacks included |
| Arbitrary fungible quantities | Future work | Not a TradeSession collectible leg |

Each side can have up to 8 ordered non-SOL collectibles plus SOL. The program's hard ABI ceiling is 32 slots per side; it is not the direct-client product cap. An offer must give both sides a nonempty contribution. SPL and Token-2022 quantities are always `'1'`; metadata standards must never be silently reclassified.

## Advanced preparation

Import `buildSessionPlan`, `buildSessionPlanFromState`, `buildParticipantClaimPlan`, the instruction codecs, and the account decoder from `@prismswap/escrow-sdk/session`. This entry point is self-contained; it does not need another repository or a server signer. It returns unsigned instruction groups, not automatic execution. These builders alone do **not** certify a safe advanced-asset integration.

Core slots bind their exact collection or no-collection identity. Current transferability/destructive-control admission and fresh commit policy evidence are host responsibilities; a mutable plugin/freeze authority can delay postcommit physical delivery without reversing entitlement. Healthy legs can deliver while a blocked leg remains pending. Do not close while an omitted leg still has custody.

pNFT resume planners require rule-set presence (including an explicit null), authenticated Oracle source, observation sequence and slot. The program wire ABI currently has no arbitrary pNFT authorization-data payload; rule sets needing unsupported payload data must fail closed. Metadata accounts and token records must match the mint/source/destination.

cNFT groups intentionally contain no final movement instructions until `buildWithFreshProof` is called with proof material freshly fetched for the expected leaf owner. Validate asset/tree identity, stored proof size, leaf ID-derived nonce/index, root/hash/proof ordering, delegate authority and canopy treatment. Never embed DAS credentials in the UI or cache roots as durable settlement facts.

Advanced integrations must materialize missing ATAs before dependent transfers, simulate the exact final message, validate fixed beneficiaries and signer roles, and enforce the 1,232-byte transaction packet limit. `prepareSessionCommitLookupTable` supports large Core commit messages; prepare its active finalized coverage before taker funding and obtain a fresh blockhash afterward. Wallet-paid lookup-table setup is separately reviewed, signed and confirmed. The direct client does not automatically create lookup tables because its supported token/SOL steps fit without them.
