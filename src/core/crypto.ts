import crypto from 'node:crypto';
import type { ExJanAITransaction } from '../types/index.ts';

/**
 * Deterministic SHA-256 helper
 */
export function sha256(data: string | Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Hash raw buffer to 32-byte Buffer
 */
export function sha256Buffer(data: string | Buffer | Uint8Array): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

/**
 * Address derivation from public key
 * Computes SHA256 of the public key's DER encoding and prefixes with 0x (or exjanai:)
 */
export function deriveAddress(publicKeyPem: string): string {
  const hash = crypto.createHash('sha256').update(publicKeyPem.trim()).digest('hex');
  return `0x${hash.slice(0, 40)}`;
}

/**
 * Generate a new secp256k1 keypair for testing or development
 */
export function generateKeyPair(): {
  privateKey: string;
  publicKey: string;
  address: string;
} {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const address = deriveAddress(publicKey);
  return {
    privateKey,
    publicKey,
    address,
  };
}

/**
 * Deterministic canonical transaction serialization for hashing
 */
export function serializeTransactionForSigning(tx: {
  version: number;
  chainId: number;
  nonce: number;
  from: string;
  to: string;
  amount: bigint | string;
  fee: bigint | string;
  opType: string;
  payload: string;
}): string {
  return JSON.stringify({
    version: tx.version,
    chainId: tx.chainId,
    nonce: tx.nonce,
    from: tx.from.toLowerCase(),
    to: tx.to.toLowerCase(),
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    opType: tx.opType,
    payload: tx.payload || '',
  });
}

/**
 * Compute the canonical 32-byte transaction hash
 */
export function hashTransaction(tx: {
  version: number;
  chainId: number;
  nonce: number;
  from: string;
  to: string;
  amount: bigint | string;
  fee: bigint | string;
  opType: string;
  payload: string;
}): string {
  const canonical = serializeTransactionForSigning(tx);
  return sha256(canonical);
}

/**
 * Sign a transaction using a private key PEM
 */
export function signTransaction(
  tx: Omit<ExJanAITransaction, 'signature' | 'hash'>,
  privateKeyPem: string
): ExJanAITransaction {
  const txHash = hashTransaction(tx);
  const signature = crypto.sign('SHA256', Buffer.from(txHash, 'hex'), privateKeyPem).toString('hex');
  return {
    ...tx,
    amount: BigInt(tx.amount),
    fee: BigInt(tx.fee),
    signature,
    hash: txHash,
  };
}

/**
 * Verify a transaction's cryptographic signature against a public key PEM
 */
export function verifyTransactionSignature(
  tx: ExJanAITransaction,
  publicKeyPem: string
): boolean {
  if (!tx.signature || !tx.from) return false;
  try {
    const expectedAddress = deriveAddress(publicKeyPem);
    if (expectedAddress.toLowerCase() !== tx.from.toLowerCase()) {
      return false;
    }
    const txHash = hashTransaction(tx);
    const isValid = crypto.verify(
      'SHA256',
      Buffer.from(txHash, 'hex'),
      publicKeyPem,
      Buffer.from(tx.signature, 'hex')
    );
    return isValid;
  } catch {
    return false;
  }
}

/**
 * Compute binary Merkle Root of an array of transaction hashes
 */
export function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return sha256('EMPTY_MERKLE_TREE');
  }
  let currentLevel = hashes.map((h) => (h.startsWith('0x') ? h.slice(2) : h));

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left; // duplicate if odd
      const combined = sha256Buffer(Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]));
      nextLevel.push(combined.toString('hex'));
    }
    currentLevel = nextLevel;
  }
  return currentLevel[0];
}
