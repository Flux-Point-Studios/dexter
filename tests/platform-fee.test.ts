import { AddressType } from '../src/constants';
import { PayToAddress } from '../src/types';
import {
    appendPlatformFeeIfMissing,
    resolvePlatformFeeAddress,
    resolvePlatformFeeLovelace,
} from '../src/fees/platform-fee';

describe('Platform fee helper', () => {
    const originalAddressEnv = process.env.DEXTER_PLATFORM_FEE_ADDRESS;
    const originalLovelaceEnv = process.env.DEXTER_PLATFORM_FEE_LOVELACE;

    afterEach(() => {
        if (originalAddressEnv === undefined) {
            delete process.env.DEXTER_PLATFORM_FEE_ADDRESS;
        } else {
            process.env.DEXTER_PLATFORM_FEE_ADDRESS = originalAddressEnv;
        }

        if (originalLovelaceEnv === undefined) {
            delete process.env.DEXTER_PLATFORM_FEE_LOVELACE;
        } else {
            process.env.DEXTER_PLATFORM_FEE_LOVELACE = originalLovelaceEnv;
        }
    });

    const mockPayment = (overrides: Partial<PayToAddress> = {}): PayToAddress => ({
        address: 'addr1mock',
        addressType: AddressType.Base,
        assetBalances: [{
            asset: 'lovelace',
            quantity: 5_000000n,
        }],
        isInlineDatum: false,
        ...overrides,
    });

    it('appends platform fee when missing', () => {
        const payments: PayToAddress[] = [mockPayment()];

        const result = appendPlatformFeeIfMissing(payments);

        const feePayment = result.find((payment: PayToAddress) => {
            return payment.address === resolvePlatformFeeAddress();
        });

        expect(feePayment).toBeDefined();
        expect(feePayment?.assetBalances.find((balance) => balance.asset === 'lovelace')?.quantity)
            .toBe(resolvePlatformFeeLovelace());
    });

    it('is idempotent when fee already present', () => {
        const payments: PayToAddress[] = appendPlatformFeeIfMissing([mockPayment()]);

        const result = appendPlatformFeeIfMissing(payments);

        const feePayments = result.filter((payment: PayToAddress) => payment.address === resolvePlatformFeeAddress());

        expect(feePayments).toHaveLength(1);
    });

    it('honors environment overrides', () => {
        process.env.DEXTER_PLATFORM_FEE_ADDRESS = 'addr1override';
        process.env.DEXTER_PLATFORM_FEE_LOVELACE = '3000000';

        const result = appendPlatformFeeIfMissing([]);

        const feePayment = result.find((payment: PayToAddress) => payment.address === 'addr1override');

        expect(resolvePlatformFeeAddress()).toBe('addr1override');
        expect(resolvePlatformFeeLovelace()).toBe(3_000000n);
        expect(feePayment).toBeDefined();
        expect(feePayment?.assetBalances[0].quantity).toBe(3_000000n);
    });
});

