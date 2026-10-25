import { generateKeyPair, signTransaction, deriveAddress } from '../core/crypto.ts';
import type { ExJanAITransaction, OperationType } from '../types/index.ts';

export class TestWallet {
  public privateKey: string;
  public publicKey: string;
  public address: string;
  public chainId: number;

  constructor(chainId: number = 1111, existingPrivateKey?: string, existingPublicKey?: string) {
    this.chainId = chainId;
    if (existingPrivateKey && existingPublicKey) {
      this.privateKey = existingPrivateKey;
      this.publicKey = existingPublicKey;
      this.address = deriveAddress(existingPublicKey);
    } else {
      const generated = generateKeyPair();
      this.privateKey = generated.privateKey;
      this.publicKey = generated.publicKey;
      this.address = generated.address;
    }
  }

  /**
   * Create and sign a typed ExJanAI Layer 2 transaction
   */
  public createTransaction(params: {
    to: string;
    amount: bigint | number;
    fee: bigint | number;
    nonce: number;
    opType?: OperationType;
    payload?: string;
  }): ExJanAITransaction {
    const unsigned = {
      version: 1,
      chainId: this.chainId,
      nonce: params.nonce,
      from: this.address,
      to: params.to,
      amount: BigInt(params.amount),
      fee: BigInt(params.fee),
      opType: params.opType || 'TRANSFER',
      payload: params.payload || '',
    };

    return signTransaction(unsigned, this.privateKey);
  }

  /**
   * Create a withdrawal transaction to Kaspa L1
   */
  public createWithdrawal(params: {
    l1KaspaAddress: string;
    amount: bigint | number;
    fee: bigint | number;
    nonce: number;
  }): ExJanAITransaction {
    return this.createTransaction({
      to: '0x0000000000000000000000000000000000000000', // Burn address
      amount: params.amount,
      fee: params.fee,
      nonce: params.nonce,
      opType: 'WITHDRAW',
      payload: Buffer.from(params.l1KaspaAddress, 'utf-8').toString('hex'),
    });
  }
}
