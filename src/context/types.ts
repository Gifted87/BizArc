import { LlmMessage, LlmRole, LlmToolCall } from "../llm/types.js";

export type ContextEventType =
  | "TASK_INITIATED"
  | "AGENT_REASONING"
  | "TOOL_CALLED"
  | "TOOL_RESULT"
  | "STATE_MUTATION"
  | "INVARIANT_CHECK"
  | "SYSTEM_INTERRUPT"
  | "HUMAN_ESCALATION";

export interface ContextEvent {
  id?: string;
  sessionId: string;
  eventSeq?: number;
  agentId: number;
  agentName: string;
  eventType: ContextEventType;
  role: LlmRole;
  content: string;
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
  metadata?: Record<string, any>;
  isCompacted?: boolean;
  createdAt?: Date;
}

export interface DeterministicFinancialAnchors {
  liquidCashUsdc: string;
  investedYieldUsdc: string;
  availableBalanceUsdc: string;
  targetReserveUsdc: string;
  safeToInvestUsdc: string;
  pendingLiabilities: Array<{
    liabilityId: string;
    vendorId: string;
    amountUsdc: string;
    dueDate: string;
  }>;
  recentTxHashes: string[];
  documentHashes: string[];
  invariantCheckPassed: boolean;
}

export interface CompactionEpisode {
  id?: string;
  sessionId: string;
  episodeIndex: number;
  startSeq: number;
  endSeq: number;
  narrativeSummary: string;
  deterministicAnchors: DeterministicFinancialAnchors;
  createdAt?: Date;
}

export interface AssembledAgentContext {
  systemPrompt: string;
  messages: LlmMessage[];
  relevantMemorySnippets: string[];
  activeAnchors: DeterministicFinancialAnchors | null;
}
