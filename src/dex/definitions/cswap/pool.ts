import { DatumParameterKey } from '@app/constants';

/**
 * CSWAP Pool Datum (DexPoolDatum)
 *
 * {
 *   lp: Int,
 *   lp_fee_10k: Int,
 *   token_a_id: Bytes,
 *   token_a_name: Bytes,
 *   token_b_id: Bytes,
 *   token_b_name: Bytes,
 *   lp_id: Bytes,
 *   lp_name: Bytes
 * }
 */
export default {
  constructor: 0,
  fields: [
    {
      int: DatumParameterKey.TotalLpTokens,
    },
    {
      int: DatumParameterKey.LpFee,
    },
    {
      bytes: DatumParameterKey.PoolAssetAPolicyId,
    },
    {
      bytes: DatumParameterKey.PoolAssetAAssetName,
    },
    {
      bytes: DatumParameterKey.PoolAssetBPolicyId,
    },
    {
      bytes: DatumParameterKey.PoolAssetBAssetName,
    },
    {
      bytes: DatumParameterKey.LpTokenPolicyId,
    },
    {
      bytes: DatumParameterKey.LpTokenAssetName,
    },
  ]
};


