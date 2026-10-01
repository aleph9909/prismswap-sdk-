import { PublicKey } from '@solana/web3.js'
import { computeTradeV2Commitment, normalizeProposalAssets, type ProposalAsset } from './protocol.js'
import { AssetKindV4, type SessionLegInput, type BuildSessionPlanInput } from './session/index.js'

export type PrismSwapCluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet'
export type DirectAsset = Extract<ProposalAsset, { kind: 'sol' | 'spl' | 'token2022' }>
/** JSON-safe terms that both UIs must display and persist. Contains no keys or credentials. */
export type PrismSwapOffer = {
  readonly version: 1
  readonly cluster: PrismSwapCluster
  readonly programId: string
  readonly tradeId: string
  readonly proposalId: string
  readonly maker: string
  readonly taker: string
  readonly nonce: string
  readonly assets: readonly DirectAsset[]
  readonly expiresAt: string
}
const U64_MAX = (1n << 64n) - 1n
export function createOffer(input: Omit<PrismSwapOffer, 'version' | 'nonce' | 'tradeId' | 'proposalId'> & Partial<Pick<PrismSwapOffer, 'nonce' | 'tradeId' | 'proposalId'>>): PrismSwapOffer {
  const random = crypto.getRandomValues(new Uint8Array(8))
  const offer: PrismSwapOffer = { ...input, version: 1, nonce: input.nonce ?? new DataView(random.buffer).getBigUint64(0, true).toString(), tradeId: input.tradeId ?? crypto.randomUUID(), proposalId: input.proposalId ?? crypto.randomUUID() }
  validateOffer(offer)
  return structuredClone(offer)
}
export function validateOffer(raw: unknown): asserts raw is PrismSwapOffer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_OFFER')
  const o = raw as PrismSwapOffer
  if (o.version !== 1 || !['mainnet-beta','devnet','testnet','localnet'].includes(o.cluster)) throw new Error('INVALID_OFFER_VERSION_OR_CLUSTER')
  new PublicKey(o.programId); new PublicKey(o.maker); new PublicKey(o.taker)
  if (o.maker === o.taker) throw new Error('PARTICIPANTS_MUST_DIFFER')
  if (typeof o.nonce !== 'string' || !/^(0|[1-9]\d*)$/.test(o.nonce) || BigInt(o.nonce) > U64_MAX) throw new Error('INVALID_NONCE')
  if (typeof o.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?Z$/.test(o.expiresAt) || !Number.isFinite(Date.parse(o.expiresAt))) throw new Error('EXPIRY_MUST_BE_UTC_WHOLE_SECONDS')
  const assets = normalizeProposalAssets(o.assets)
  const identities = new Set<string>()
  for (const asset of assets) {
    if (asset.kind !== 'sol' && asset.kind !== 'spl' && asset.kind !== 'token2022') throw new Error('DIRECT_CLIENT_REQUIRES_STANDARD_COLLECTIBLES')
    if (asset.kind !== 'sol') {
      if (asset.amount !== '1' || identities.has(asset.mint)) throw new Error('UNIT_COLLECTIBLE_AND_UNIQUE_MINT_REQUIRED')
      identities.add(asset.mint)
    }
  }
  for (const side of ['maker','taker'] as const) {
    if (!assets.some(a => a.side === side)) throw new Error('BOTH_SIDES_MUST_CONTRIBUTE')
    assets.filter(a => a.side === side && a.kind !== 'sol').forEach((a,i) => { if (a.index !== i) throw new Error('ASSET_INDEXES_MUST_START_AT_ZERO') })
  }
  computeTradeV2Commitment(o) // Also validates UUIDs, program identity, and canonical asset fields.
}
export function offerCommitment(offer: PrismSwapOffer): Uint8Array {
  validateOffer(offer)
  const hex = computeTradeV2Commitment(offer).commitment.slice(7)
  return Uint8Array.from(hex.match(/../g)!, byte => Number.parseInt(byte, 16))
}
export function offerPlanInput(offer: PrismSwapOffer, feeTreasury: PublicKey, payer: PublicKey): BuildSessionPlanInput {
  const assets = normalizeProposalAssets(offer.assets)
  const legs = (side: 'maker' | 'taker'): SessionLegInput[] => assets.filter(a => a.side === side && a.kind !== 'sol').map(a => {
    if (a.kind !== 'spl' && a.kind !== 'token2022') throw new Error('UNSUPPORTED_DIRECT_RAIL')
    return { kind: a.kind === 'spl' ? AssetKindV4.Spl : AssetKindV4.Token2022, mintOrAssetId: new PublicKey(a.mint) }
  })
  const sol = (side: 'maker' | 'taker') => assets.reduce((n,a) => n + (a.side === side && a.kind === 'sol' ? BigInt(a.lamports) : 0n), 0n)
  return { programId: new PublicKey(offer.programId), maker: new PublicKey(offer.maker), taker: new PublicKey(offer.taker), nonce: BigInt(offer.nonce), tradeCommitment: offerCommitment(offer), makerLegs: legs('maker'), takerLegs: legs('taker'), makerSol: sol('maker'), takerSol: sol('taker'), expiresAt: BigInt(Date.parse(offer.expiresAt) / 1000), feeTreasury, releasePayer: payer }
}
