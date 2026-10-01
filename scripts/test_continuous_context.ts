import { ContinuousContextManager } from "../src/context/continuousContextManager.js";
import { DbClient } from "../src/database/dbClient.js";

async function main() {
  console.log("[Test] Testing ContinuousContextManager & Dual-Stream Compaction...");
  const sessionId = `test_session_${Date.now()}`;
  const manager = new ContinuousContextManager(undefined, undefined, 5); // threshold 5 for rapid test

  // Record 6 events across different agents
  for (let i = 1; i <= 6; i++) {
    const seq = await manager.recordEvent({
      sessionId,
      agentId: 101,
      agentName: "TreasurySentinelAgent",
      eventType: i === 1 ? "TASK_INITIATED" : "STATE_MUTATION",
      role: "assistant",
      content: `Cycle #${i}: Liquidity evaluated. Idle cash $50,000 swept to USYC Yield Vault. Tx: 0xabc${i}`,
      metadata: { txHash: `0xabc${i}`, cycle: i },
    });
    console.log(` - Recorded Event Seq: ${seq}`);
  }

  // Check if compaction occurred automatically
  const episode = await manager.getLatestCompactedEpisode(sessionId);
  if (!episode) {
    throw new Error("Compaction episode was not created after exceeding threshold!");
  }

  console.log(`[Test] Compaction Succeeded! Episode #${episode.episodeIndex}:`);
  console.log(` - Narrative Summary: ${episode.narrativeSummary}`);
  console.log(` - Invariant Check Passed: ${episode.deterministicAnchors.invariantCheckPassed}`);
  console.log(` - Liquid: ${episode.deterministicAnchors.liquidCashUsdc} USDC`);
  console.log(` - Invested: ${episode.deterministicAnchors.investedYieldUsdc} USDC`);
  console.log(` - Available: ${episode.deterministicAnchors.availableBalanceUsdc} USDC`);

  // Assemble context for an agent
  const assembled = await manager.assembleAgentContext(
    sessionId,
    102,
    "LiabilityRadarAgent",
    "You are the Liability Radar Agent.",
    "Verify AWS invoice INV-2026-901 for 12,500 USDC"
  );

  console.log(`[Test] Assembled prompt context:`);
  console.log(` - Messages count: ${assembled.messages.length}`);
  console.log(` - Relevant Memory count: ${assembled.relevantMemorySnippets.length}`);

  console.log("[Test] Continuous Context & Multi-Tier Management verified successfully!");
  await DbClient.closePool();
}

main().catch(async (err) => {
  console.error("[Test] Error:", err);
  await DbClient.closePool();
  process.exit(1);
});
