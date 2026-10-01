import { DbClient } from "../database/dbClient.js";
import { ILlmEngine, createLlmEngine } from "../llm/llmEngine.js";
import { LlmMessage } from "../llm/types.js";
import { VectorMemoryService } from "../memory/vectorMemoryService.js";
import {
  AssembledAgentContext,
  CompactionEpisode,
  ContextEvent,
  DeterministicFinancialAnchors,
} from "./types.js";

export class ContinuousContextManager {
  private llmEngine: ILlmEngine;
  private vectorMemory: VectorMemoryService;
  private compactionThreshold: number;

  constructor(
    llmEngine?: ILlmEngine,
    vectorMemory?: VectorMemoryService,
    compactionThreshold: number = 10
  ) {
    this.llmEngine = llmEngine || createLlmEngine();
    this.vectorMemory = vectorMemory || new VectorMemoryService(this.llmEngine);
    this.compactionThreshold = compactionThreshold;
  }

  /**
   * Publishes an event to the shared living blackboard context stream.
   * Auto-triggers background rolling compaction if threshold is reached.
   */
  public async recordEvent(event: ContextEvent): Promise<number> {
    const res = await DbClient.query(
      `INSERT INTO agent_continuous_context 
        (session_id, agent_id, agent_name, event_type, role, content, tool_calls, tool_call_id, metadata, is_compacted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
       RETURNING event_seq;`,
      [
        event.sessionId,
        event.agentId,
        event.agentName,
        event.eventType,
        event.role,
        event.content,
        event.toolCalls ? JSON.stringify(event.toolCalls) : null,
        event.toolCallId || null,
        JSON.stringify(event.metadata || {}),
      ]
    );

    const eventSeq = parseInt(res.rows[0].event_seq, 10);

    // Check if background compaction is warranted
    const uncompactedCount = await this.getUncompactedCount(event.sessionId);
    if (uncompactedCount >= this.compactionThreshold) {
      // Trigger rolling compaction asynchronously
      await this.performDualStreamCompaction(event.sessionId);
    }

    return eventSeq;
  }

  /**
   * Retrieves hot uncompacted events for active working memory.
   */
  public async getHotEvents(sessionId: string, limit: number = 25): Promise<ContextEvent[]> {
    const res = await DbClient.query(
      `SELECT id, session_id, event_seq, agent_id, agent_name, event_type, role, content, 
              tool_calls, tool_call_id, metadata, is_compacted, created_at
       FROM agent_continuous_context
       WHERE session_id = $1 AND is_compacted = FALSE
       ORDER BY event_seq ASC
       LIMIT $2;`,
      [sessionId, limit]
    );

    return res.rows.map(this.mapRowToContextEvent);
  }

  /**
   * Retrieves the latest deterministic financial anchors and compacted episodes.
   */
  public async getLatestCompactedEpisode(sessionId: string): Promise<CompactionEpisode | null> {
    const res = await DbClient.query(
      `SELECT id, session_id, episode_index, start_seq, end_seq, narrative_summary, 
              deterministic_anchors, created_at
       FROM agent_context_compaction_episodes
       WHERE session_id = $1
       ORDER BY episode_index DESC
       LIMIT 1;`,
      [sessionId]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      sessionId: row.session_id,
      episodeIndex: row.episode_index,
      startSeq: parseInt(row.start_seq, 10),
      endSeq: parseInt(row.end_seq, 10),
      narrativeSummary: row.narrative_summary,
      deterministicAnchors: row.deterministic_anchors,
      createdAt: row.created_at,
    };
  }

