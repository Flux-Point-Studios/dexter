import { Asset } from '@dex/models/asset';
import { AssetBalance } from '@app/types';
import { AssetInfo, Currency, Currencies } from '@splashprotocol/sdk';

const ADA_POLICY_ID = '';

const getNameHex = (asset: AssetInfo): string => {
    if (asset.isAda() || asset.policyId === ADA_POLICY_ID) {
        return '';
    }

    const [, nameHex = ''] = asset.assetId.split('.');

    return nameHex;
};

const toToken = (asset: AssetInfo): Asset | 'lovelace' => {
    if (asset.isAda() || asset.policyId === ADA_POLICY_ID) {
        return 'lovelace';
    }

    return new Asset(
        asset.policyId,
        getNameHex(asset),
        asset.metadata?.decimals ?? 0,
    );
};

const currencyToBalance = (currency: Currency): AssetBalance => {
    return {
        asset: toToken(currency.asset),
        quantity: currency.amount,
    };
};

export const currenciesToAssetBalances = (currencies: Currencies): AssetBalance[] => {
    return currencies.toArray().map(currencyToBalance);
};

export const assetInfoFromToken = (token: Asset | 'lovelace'): AssetInfo => {
    if (token === 'lovelace') {
        return AssetInfo.ada;
    }

    return AssetInfo.fromBase16(token.policyId, token.nameHex ?? '', {
        decimals: token.decimals,
    });
};

