import { LiquidityPool } from '@dex/models/liquidity-pool';
import { BaseDataProvider } from '@providers/data/base-data-provider';
import { Asset } from '@dex/models/asset';
import { UTxO, DefinitionField } from '@app/types';
import { correspondingReserves, tokensMatch } from '@app/utils';

const ORDERBOOK_ADDRESS = 'addr1z8d9k3aw6w24eyfjacy809h68dv2rwnpw0arrfau98jk6nhv88awp8sgxk65d6kry0mar3rd0dlkfljz7dv64eu39vfs38yd9p';
const CONTRACT_LOVELACE = 2_000_000n;
const BATCHER_FEE = 690_000n;

export type AmmImpliedPrice = {
  adaPerToken: number;
  tokenPerAda: number;
};

export function getAmmImpliedPrice(pool: LiquidityPool): AmmImpliedPrice {
  const priceAdaPerToken = pool.price; // ADA per 1 token (ADA pairs only)
  const tokenPerAda = priceAdaPerToken > 0 ? 1 / priceAdaPerToken : 0;
  return { adaPerToken: priceAdaPerToken, tokenPerAda };
}

export function quoteFromSmallInput(
  pool: LiquidityPool,
  direction: 'in' | 'out',
  amount: bigint
): { outAmount: bigint; adaPerToken?: number; tokenPerAda?: number } {
  if (amount <= 0n) return { outAmount: 0n };

  const poolFeeMultiplier: bigint = 10000n;
  const feeModifier: bigint = poolFeeMultiplier - BigInt(Math.round((pool.poolFeePercent / 100) * Number(poolFeeMultiplier)));

  if (direction === 'in') {
    const [reserveIn, reserveOut]: bigint[] = correspondingReserves(pool, pool.assetA);
    const out = (amount * reserveOut * feeModifier) / (amount * feeModifier + reserveIn * poolFeeMultiplier);
    if (tokensMatch(pool.assetA, 'lovelace')) {
      const ada = Number(amount) / 1_000_000;
      const tokens = Number(out) / 10 ** (pool.assetB === 'lovelace' ? 6 : (pool.assetB as Asset).decimals);
      const tpa = ada > 0 ? tokens / ada : undefined;
      return { outAmount: out, tokenPerAda: tpa };
    } else {
      const tokens = Number(amount) / 10 ** (pool.assetA === 'lovelace' ? 6 : (pool.assetA as Asset).decimals);
      const ada = Number(out) / 1_000_000;
      const apt = tokens > 0 ? ada / tokens : undefined;
      return { outAmount: out, adaPerToken: apt };
    }
  } else {
    // direction === 'out' (target exact out; estimate required in)
    const [reserveOut, reserveIn]: bigint[] = correspondingReserves(pool, pool.assetB);
    const inAmt = (amount * reserveIn * poolFeeMultiplier) / ((reserveOut - amount) * feeModifier);
    if (tokensMatch(pool.assetA, 'lovelace')) {
      const ada = Number(inAmt) / 1_000_000;
      const tokens = Number(amount) / 10 ** (pool.assetB === 'lovelace' ? 6 : (pool.assetB as Asset).decimals);
      const apt = tokens > 0 ? ada / tokens : undefined;
      return { outAmount: amount, adaPerToken: apt };
    } else {
      const tokens = Number(inAmt) / 10 ** (pool.assetA === 'lovelace' ? 6 : (pool.assetA as Asset).decimals);
      const ada = Number(amount) / 1_000_000;
      const tpa = ada > 0 ? tokens / ada : undefined;
      return { outAmount: amount, tokenPerAda: tpa };
    }
  }
}

export type TopOfBook = {
  bestBidAdaPerToken?: number; // ADA a buyer will pay per 1 token
  bestAskAdaPerToken?: number; // ADA a seller requires per 1 token
};

/**
 * Synthesizes orderbook top-of-book by scanning order UTxOs and decoding their datums.
 * Note: values are computed in on-chain units; ADA normalized to ADA (1e6),
 * token units are used as-is (decimals unknown). For display accuracy, scale by known decimals.
 */
