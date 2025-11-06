import { SaturnSwap } from '../src/dex/saturnswap';
import { SaturnSwapApi } from '../src/dex/api/saturnswap-api';
import axios from 'axios';
import { LucidProvider } from '../src/providers/wallet/lucid-provider';
import { DexTransaction } from '../src/dex/models/dex-transaction';

describe('SaturnSwap REST client & wallet import helpers', () => {

    it('creates axios client with env base URL and proxy', () => {
        const origCreate = axios.create;
        let capturedBaseURL: string | undefined;
        let capturedHeaders: any;

        (process as any).env = Object.assign({}, (process as any).env, {
            SATURN_API_BASE_URL: 'https://example.saturn',
            SATURN_API_KEY: 'test-key',
        });

        (axios as any).create = (cfg: any) => {
            capturedBaseURL = cfg.baseURL;
            capturedHeaders = cfg.headers;
            return {
                get: async () => ({ data: {} }),
                post: async () => ({ data: {} }),
            } as any;
        };

        const dex = new SaturnSwap({ timeout: 1234, proxyUrl: 'https://proxy/' } as any);
        expect(dex).toBeTruthy();

        expect(capturedBaseURL).toBe('https://proxy/https://example.saturn');
        expect(capturedHeaders['Authorization']).toBe('Bearer test-key');

        (axios as any).create = origCreate;
    });

    it('orderbook builds GET with expected params', async () => {
        const origCreate = axios.create;
        let capturedPath: string | undefined;
        let capturedParams: any;

        (axios as any).create = (_cfg: any) => {
            return {
                get: async (path: string, opts?: any) => {
                    capturedPath = path;
                    capturedParams = opts?.params;
                    return { data: { asks: [], bids: [] } };
                },
                post: async () => ({ data: {} }),
            } as any;
        };

        const dex = new SaturnSwap({} as any);
        const api = dex.api as SaturnSwapApi;
        await api.orderbook('lovelace', 'lovelace');

        expect(capturedPath).toBe('/v1/aggregator/orderbook');
        expect(capturedParams.address).toBe(dex.orderAddress);

        (axios as any).create = origCreate;
    });

    it('LucidProvider can import a prebuilt tx hex into a DexTransaction', () => {
        const provider = new LucidProvider();
        (provider as any)._api = {
            fromTx: (hex: string) => ({ mocked: true, hex }),
        };

        const tx: DexTransaction = provider.newTransactionFromHex('84a300');
        expect(tx).toBeTruthy();
        expect((tx as any).providerData.tx).toBeTruthy();
    });
});


