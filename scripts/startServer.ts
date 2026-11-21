import { SystemHttpServer } from "../src/ingress/systemHttpServer.js";
import { TreasuryStateMachineOrchestrator } from "../src/orchestration/treasuryStateMachineOrchestrator.js";

async function main() {
  console.log("Starting BizArc Autonomous Treasury Server...");
  let orchestrator: TreasuryStateMachineOrchestrator | undefined;
  try {
    orchestrator = new TreasuryStateMachineOrchestrator();
  } catch (err: any) {
    console.warn("Starting with fallback orchestrator:", err.message);
  }

  const server = new SystemHttpServer(orchestrator, 3000);
  const port = await server.start();
  console.log(`[BizArc Backend API] Listening at http://localhost:${port}`);
}

main().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
