import { PolicyLoader } from "../src/config/policyLoader.js";
import { AGENT_REGISTRY } from "../src/types/agents.js";
import fs from "fs";
import path from "path";

console.log("=== Running D0/D1 Verification Tests ===");

// 1. Verify policy loading & active profile
console.log("1. Testing PolicyLoader with business_policy.yaml...");
const { profileName, profile } = PolicyLoader.getActiveProfile();
console.log(`✓ Successfully loaded active profile: ${profileName}`);
console.log(`  Description: ${profile.description}`);
console.log(`  Operating Accounts count: ${profile.operating_accounts.length}`);
console.log(`  Investment rules min_sweep: $${profile.investment_rules.min_sweep_amount_usdc}`);
console.log(`  Spending limits: single-tx $${profile.spending_limits.single_tx_human_gate_threshold_usdc}, daily $${profile.spending_limits.daily_hard_cap_usdc}`);

// 2. Verify account configuration
const payrollAcc = profile.operating_accounts.find(a => a.account_id === "acc_payroll");
if (!payrollAcc || !payrollAcc.exclude_from_waterfall_draws) {
  throw new Error("Payroll account must have exclude_from_waterfall_draws = true");
}
console.log("✓ Payroll protection rule verified (exclude_from_waterfall_draws = true)");

// 3. Verify agent registry
console.log("2. Verifying Agent Registry & Segregation of Duties...");
const witness = AGENT_REGISTRY.LedgerWitnessAgent;
if (witness.canSignTransactions) {
  throw new Error("Violation: LedgerWitnessAgent must NEVER have transaction signing ability!");
}
if (!witness.canWriteLedger) {
  throw new Error("Violation: LedgerWitnessAgent must have write ledger authority!");
}
console.log(`✓ LedgerWitnessAgent (ERC-8004 #${witness.erc8004Id}) segregation of duties verified.`);

const sentinel = AGENT_REGISTRY.TreasurySentinelAgent;
if (!sentinel.canSignTransactions || sentinel.canWriteLedger) {
  throw new Error("Violation: TreasurySentinelAgent must sign transactions but NOT directly write ledger!");
}
console.log(`✓ TreasurySentinelAgent (ERC-8004 #${sentinel.erc8004Id}) segregation of duties verified.`);

// 4. Verify network configuration
console.log("3. Verifying Arc L1 Network Configuration...");
const networkConfigPath = path.resolve(process.cwd(), "config/network.config.json");
if (!fs.existsSync(networkConfigPath)) {
  throw new Error("Missing network.config.json");
}
const networkConfig = JSON.parse(fs.readFileSync(networkConfigPath, "utf-8"));
if (!networkConfig.networks.arcTestnet || !networkConfig.networks.arcMainnet) {
  throw new Error("network.config.json must specify arcTestnet and arcMainnet");
}
console.log(`✓ Arc Network Config verified (Mainnet ChainID: ${networkConfig.networks.arcMainnet.chainId}, Testnet ChainID: ${networkConfig.networks.arcTestnet.chainId})`);

console.log("\n>>> ALL D0/D1 ARCHITECTURE & ENVIRONMENT CONFIG TESTS PASSED! <<<");
