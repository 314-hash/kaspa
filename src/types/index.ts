/**
 * ExJanAI Blockchain — Core Type Definitions
 * Identity: ExJanAI Blockchain (Proposed Kaspa-Integrated Layer 2)
 */

export type OperationType = 'TRANSFER' | 'DEPLOY' | 'CALL' | 'WITHDRAW' | 'DEPOSIT';

export interface ExJanAIAccount {
  address: string;
  nonce: number;
  balance: bigint;
  storageRoot: string;
  updatedAt: number;
}

export interface ExJanAITransaction {
  version: number;
  chainId: number;
  nonce: number;
  from: string;
  to: string;
  amount: bigint;
  fee: bigint;
  opType: OperationType;
  payload: string; // hex-encoded
  signature: string; // hex-encoded ECDSA signature
  hash?: string; // computed transaction hash
}

export interface TransactionReceipt {
  txHash: string;
  status: 0 | 1; // 0 = failed, 1 = success
  gasUsed: bigint;
  blockNumber: number;
  errorMessage?: string;
  stateDelta: {
    from: string;
    to: string;
    amount: bigint;
    fee: bigint;
    newNonce: number;
  };
}

export type SettlementStatus = 'PENDING' | 'SUBMITTED' | 'INCLUDED' | 'SETTLED' | 'REORGANIZED';

export interface ExJanAIBatch {
  batchId: number;
  preStateRoot: string;
  postStateRoot: string;
  txRoot: string;
  txCount: number;
  transactions: ExJanAITransaction[];
  receipts: TransactionReceipt[];
  proof?: ExecutionProof;
  timestamp: number;
  settlement: {
    status: SettlementStatus;
    l1TxId?: string;
    l1BlueScore?: number;
    confirmedAt?: number;
    submittedAt?: number;
  };
}

export interface ExecutionProof {
  proofType: 'TRACE_COMMITMENT_V1' | 'GROTH16_BN254_CANDIDATE' | 'MOCK_TEST_VECTOR';
  publicInputs: {
    batchId: number;
    preStateRoot: string;
    postStateRoot: string;
    txRoot: string;
    txCount: number;
    timestamp: number;
  };
  proofData: string; // hex-encoded proof payload or cryptographic commitment
  isMock: boolean;
  generatedAt: number;
}

export interface WithdrawalRequest {
  id: string;
  batchId: number;
  l2Sender: string;
  l1Recipient: string;
  amount: bigint;
  status: 'PENDING_SETTLEMENT' | 'READY_FOR_CLAIM' | 'CLAIMED';
  l1ClaimTxId?: string;
  createdAt: number;
}

export interface ChainCheckTarget {
  name: string;
  protocol: 'KASPA_REST' | 'KASPA_WRPC' | 'EVM_RPC' | 'GENERIC_HTTP';
  url: string;
  timeoutMs?: number;
  expectedNetwork?: string;
}

export interface LatencyBreakdown {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  totalMs: number;
}

export interface ProbeResult {
  target: ChainCheckTarget;
  timestamp: number;
  isOnline: boolean;
  statusCode?: number;
  latency: LatencyBreakdown;
  protocolDetails: Record<string, unknown>;
  reliabilityScore: number;
  error?: string;
}

export interface IntelligenceItem {
  id: string;
  repository: string;
  category: 'RELEASE' | 'KIP' | 'SECURITY' | 'RESEARCH';
  title: string;
  url: string;
  summary: string;
  rawDetails?: string;
  publishedAt: string;
  collectedAt: number;
  isVerifiedUpstream: boolean;
}
