import { LiquidityPool, Asset, MockDataProvider } from '../src';
import { getAmmImpliedPrice, getOrderbookTopOfBook } from '../src';
import { BaseDataProvider } from '../src/providers/data/base-data-provider';
import { UTxO } from '../src/types';

class LocalMockProvider extends MockDataProvider {
  private _utxos: UTxO[] = [];
  private _datums: Record<string, any> = {};

  setUtxos(utxos: UTxO[]) { this._utxos = utxos; }
  setDatum(hash: string, json: any) { this._datums[hash] = json; }

  async utxos(): Promise<UTxO[]> { return this._utxos; }
  async datumValue(datumHash: string): Promise<any> { return this._datums[datumHash]; }
}

describe('CSWAP Pricing', () => {
  it('computes AMM implied price from reserves', () => {
    const token = new Asset('da8c30857834c6ae7203935b89278c532b3995245295456f993e1d24', '4c51', 6);
    const pool = new LiquidityPool(
      'CSwap',
      'lovelace',
      token,
      1_000_000_000000n, // 1,000,000 ADA
      10_000_000_000000n, // 10,000,000 tokens (on-chain units, decimals=6)
      'addr1'
    );
    // ADA per token = 1000000 / 10000000 = 0.1
    const price = getAmmImpliedPrice(pool);
    expect(+price.adaPerToken.toFixed(4)).toBe(0.1);
    expect(+price.tokenPerAda.toFixed(1)).toBe(10.0);
  });

  it('computes top-of-book bid & ask from orderbook datums', async () => {
    const provider: BaseDataProvider = new LocalMockProvider();
    const mock = provider as LocalMockProvider;
    const token = new Asset('da8c30857834c6ae7203935b89278c532b3995245295456f993e1d24', '4c51');
    const datumHashBid = 'hashBid';
    const datumHashAsk = 'hashAsk';
    // ADA -> token bid: lovelace = swapIn + 2 ADA + 690k, target min tokens = 1,000,000
    mock.setUtxos([
      {
        txHash: 'tx1',
        address: '',
        datumHash: datumHashBid,
        outputIndex: 0,
        assetBalances: [
          { asset: 'lovelace', quantity: 2_000_000n + 690_000n + 1_000_000n }, // 1 ADA in
        ]
      },
      {
        txHash: 'tx2',
        address: '',
        datumHash: datumHashAsk,
        outputIndex: 1,
        assetBalances: [
          { asset: token, quantity: 2_000_000n }, // 2M token units in
          { asset: 'lovelace', quantity: 2_000_000n + 690_000n }, // deposit + batcher
        ]
      }
    ]);
    // Bid datum: out token target_min_value_arr = token min=1_000_000 + ADA deposit entry
    mock.setDatum(datumHashBid, {
      constructor: 0,
      fields: [
        { constructor: 0, fields: [] },
        { list: [
          { list: [{ bytes: token.policyId }, { bytes: token.nameHex }, { int: 1_000_000 }] },
          { list: [{ bytes: '' }, { bytes: '' }, { int: 2_000_000 }] }
        ]},
        { list: [
          { list: [{ bytes: '' }, { bytes: '' }, { int: 0 }] }
        ]},
        { constructor: 0, fields: [] },
        { int: 50 },
        { int: 15 }
      ]
    });
    // Ask datum: out ADA (min= 2 ADA deposit + 2,000,000 lovelace)
    mock.setDatum(datumHashAsk, {
      constructor: 0,
      fields: [
        { constructor: 0, fields: [] },
        { list: [
          { list: [{ bytes: '' }, { bytes: '' }, { int: 2_000_000 + 2_000_000 }] }
        ]},
        { list: [
          { list: [{ bytes: token.policyId }, { bytes: token.nameHex }, { int: 0 }] }
        ]},
        { constructor: 0, fields: [] },
        { int: 50 },
        { int: 15 }
      ]
    });

    const top = await getOrderbookTopOfBook(provider, token.identifier());
    // In on-chain units: bestBid = (1 ADA) / (1,000,000 token units) = 1e6/1e6 = 1e0 ADA / 1e6 units = 0.000001 ADA per unit
    expect(top.bestBidAdaPerToken && +top.bestBidAdaPerToken.toFixed(6)).toBe(0.000001);
    // bestAsk = (2,000,000 lovelace) / (2,000,000 token units) = 1e6/1e6 = 1e0 ADA / 1e6 units = 0.000001 ADA per unit
    expect(top.bestAskAdaPerToken && +top.bestAskAdaPerToken.toFixed(6)).toBe(0.000001);
  });
});


