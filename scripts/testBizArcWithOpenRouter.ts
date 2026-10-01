import dotenv from "dotenv";
dotenv.config();

import { UniversalOpenAiCompatibleEngine } from "../src/llm/llmEngine.js";

async function main() {
  console.log("Initializing UniversalOpenAiCompatibleEngine with OpenRouter from .env...");
  const engine = new UniversalOpenAiCompatibleEngine({});

  console.log("Testing chat completion via OpenRouter...");
  const response = await engine.chatCompletion(
    [
      {
        role: "system",
        content: "You are the BizArc Treasury Swarm cognitive engine operating on Circle USDC and Arc L1.",
      },
      {
        role: "user",
        content: "Provide a one-sentence operational status report for BizArc on Arc L1.",
      },
    ],
    undefined,
    { maxTokens: 100 }
  );

  console.log("\n[OpenRouter Response Status: SUCCESS]");
  console.log("Model Output:", response.content?.trim());
  console.log("Finish Reason:", response.finish_reason);
  if (response.usage) {
    console.log("Tokens Usage:", JSON.stringify(response.usage));
  }
}

main().catch((err) => {
  console.error("OpenRouter Test Error:", err);
  process.exit(1);
});
