export type AgentPersonaType =
  | "TreasurySentinelAgent"
  | "LiabilityRadarAgent"
  | "DisbursalRouterAgent"
  | "PolicyComplianceAgent"
  | "LedgerWitnessAgent";

export interface AgentDescriptor {
  name: AgentPersonaType;
  erc8004Id: number;
  description: string;
  canSignTransactions: boolean;
  canWriteLedger: boolean;
}

export const AGENT_REGISTRY: Record<AgentPersonaType, AgentDescriptor> = {
  TreasurySentinelAgent: {
    name: "TreasurySentinelAgent",
    erc8004Id: 101,
    description: "Yield Optimizer & Dynamic Safe-to-Invest Executor",
    canSignTransactions: true,
    canWriteLedger: false,
  },
  LiabilityRadarAgent: {
    name: "LiabilityRadarAgent",
    erc8004Id: 102,
    description: "SaaS & Recurring Obligation Auditor",
    canSignTransactions: false,
    canWriteLedger: false,
  },
  DisbursalRouterAgent: {
    name: "DisbursalRouterAgent",
    erc8004Id: 103,
    description: "Cross-Account Liquidity Strategist & Waterfall Executor",
    canSignTransactions: true,
    canWriteLedger: false,
  },
  PolicyComplianceAgent: {
    name: "PolicyComplianceAgent",
    erc8004Id: 104,
    description: "Governance Gatekeeper & Human Liaison (SPRS / EIP-712)",
    canSignTransactions: false,
    canWriteLedger: false,
  },
  LedgerWitnessAgent: {
    name: "LedgerWitnessAgent",
    erc8004Id: 105,
    description: "Independent External Auditor & Hash-Chained Double-Entry Reconciler",
    canSignTransactions: false,
    canWriteLedger: true,
  },
};

export interface AccountAgentAuditLogRecord {
  logId?: number;
  accountId: string;
  timestamp: string;
  actionType: string;
  amountUsdc: string;
  isAutonomous: boolean;
  permissionRequestId?: string;
  txHash?: `0x${string}`;
  counterpartyAddress?: `0x${string}`;
  reason: string;
  preStateSnapshot: Record<string, unknown>;
  postStateSnapshot: Record<string, unknown>;
  actorAgent: AgentPersonaType;
}

export interface MasterJournalVoucherRecord {
  sequenceId?: number;
  timestamp: string;
  accountId: string;
  actionType: string;
  debitAccount: string;
  creditAccount: string;
  amountUsdc: string;
  documentRef: string;
  txHash?: string;
  previousHash: string;
  currentHash: string;
}