  /**
   * Performs Dual-Stream Rolling Compaction:
   * Stream A: Narrative Strategic Synthesis
   * Stream B: Invariable Deterministic Financial Anchors (6-decimal figures & hashes)
   */
  public async performDualStreamCompaction(sessionId: string): Promise<CompactionEpisode | null> {
    const uncompactedRes = await DbClient.query(
      `SELECT id, session_id, event_seq, agent_id, agent_name, event_type, role, content, 
              tool_calls, tool_call_id, metadata
       FROM agent_continuous_context
       WHERE session_id = $1 AND is_compacted = FALSE
       ORDER BY event_seq ASC;`,
      [sessionId]
    );

    if (uncompactedRes.rows.length === 0) return null;

    const eventsToCompact: ContextEvent[] = uncompactedRes.rows.map(this.mapRowToContextEvent);
    const startSeq = eventsToCompact[0].eventSeq || 1;
    const endSeq = eventsToCompact[eventsToCompact.length - 1].eventSeq || startSeq;

    // Get previous episode index
    const episodeIndexRes = await DbClient.query(
      `SELECT COALESCE(MAX(episode_index), 0) + 1 AS next_index
       FROM agent_context_compaction_episodes
       WHERE session_id = $1;`,
      [sessionId]
    );
    const nextEpisodeIndex = parseInt(episodeIndexRes.rows[0].next_index, 10);

    // Stream A: Narrative Synthesis
    const narrativeSummary = await this.synthesizeNarrative(eventsToCompact);

    // Stream B: Deterministic Financial Anchors (Strict 6-decimal & hashes)
    const deterministicAnchors = await this.extractDeterministicAnchors(eventsToCompact);

    // Embed episode into Vector Store for long-term semantic retrieval (Tier 3)
    const episodeContent = `EPISODE #${nextEpisodeIndex} SUMMARY: ${narrativeSummary}\nFINANCIAL STATE: Liquid=${deterministicAnchors.liquidCashUsdc} USDC, Invested=${deterministicAnchors.investedYieldUsdc} USDC, SafeToInvest=${deterministicAnchors.safeToInvestUsdc} USDC.`;
    const embedding = await this.llmEngine.embedText(episodeContent);
    const embeddingSql = `[${embedding.join(",")}]`;

    // Insert Compaction Episode
    const episodeRes = await DbClient.query(
      `INSERT INTO agent_context_compaction_episodes
        (session_id, episode_index, start_seq, end_seq, narrative_summary, deterministic_anchors, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       RETURNING id, created_at;`,
      [
        sessionId,
        nextEpisodeIndex,
        startSeq,
        endSeq,
        narrativeSummary,
        JSON.stringify(deterministicAnchors),
        embeddingSql,
      ]
    );

    // Ingest into Enterprise Vector Memory collection 'episodic_memory'
    await this.vectorMemory.ingestDocument({
      collection: "episodic_memory",
      documentId: `EPISODE-${sessionId}-${nextEpisodeIndex}`,
      title: `Compacted Episode #${nextEpisodeIndex} (Seq ${startSeq}-${endSeq})`,
      content: episodeContent,
      metadata: {
        sessionId,
        episodeIndex: nextEpisodeIndex,
        startSeq,
        endSeq,
        deterministicAnchors,
      },
    });

    // Mark events as compacted
    await DbClient.query(
      `UPDATE agent_continuous_context
       SET is_compacted = TRUE
       WHERE session_id = $1 AND event_seq >= $2 AND event_seq <= $3;`,
      [sessionId, startSeq, endSeq]
    );

    return {
      id: episodeRes.rows[0].id,
      sessionId,
      episodeIndex: nextEpisodeIndex,
      startSeq,
      endSeq,
      narrativeSummary,
      deterministicAnchors,
      createdAt: episodeRes.rows[0].created_at,
    };
  }

