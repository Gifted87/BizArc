import { ContinuousContextManager } from "../context/continuousContextManager.js";
import { ILlmEngine, createLlmEngine } from "../llm/llmEngine.js";
import { VectorMemoryService } from "../memory/vectorMemoryService.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import { DisbursalRouterLlmAgent } from "./disbursalRouterLlmAgent.js";
import { LedgerWitnessLlmAgent } from "./ledgerWitnessLlmAgent.js";
import { LiabilityRadarLlmAgent } from "./liabilityRadarLlmAgent.js";
import { OnboardingLlmAgent } from "./onboardingLlmAgent.js";
import { TreasurySentinelLlmAgent } from "./treasurySentinelLlmAgent.js";

export class SwarmCoordinator {
  public readonly sessionId: string;
  public readonly llmEngine: ILlmEngine;
  public readonly vectorMemory: VectorMemoryService;
  public readonly contextManager: ContinuousContextManager;
  public readonly dynamicRecords: DynamicRecordsService;
  public readonly toolRegistry: ToolRegistry;

  // Swarm Agents
  public readonly onboardingAgent: OnboardingLlmAgent;
  public readonly sentinelAgent: TreasurySentinelLlmAgent;
  public readonly radarAgent: LiabilityRadarLlmAgent;
  public readonly routerAgent: DisbursalRouterLlmAgent;
  public readonly witnessAgent: LedgerWitnessLlmAgent;

  constructor(params?: {
    sessionId?: string;
    llmEngine?: ILlmEngine;
    compactionThreshold?: number;
  }) {
    this.sessionId = params?.sessionId || `bizarc_swarm_${Date.now()}`;
    this.llmEngine = params?.llmEngine || createLlmEngine();
    this.vectorMemory = new VectorMemoryService(this.llmEngine);
    this.contextManager = new ContinuousContextManager(
      this.llmEngine,
      this.vectorMemory,
      params?.compactionThreshold || 8
    );
    this.dynamicRecords = new DynamicRecordsService();
    this.toolRegistry = new ToolRegistry(this.vectorMemory, this.dynamicRecords);

    const agentDeps = {
      llmEngine: this.llmEngine,
      contextManager: this.contextManager,
      vectorMemory: this.vectorMemory,
      dynamicRecords: this.dynamicRecords,
      toolRegistry: this.toolRegistry,
    };

    this.onboardingAgent = new OnboardingLlmAgent(agentDeps);
    this.sentinelAgent = new TreasurySentinelLlmAgent(agentDeps);
    this.radarAgent = new LiabilityRadarLlmAgent(agentDeps);
    this.routerAgent = new DisbursalRouterLlmAgent(agentDeps);
    this.witnessAgent = new LedgerWitnessLlmAgent(agentDeps);
  }

  /**
   * Initializes the swarm: seeds enterprise vector memory, verified vendors, and initial accounts.
   */
  public async initializeEnterpriseSwarm(): Promise<void> {
    await this.vectorMemory.seedEnterpriseTruth();

    await this.contextManager.recordEvent({
      sessionId: this.sessionId,
      agentId: 100,
      agentName: "OnboardingAgent",
      eventType: "STATE_MUTATION",
      role: "system",
      content: "Swarm initialized with Enterprise Truth (Corporate Bylaws, MSAs, and ERP POs in pgvector).",
      metadata: { initializedAt: new Date().toISOString() },
    });
  }
}
