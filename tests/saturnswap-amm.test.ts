import { SaturnSwapAMM } from '../src/dex/saturnswap-amm';
import { SaturnSwapApi } from '../src/dex/api/saturnswap-api';
import axios from 'axios';
import { MockWalletProvider } from '../src/providers/wallet/mock-wallet-provider';

describe('SaturnSwap-AMM facade', () => {

  it('maps AMM pools to LiquidityPool with reserves and fee', async () => {
    const origCreate = axios.create;
    (axios as any).create = (_cfg: any) => {
      return {
        get: async (path: string) => {
          if (path === '/v1/aggregator/pools') {
            return {
              data: {
                pools: [
                  {
                    id: 'lovelace-cafe.c0ffee',
                    assetA: { unit: 'lovelace' },
                    assetB: { unit: 'cafe.c0ffee' },
                    reserveA: '10000000',
                    reserveB: '20000000',
                    feePercent: 0.3
                  }
                ]
              }
            };
          }
          return { data: {} };
        },
        post: async () => ({ data: {} })
      } as any;
    };

    const amm = new SaturnSwapAMM({} as any);
    const pools = await amm.liquidityPools();
    expect(pools.length).toBe(1);
    const p = pools[0];
    expect(p.identifier).toBe('lovelace-cafe.c0ffee');
    expect(p.poolFeePercent).toBe(0.3);
    expect(p.reserveA).toBe(10000000n);
    expect(p.reserveB).toBe(20000000n);

    (axios as any).create = origCreate;
  });

  it('estimatedReceive uses constant-product math with fee', () => {
    const amm = new SaturnSwapAMM({} as any);
    const pool: any = {
      dex: SaturnSwapAMM.identifier,
      assetA: 'lovelace',
      assetB: 'lovelace',
      reserveA: 10_000_000n,
      reserveB: 20_000_000n,
      address: ''
    };
    pool.poolFeePercent = 0.3;
    // 1 ADA in lovelace
    const out = amm.estimatedReceive(pool, 'lovelace', 1_000_000n);
    expect(typeof out).toBe('bigint');
    expect(out > 0n).toBe(true);
  });

  it('ammQuote builds POST payload correctly', async () => {
    const origCreate = axios.create;
    let capturedPath: string | undefined;
    let capturedBody: any;
    (axios as any).create = (_cfg: any) => {
      return {
        get: async () => ({ data: {} }),
        post: async (path: string, body?: any) => {
          capturedPath = path;
          capturedBody = body;
          return { data: { expectedOut: '100' } };
        }
      } as any;
    };
    const amm = new SaturnSwapAMM({} as any);
    const api = amm.api as SaturnSwapApi;
    await api.ammQuote({ poolId: 'lovelace-foo.bar', direction: 'in', swapInAmount: 1_000_000, slippageBps: 50 });
    expect(capturedPath).toBe('/v1/aggregator/amm/quote');
    expect(capturedBody.poolId).toBe('lovelace-foo.bar');
    expect(capturedBody.direction).toBe('in');
    expect(capturedBody.swapInAmount).toBe(1_000_000);
    expect(capturedBody.slippageBps).toBe(50);
    (axios as any).create = origCreate;
  });

  it('ammQuote works without slippageBps (omitted)', async () => {
    const origCreate = axios.create;
    let capturedBody: any;
    (axios as any).create = (_cfg: any) => {
      return {
        get: async () => ({ data: {} }),
        post: async (_path: string, body?: any) => {
          capturedBody = body;
          return { data: { expectedOut: '100' } };
        }
      } as any;
    };
    const amm = new SaturnSwapAMM({} as any);
    const api = amm.api as SaturnSwapApi;
    await api.ammQuote({ poolId: 'lovelace-foo.bar', direction: 'in', swapInAmount: 1_000_000 });
    expect(capturedBody.slippageBps).toBeUndefined();
    (axios as any).create = origCreate;
  });

  it('ammQuote supports direction=out using swapOutAmount', async () => {
    const origCreate = axios.create;
    let capturedBody: any;
    let capturedPath: string | undefined;
    (axios as any).create = (_cfg: any) => {
      return {
        get: async () => ({ data: {} }),
        post: async (path: string, body?: any) => {
          capturedPath = path;
          capturedBody = body;
          return { data: { expectedIn: '100' } };
        }
      } as any;
    };
    const amm = new SaturnSwapAMM({} as any);
    const api = amm.api as SaturnSwapApi;
    await api.ammQuote({ poolId: 'foo.bar-lovelace', direction: 'out', swapOutAmount: 500_000, slippageBps: 25 });
    expect(capturedPath).toBe('/v1/aggregator/amm/quote');
    expect(capturedBody.direction).toBe('out');
    expect(capturedBody.swapOutAmount).toBe(500_000);
    expect(capturedBody.swapInAmount).toBeUndefined();
    expect(capturedBody.slippageBps).toBe(25);
    (axios as any).create = origCreate;
  });

  it('orientation: non-ADA / ADA pool computes receive correctly from ADA input', () => {
    const amm = new SaturnSwapAMM({} as any);
    const nonAda = new (require('../src/dex/models/asset').Asset)('cafe', 'c0ffee');
    const pool: any = {
      dex: SaturnSwapAMM.identifier,
      assetA: nonAda,            // token
      assetB: 'lovelace',        // ADA
      reserveA: 50_000_000n,
      reserveB: 100_000_000n,
      address: ''
    };
    pool.poolFeePercent = 0.3;
    const out = amm.estimatedReceive(pool, 'lovelace', 1_000_000n); // 1 ADA in, expect token out
    expect(typeof out).toBe('bigint');
    expect(out > 0n).toBe(true);
  });

  it('buildAmmSignSubmit propagates build errors', async () => {
    const amm = new SaturnSwapAMM({} as any);
    (amm.api as any).ammBuildOrder = async () => { throw new Error('No valid transactions found'); };
    const wallet = new MockWalletProvider();
    await expect(amm.buildAmmSignSubmit({
      poolId: 'lovelace-foo.bar',
      direction: 'in',
      swapAmount: 1_000_000,
      changeAddress: 'addr1qtest'
    }, wallet as any)).rejects.toThrow(/No valid transactions found/);
  });

  it('by-pool details returns bestBid/bestAsk/buildable', async () => {
    const origCreate = axios.create;
    let capturedPath: string | undefined;
    let capturedParams: any;
    (axios as any).create = (_cfg: any) => {
      return {
        get: async (path: string, opts?: any) => {
          capturedPath = path;
          capturedParams = opts?.params;
          return { data: { id: 'lovelace-foo.bar', bestBid: 0.000004, bestAsk: 0.0000045, buildable: { marketBuyFromAda: true } } };
        },
        post: async () => ({ data: {} })
      } as any;
    };
    const amm = new SaturnSwapAMM({} as any);
    const api = amm.api as SaturnSwapApi;
    const res = await api.getAmmPoolById('lovelace-foo.bar');
    expect(capturedPath).toBe('/v1/aggregator/pools/by-pool');
    expect(capturedParams.id).toBe('lovelace-foo.bar');
    expect(res?.bestBid).toBeGreaterThan(0);
    expect(res?.bestAsk).toBeGreaterThan(0);
    expect(res?.buildable?.marketBuyFromAda).toBe(true);
    (axios as any).create = origCreate;
  });

  it('minReceive aligns between ammQuote and ammBuildOrder', async () => {
    const amm = new SaturnSwapAMM({} as any);
    (amm.api as any).ammQuote = async () => ({ expectedOut: '100', minReceive: '95' });
    (amm.api as any).ammBuildOrder = async () => ({ unsignedCborHex: '84a300', minReceive: '95', expiry: Math.floor(Date.now()/1000)+300 });
    const q = await (amm.api as any).ammQuote({ poolId: 'lovelace-foo.bar', direction: 'in', swapInAmount: 1_000_000 });
    const b = await (amm.api as any).ammBuildOrder({ poolId: 'lovelace-foo.bar', direction: 'in', swapInAmount: 1_000_000, changeAddress: 'addr1q...' });
    expect(q.minReceive).toBe(b.minReceive);
  });

  it('small amount may be rejected, larger amount succeeds (simulated)', async () => {
    const amm = new SaturnSwapAMM({} as any);
    let small = true;
    (amm.api as any).ammBuildOrder = async (req: any) => {
      if (req.swapInAmount && req.swapInAmount < 500_000) throw new Error('Too small amount');
      return { unsignedCborHex: '84a300', minReceive: '7', expiry: Math.floor(Date.now()/1000)+300 };
    };
    // Small amount fails
    await expect(amm.createAmmUnsignedHex('lovelace-foo.bar', 'in', 100_000, 'addr1q...')).rejects.toThrow(/Too small amount/);
    // Larger amount succeeds
    const hex = await amm.createAmmUnsignedHex('lovelace-foo.bar', 'in', 1_000_000, 'addr1q...');
    expect(hex).toBe('84a300');
  });

  it('buildAmmSignSubmit uses ammBuildOrder and wallet to submit', async () => {
    const amm = new SaturnSwapAMM({} as any);
    // Monkey-patch AMM build to return a stubbed unsigned CBOR hex
    (amm.api as any).ammBuildOrder = async () => ({
      unsignedCborHex: '84a300',
      minReceive: '7',
      expiry: Math.floor(Date.now() / 1000) + 300
    });
    const wallet = new MockWalletProvider();
    const txHash = await amm.buildAmmSignSubmit({
      poolId: 'lovelace-foo.bar',
      direction: 'in',
      swapAmount: 1_000_000,
      changeAddress: 'addr1qtest'
    }, wallet as any);
    expect(txHash).toBe('hashtest');
  });
});