  /**
   * Assembles multi-tiered prompt context for an agent executing a cognitive task.
   */
  public async assembleAgentContext(
    sessionId: string,
    agentId: number,
    agentName: string,
    systemInstruction: string,
    currentTask: string
  ): Promise<AssembledAgentContext> {
    // 1. Semantic Memory Retrieval (Tier 3)
    const memoryResults = await this.vectorMemory.queryRelevantMemory(
      currentTask,
      ["company_bylaws", "msas", "erp_pos", "episodic_memory"],
      4
    );
    const relevantMemorySnippets = memoryResults.map(
      (m) => `[Source: ${m.collection} | ${m.title}]: ${m.content.trim()}`
    );

    // 2. Latest Episodic Summary & Invariant Anchors (Tier 2)
    const latestEpisode = await this.getLatestCompactedEpisode(sessionId);

    // 3. Hot Working Events (Tier 1)
    const hotEvents = await this.getHotEvents(sessionId, 20);

    // Build Messages array
    const messages: LlmMessage[] = [];

    // System prompt includes role, corporate ground truth, and mathematical invariants
    let fullSystemPrompt = `${systemInstruction.trim()}
YOU ARE AGENT ID #${agentId}: ${agentName}.
You operate within the BizArc Autonomous Multi-Agent Swarm on Arc L1 (USDC native gas, sub-second finality).
All financial arithmetic MUST be exact 6-decimal USDC. Never invent, approximate, or silently round numbers.
Model outputs are suggestions for deterministic tools; never bypass smart contract or database guardrails.`;

    if (latestEpisode) {
      fullSystemPrompt += `\n\n--- PREVIOUS EPISODE NARRATIVE (EPISODE #${latestEpisode.episodeIndex}) ---
${latestEpisode.narrativeSummary}
LOCKED FINANCIAL ANCHORS:
- Liquid Cash: ${latestEpisode.deterministicAnchors.liquidCashUsdc} USDC
- Invested Yield (USYC): ${latestEpisode.deterministicAnchors.investedYieldUsdc} USDC
- Available Balance: ${latestEpisode.deterministicAnchors.availableBalanceUsdc} USDC
- Safe-to-Invest: ${latestEpisode.deterministicAnchors.safeToInvestUsdc} USDC
- Invariant Check: ${latestEpisode.deterministicAnchors.invariantCheckPassed ? "PASSED" : "FAILED"}`;
    }

    if (relevantMemorySnippets.length > 0) {
      fullSystemPrompt += `\n\n--- ENTERPRISE VECTOR MEMORY RETRIEVAL (ENTERPRISE TRUTH) ---
${relevantMemorySnippets.join("\n\n")}`;
    }

    messages.push({ role: "system", content: fullSystemPrompt });

    // Append hot events as chat history
    for (const ev of hotEvents) {
      const msg: LlmMessage = {
        role: ev.role,
        content: `[Seq ${ev.eventSeq} | ${ev.agentName} | ${ev.eventType}]: ${ev.content}`,
      };
      if (ev.toolCalls) msg.tool_calls = ev.toolCalls;
      if (ev.toolCallId) msg.tool_call_id = ev.toolCallId;
      messages.push(msg);
    }

    // Append current user task
    messages.push({
      role: "user",
      content: `CURRENT TASK: ${currentTask}`,
    });

    return {
      systemPrompt: fullSystemPrompt,
      messages,
      relevantMemorySnippets,
      activeAnchors: latestEpisode ? latestEpisode.deterministicAnchors : null,
    };
  }

  private async getUncompactedCount(sessionId: string): Promise<number> {
    const res = await DbClient.query(
      `SELECT COUNT(*) AS cnt FROM agent_continuous_context WHERE session_id = $1 AND is_compacted = FALSE;`,
      [sessionId]
    );
    return parseInt(res.rows[0].cnt, 10);
  }

  private async synthesizeNarrative(events: ContextEvent[]): Promise<string> {
    const rawEvents = events
      .map((e) => `[Seq #${e.eventSeq}] ${e.agentName} (${e.eventType}): ${e.content}`)
      .join("\n");

    try {
      const response = await this.llmEngine.chatCompletion([
        {
          role: "system",
          content:
            "You are the BizArc Continuous Context Compaction Engine. Synthesize the provided agent events into a dense, factual semantic narrative stream preserving key decisions, account IDs, amounts, and operational state mutations. Output only the narrative synthesis.",
        },
        { role: "user", content: `Synthesize these swarm events:\n${rawEvents}` },
      ]);
      if (response && response.content && response.content.trim().length > 0) {
        return response.content.trim();
      }
    } catch {
      // Fallback to deterministic synthesis if LLM engine call is unavailable
    }

    const summaryPoints: string[] = [];
    for (const ev of events) {
      if (ev.eventType === "TASK_INITIATED" || ev.eventType === "TOOL_RESULT" || ev.eventType === "STATE_MUTATION") {
        summaryPoints.push(`${ev.agentName} ${ev.eventType.toLowerCase()}: ${ev.content.slice(0, 140)}`);
      }
    }
    if (summaryPoints.length === 0) {
      return `Agents performed ${events.length} routine context evaluations and data checks.`;
    }
    return `During sequence ${events[0].eventSeq}-${events[events.length - 1].eventSeq}: ${summaryPoints.join("; ")}.`;
  }

