import { AddressType } from '@app/constants';
import { AssetBalance, PayToAddress } from '@app/types';

const DEFAULT_PLATFORM_FEE_ADDRESS: string = 'addr1q9s6m9d8yedfcf53yhq5j5zsg0s58wpzamwexrxpfelgz2wgk0s9l9fqc93tyc8zu4z7hp9dlska2kew9trdg8nscjcq3sk5s3';
const DEFAULT_PLATFORM_FEE_LOVELACE: string = '2000000';

export function resolvePlatformFeeAddress(): string {
    return process.env.DEXTER_PLATFORM_FEE_ADDRESS ?? DEFAULT_PLATFORM_FEE_ADDRESS;
}

export function resolvePlatformFeeLovelace(): bigint {
    return BigInt(process.env.DEXTER_PLATFORM_FEE_LOVELACE ?? DEFAULT_PLATFORM_FEE_LOVELACE);
}

export const PLATFORM_FEE_ADDRESS: string = resolvePlatformFeeAddress();
export const PLATFORM_FEE_LOVELACE: bigint = resolvePlatformFeeLovelace();

function hasLovelaceAtLeast(assetBalances: AssetBalance[], minimum: bigint): boolean {
    const lovelaceBalance: AssetBalance | undefined = assetBalances.find((balance: AssetBalance) => {
        return balance.asset === 'lovelace';
    });

    return BigInt(lovelaceBalance?.quantity ?? 0n) >= minimum;
}

export function appendPlatformFeeIfMissing(payments: PayToAddress[]): PayToAddress[] {
    const platformFeeAddress: string = resolvePlatformFeeAddress();
    const platformFeeLovelace: bigint = resolvePlatformFeeLovelace();

    if (! platformFeeAddress || platformFeeLovelace <= 0n) {
        return payments;
    }

    const exists: boolean = payments.some((payment: PayToAddress) => {
        return payment.address === platformFeeAddress
            && hasLovelaceAtLeast(payment.assetBalances, platformFeeLovelace);
    });

    if (! exists) {
        payments.push({
            address: platformFeeAddress,
            addressType: AddressType.Base,
            assetBalances: [{
                asset: 'lovelace',
                quantity: platformFeeLovelace,
            }],
            isInlineDatum: false,
        });
    }

    return payments;
}