export async function getOrderbookTopOfBook(
  provider: BaseDataProvider,
  tokenUnit: string
): Promise<TopOfBook> {
  const utxos: UTxO[] = await provider.utxos(ORDERBOOK_ADDRESS);
  if (utxos.length === 0) return {};

  let bestBid: number | undefined = undefined;
  let bestAsk: number | undefined = undefined;
  const token = Asset.fromIdentifier(tokenUnit);

  for (const utxo of utxos) {
    if (!utxo.datumHash) continue;
    const datum: DefinitionField = await provider.datumValue(utxo.datumHash);
    const parsed = parseCswapOrderDatum(datum);
    if (!parsed) continue;
    const { outPolicy, outName, minOut, inPolicy, inName } = parsed;

    // Determine input amounts from UTxO balances
    const lovelace = utxo.assetBalances.find(a => a.asset === 'lovelace')?.quantity ?? 0n;
    const tokenBal = utxo.assetBalances.find(a =>
      a.asset !== 'lovelace'
      && (a.asset as Asset).policyId === token.policyId
      && (a.asset as Asset).nameHex === token.nameHex
    )?.quantity ?? 0n;

    const inputIsAda = (inPolicy === '' && inName === '');
    const outputIsAda = (outPolicy === '' && outName === '');

    // Derive effective input amounts (exclude deposit + batcher if ADA)
    const adaIn = inputIsAda ? (lovelace - CONTRACT_LOVELACE - BATCHER_FEE) : 0n;
    const tokenIn = inputIsAda ? 0n : tokenBal;

    // Derive min outputs; if out is ADA, remove deposit from minOut (datum includes +2 ADA)
    const minAdaOut = outputIsAda ? (minOut - CONTRACT_LOVELACE) : 0n;
    const minTokenOut = outputIsAda ? 0n : minOut;

    // Classify: ADA→token = Bid (buyer wants tokens, pays ADA)
    if (inputIsAda && !outputIsAda && tokenIn === 0n) {
      if (adaIn > 0n && minTokenOut > 0n) {
        const bid = (Number(adaIn) / 1_000_000) / Number(minTokenOut); // ADA per 1 on-chain token unit
        if (bestBid === undefined || bid > bestBid) bestBid = bid;
      }
    }

    // token→ADA = Ask (seller gives tokens, wants ADA)
    if (!inputIsAda && outputIsAda && adaIn === 0n) {
      if (tokenIn > 0n && minAdaOut > 0n) {
        const ask = (Number(minAdaOut) / 1_000_000) / Number(tokenIn); // ADA per 1 on-chain token unit
        if (bestAsk === undefined || ask < bestAsk) bestAsk = ask;
      }
    }
  }

  return { bestBidAdaPerToken: bestBid, bestAskAdaPerToken: bestAsk };
}

function parseCswapOrderDatum(d: DefinitionField): {
  inPolicy: string; inName: string; outPolicy: string; outName: string; minOut: bigint;
} | undefined {
  // Expect constructor 0 with fields[1] target_min_value_arr (list), fields[2] input_asset_arr (list)
  if (!('fields' in d) || !Array.isArray((d as any).fields)) return undefined;
  const fields = (d as any).fields;
  if (fields.length < 3) return undefined;

  // Input asset array
  const inputList = fields[2]?.list;
  if (!Array.isArray(inputList) || inputList.length === 0) return undefined;
  const inTuple = inputList[0]?.list;
  if (!Array.isArray(inTuple) || inTuple.length < 3) return undefined;
  const inPolicy = inTuple[0]?.bytes ?? '';
  const inName = inTuple[1]?.bytes ?? '';
  // const inZero = inTuple[2]?.int ?? 0; // always zero

  // Target min value array
  const targetList = fields[1]?.list;
  if (!Array.isArray(targetList) || targetList.length === 0) return undefined;
  // Prefer first non-ADA row as primary; if only ADA exists, use that
  let chosen = targetList.find((t: any) => (t?.list?.[0]?.bytes ?? '') !== '' || (t?.list?.[1]?.bytes ?? '') !== '');
  if (!chosen) chosen = targetList[0];
  const outTuple = chosen?.list;
  if (!Array.isArray(outTuple) || outTuple.length < 3) return undefined;
  const outPolicy = outTuple[0]?.bytes ?? '';
  const outName = outTuple[1]?.bytes ?? '';
  const minOut = BigInt(outTuple[2]?.int ?? 0);

  return { inPolicy, inName, outPolicy, outName, minOut };
}