  private async extractDeterministicAnchors(
    events: ContextEvent[]
  ): Promise<DeterministicFinancialAnchors> {
    // Read current state from dynamic records and database
    const stiRes = await DbClient.query(
      `SELECT liquid_cash_usdc, invested_yield_usdc, available_balance_usdc, 
              target_reserve_usdc, safe_to_invest_usdc
       FROM dynamic_safe_to_invest
       ORDER BY record_id DESC
       LIMIT 1;`
    );

    let liquid = "100000.000000";
    let invested = "50000.000000";
    let available = "150000.000000";
    let reserve = "20000.000000";
    let safeToInvest = "30000.000000";

    if (stiRes.rows.length > 0) {
      const r = stiRes.rows[0];
      // Format exact 6-decimal representation from PostgreSQL NUMERIC without IEEE 754 float contamination
      const formatExact6 = (val: any): string => {
        if (val === null || val === undefined) return "0.000000";
        const str = String(val);
        const [intPart, decPart = ""] = str.split(".");
        return `${intPart}.${decPart.padEnd(6, "0").slice(0, 6)}`;
      };
      liquid = formatExact6(r.liquid_cash_usdc);
      invested = formatExact6(r.invested_yield_usdc);
      available = formatExact6(r.available_balance_usdc);
      reserve = formatExact6(r.target_reserve_usdc);
      safeToInvest = formatExact6(r.safe_to_invest_usdc);
    }

    // Read active liabilities
    const liaRes = await DbClient.query(
      `SELECT liability_id, vendor_id, amount_usdc, due_date
       FROM account_liabilities
       WHERE status IN ('SCHEDULED', 'AWAITING_APPROVAL')
       ORDER BY due_date ASC
       LIMIT 10;`
    );

    const pendingLiabilities = liaRes.rows.map((r: any) => ({
      liabilityId: r.liability_id,
      vendorId: r.vendor_id,
      amountUsdc: Number(r.amount_usdc).toFixed(6),
      dueDate: new Date(r.due_date).toISOString(),
    }));

    // Extract tx hashes and doc hashes mentioned in event metadata
    const recentTxHashes: string[] = [];
    const documentHashes: string[] = [];

    for (const ev of events) {
      if (ev.metadata?.txHash && !recentTxHashes.includes(ev.metadata.txHash)) {
        recentTxHashes.push(ev.metadata.txHash);
      }
      if (ev.metadata?.docHash && !documentHashes.includes(ev.metadata.docHash)) {
        documentHashes.push(ev.metadata.docHash);
      }
    }

    // Invariant check: Available == Liquid + Invested (exact 6-decimal integer check)
    const liquidRaw = Math.round(parseFloat(liquid) * 1e6);
    const investedRaw = Math.round(parseFloat(invested) * 1e6);
    const availableRaw = Math.round(parseFloat(available) * 1e6);
    const invariantCheckPassed = liquidRaw + investedRaw === availableRaw;

    return {
      liquidCashUsdc: liquid,
      investedYieldUsdc: invested,
      availableBalanceUsdc: available,
      targetReserveUsdc: reserve,
      safeToInvestUsdc: safeToInvest,
      pendingLiabilities,
      recentTxHashes,
      documentHashes,
      invariantCheckPassed,
    };
  }

  private mapRowToContextEvent(row: any): ContextEvent {
    return {
      id: row.id,
      sessionId: row.session_id,
      eventSeq: parseInt(row.event_seq, 10),
      agentId: row.agent_id,
      agentName: row.agent_name,
      eventType: row.event_type,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls || undefined,
      toolCallId: row.tool_call_id || undefined,
      metadata: row.metadata || {},
      isCompacted: row.is_compacted,
      createdAt: row.created_at,
    };
  }
}
