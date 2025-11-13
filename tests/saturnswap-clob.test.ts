import { SaturnSwap } from '../src/dex/saturnswap';
import { SaturnSwapApi } from '../src/dex/api/saturnswap-api';
import axios from 'axios';
import { MockWalletProvider } from '../src/providers/wallet/mock-wallet-provider';

describe('SaturnSwap CLOB helpers (by-asset + create-from-asset)', () => {

  it('quoteByAsset returns buildable and selectedPoolId', async () => {
    const origCreate = axios.create;
    let capturedPath: string | undefined;
    let capturedBody: any;
    (axios as any).create = (_cfg: any) => {
      return {
        get: async () => ({ data: {} }),
        post: async (path: string, body?: any) => {
          capturedPath = path;
          capturedBody = body;
          return { data: { buildable: true, selectedPoolId: '03eab5...' } };
        }
      } as any;
    };
    const dex = new SaturnSwap({} as any);
    const api = dex.api as SaturnSwapApi;
    const res = await api.quoteByAsset({
      asset: '',           // ADA
      direction: 3,        // market buy ADA->token or as per backend enum
      tokenAmountSell: 10,
      tokenAmountBuy: 0,
      slippage: null
    });
    expect(capturedPath).toBe('/v1/aggregator/quote');
    expect(res.buildable).toBe(true);
    expect(res.selectedPoolId).toBeDefined();
    (axios as any).create = origCreate;
  });

  it('create-from-asset returns first hex when successTransactions present', async () => {
    const origCreate = axios.create;
    let capturedPath: string | undefined;
    let capturedBody: any;
    (axios as any).create = (_cfg: any) => {
      return {
        get: async () => ({ data: {} }),
        post: async (path: string, body?: any) => {
          capturedPath = path;
          capturedBody = body;
          return { data: { successTransactions: [{ transactionId: 'tx1', hexTransaction: '84a300' }] } };
        }
      } as any;
    };
    const dex = new SaturnSwap({} as any);
    const api = dex.api as SaturnSwapApi;
    const payload = await api.createOrderTransactionFromAsset({
      asset: '',
      direction: 3,
      tokenAmountSell: 10,
      tokenAmountBuy: 0,
      slippage: null,
      paymentAddress: 'addr1qtest'
    });
    expect(capturedPath).toBe('/v1/aggregator/simple/create-from-asset');
    expect(payload.successTransactions?.[0]?.hexTransaction).toBe('84a300');
    (axios as any).create = origCreate;
  });

  it('Dex convenience: buildFromAssetSignSubmit signs and submits', async () => {
    const dex = new SaturnSwap({} as any);
    // Override API method to return a CBOR hex
    (dex.api as any).createOrderTransactionFromAsset = async () => ({
      successTransactions: [{ hexTransaction: '84a300' }]
    });
    const wallet = new MockWalletProvider();
    const txHash = await dex.buildFromAssetSignSubmit({
      asset: '',
      direction: 3,
      tokenAmountSell: 10,
      tokenAmountBuy: 0,
      slippage: null,
      paymentAddress: 'addr1qtest'
    }, wallet as any);
    expect(txHash).toBe('hashtest');
  });

  it('Dex convenience: createFromAssetHex returns undefined on no valid transactions', async () => {
    const dex = new SaturnSwap({} as any);
    (dex.api as any).createOrderTransactionFromAsset = async () => ({
      error: { message: 'No valid transactions found' },
      successTransactions: []
    });
    const hex = await dex.createFromAssetHex({
      asset: '',
      direction: 3,
      tokenAmountSell: 0.5,   // tiny spend to simulate builder rejection
      tokenAmountBuy: 0,
      slippage: null,
      paymentAddress: 'addr1qtest'
    });
    expect(hex).toBeUndefined();
  });
});


