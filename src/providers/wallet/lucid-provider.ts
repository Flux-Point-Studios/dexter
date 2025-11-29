import {
    AssetBalance,
    BlockfrostConfig,
    Cip30Api,
    KupmiosConfig,
    PayToAddress,
    SpendUTxO,
    UTxO,
    WalletOptions
} from '@app/types';
import { DexTransaction } from '@dex/models/dex-transaction';
import { BaseWalletProvider } from './base-wallet-provider';
import {
    Address,
    AddressDetails,
    Assets,
    Blockfrost,
    getAddressDetails, 
    Kupmios,
    Lucid,
    LucidEvolution,
    TxHash,
    TxSignBuilder,
    TxSigned,
    Unit
} from '@lucid-evolution/lucid';
import { AddressType } from '@app/constants';
import { resolveBlockfrostConfigFromOptsOrEnv } from '@app/config/blockfrost';

export class LucidProvider extends BaseWalletProvider {

    public isWalletLoaded: boolean = false;

    private _api: LucidEvolution;
    private _usableAddress: string;
    private _paymentCredential: string;
    private _stakingCredential: string | undefined;

    public address(): string {
        return this._usableAddress;
    }

    public publicKeyHash(): string {
        return this._paymentCredential;
    }

    public stakingKeyHash(): string {
        return this._stakingCredential ?? '';
    }

    public loadWallet(walletApi: Cip30Api, config: BlockfrostConfig | KupmiosConfig): Promise<BaseWalletProvider> {
        return this.loadLucid(config)
            .then((lucid: LucidEvolution) => {
                this._api = lucid;

                this._api.selectWallet.fromAPI(walletApi);

                return this.loadWalletInformation();
            });
    }

    public loadWalletFromSeedPhrase(seed: string[], options: WalletOptions = {}, config: BlockfrostConfig | KupmiosConfig): Promise<BaseWalletProvider> {
        return this.loadLucid(config)
            .then((lucid: LucidEvolution) => {
                this._api = lucid;

                const addressType: 'Base' | 'Enterprise' = options.addressType === AddressType.Enterprise
                    ? 'Enterprise'
                    : 'Base';

                this._api.selectWallet.fromSeed(
                    seed.join(' '),
                    {
                        addressType: addressType,
                        accountIndex: options.accountIndex ?? 0,
                    },
                );

                return this.loadWalletInformation();
            });
    }

    public createTransaction(): DexTransaction {
        const transaction: DexTransaction = new DexTransaction(this);
        transaction.providerData.tx = this._api.newTx();

        return transaction;
    }

    public attachMetadata(transaction: DexTransaction, key: number, json: Object): DexTransaction {
        if (! transaction.providerData.tx) {
            return transaction;
        }

        transaction.providerData.tx.attachMetadata(key, json);

        return transaction;
    }

    public async paymentsForTransaction(transaction: DexTransaction, payToAddresses: PayToAddress[]): Promise<DexTransaction> {
        payToAddresses.forEach((payToAddress: PayToAddress) => {
            const payment: Assets = this.paymentFromAssets(payToAddress.assetBalances);

            // Include UTxOs to spend
            if (payToAddress.spendUtxos && payToAddress.spendUtxos.length > 0) {
                payToAddress.spendUtxos.forEach((spendUtxo: SpendUTxO) => {
                    transaction.providerData.tx.collectFrom([
                        {
                            txHash: spendUtxo.utxo.txHash,
                            outputIndex: spendUtxo.utxo.outputIndex,
                            address: spendUtxo.utxo.address,
                            datumHash: spendUtxo.utxo.datum ? null : spendUtxo.utxo.datumHash,
                            datum: spendUtxo.utxo.datum,
                            assets: this.paymentFromAssets(spendUtxo.utxo.assetBalances),
                        }
                    ], spendUtxo.redeemer);

                    if (spendUtxo.validator) {
                        transaction.providerData.tx.attachSpendingValidator(spendUtxo.validator);
                    }

                    if (spendUtxo.signer) {
                        transaction.providerData.tx.addSigner(spendUtxo.signer);
                    }
                });
            }

            switch (payToAddress.addressType) {
                case AddressType.Contract:
                    const outputDatum = payToAddress.isInlineDatum
                        ? {
                            kind: 'inline' as const,
                            value: payToAddress.datum,
                          }
                        : {
                            kind: 'hash' as const,
                            value: payToAddress.datum,
                          };

                    transaction.providerData.tx.pay.ToContract(
                        payToAddress.address,
                        outputDatum,
                        payment,
                    );
                    break;
                case AddressType.Base:
                case AddressType.Enterprise:
                    transaction.providerData.tx.pay.ToAddress(
                        payToAddress.address,
                        payment,
                    );
                    break;
                default:
                    throw new Error('Encountered unknown address type.');
            }
        });


        if (transaction.useChaining) {
            const [newWalletUTxOs, derivedOutputs, txSignBuilder] =
                await transaction.providerData.tx.chain();
            transaction.chainData = { newWalletUTxOs, derivedOutputs };
            transaction.providerData.tx = txSignBuilder;
            return transaction;
        } else {
            return transaction.providerData.tx.complete()
                .then((tx: TxSignBuilder) => {
                    transaction.providerData.tx = tx;

                    return transaction;
                });
        }
    }

    public signTransaction(transaction: DexTransaction): Promise<DexTransaction> {
        if (! this.isWalletLoaded) {
            throw new Error('Must load wallet before signing transaction.');
        }

        return transaction.providerData.tx.sign.withWallet().complete()
            .then((signedTx: TxSigned) => {
                transaction.providerData.tx = signedTx;

                return transaction;
            });
    }

    public submitTransaction(transaction: DexTransaction): Promise<string> {
        return transaction.providerData.tx.submit()
            .then((txHash: TxHash) => {
                return txHash;
            });
    }

    public overrideWalletUtxos(utxos: UTxO[]): void {
        const lucidUtxos = utxos.map(utxo => ({
            txHash: utxo.txHash,
            outputIndex: utxo.outputIndex,
            address: utxo.address,
            datumHash: utxo.datumHash,
            datum: utxo.datum,
            assets: this.paymentFromAssets(utxo.assetBalances),
        }));
        this._api.overrideUTxOs(lucidUtxos);
    }

    public newTransactionFromHex(txCborHex: string): DexTransaction {
        const transaction: DexTransaction = new DexTransaction(this);
        // fromTx returns a signable builder compatible with our flow
        (transaction as any).providerData.tx = (this._api as any).fromTx(txCborHex);
        return transaction;
    }

    public importTransactionHex(transaction: DexTransaction, txCborHex: string): DexTransaction {
        (transaction as any).providerData.tx = (this._api as any).fromTx(txCborHex);
        return transaction;
    }

    private paymentFromAssets(assetBalances: AssetBalance[]): Assets {
        return assetBalances
            .reduce((payment: Record<Unit | 'lovelace', bigint>, assetBalance: AssetBalance) => {
                payment[assetBalance.asset === 'lovelace' ? 'lovelace' : assetBalance.asset.identifier()] = assetBalance.quantity;

                return payment;
            }, {} as Assets);
    }

    private loadWalletInformation(): Promise<BaseWalletProvider> {
        return this._api.wallet().address()
            .then((address: Address) => {
                const details: AddressDetails = getAddressDetails(address);

                this._usableAddress = address;
                this._paymentCredential = details.paymentCredential?.hash ?? '';
                this._stakingCredential = details.stakeCredential?.hash ?? '';

                this.isWalletLoaded = true;

                return this as BaseWalletProvider;
            });
    }

    private loadLucid(config: BlockfrostConfig | KupmiosConfig): Promise<LucidEvolution> {
        if ('kupoUrl' in config) {
            return Lucid(
                new Kupmios(config.kupoUrl, config.ogmiosUrl),
                "Mainnet"
            );
        }

        const { url, projectId } = resolveBlockfrostConfigFromOptsOrEnv(
            config as BlockfrostConfig
        );

        return Lucid(new Blockfrost(url, projectId), "Mainnet");
    }

}
