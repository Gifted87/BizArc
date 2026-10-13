import { OnboardingWizardService } from "../../src/services/onboardingWizardService.js";
import { AccountManagementService } from "../../src/services/accountManagementService.js";
import { LiabilityManagementService } from "../../src/services/liabilityManagementService.js";
import { MasterJournalRepo } from "../../src/database/repos/masterJournalRepo.js";
import { WizardSessionRepo } from "../../src/database/repos/wizardSessionRepo.js";
import { DbClient } from "../../src/database/dbClient.js";

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  };

  const companyId = getArg("--companyId");
  const otherCompanyId = getArg("--otherCompanyId");
  const accountId = getArg("--accountId") || `${companyId}_ops`;
  const accountName = getArg("--accountName") || "Operations";
  const floorUsdc = parseFloat(getArg("--floor") || "500.0");
  const liabilityTitle = getArg("--liabilityTitle") || "Cloud Computing";
  const amountUsdc = parseFloat(getArg("--amount") || "250.0");
  const preferredPaymentRail = getArg("--rail") || "DISBURSAL_VAULT";

  if (!companyId) {
    console.error(JSON.stringify({ success: false, error: "Missing --companyId" }));
    process.exit(1);
  }

  try {
    const wizardService = new OnboardingWizardService();
    const accountService = new AccountManagementService();
    const liabilityService = new LiabilityManagementService();

    // 1. Create Session
    const session = await wizardService.createSession({ companyId, entryPath: "MANUAL" });

    // 2. Step 1 Draft
    await wizardService.saveStepDraft(session.sessionId, 1, {
      companyName: `${companyId} Enterprise`,
      jurisdiction: "US-DE",
    });

    // 3. Step 4 Draft (Accounts)
    await wizardService.saveStepDraft(session.sessionId, 4, {
      accounts: [
        {
          accountId,
          name: accountName,
          role: "OPEX_DEV",
          minOperatingFloorUsdc: floorUsdc,
        },
      ],
    });

    // 4. Step 5 Draft (Liabilities)
    await wizardService.saveStepDraft(session.sessionId, 5, {
      liabilities: [
        {
          title: liabilityTitle,
          accountId,
          vendorId: `vnd_${companyId}`,
          amountUsdc,
          payoutAddress: "0x1111111111111111111111111111111111111111",
          preferredPaymentRail: preferredPaymentRail as any,
        },
      ],
    });

    // 5. Activate Organization
    await wizardService.activateOrganization(session.sessionId);

    // 6. Post a tenant-scoped ledger entry
    await MasterJournalRepo.appendEntry({
      company_id: companyId,
      account_id: accountId,
      action_type: "ONBOARDING_INITIALIZATION",
      debit_account: accountId,
      credit_account: "0xTREASURY_RESERVE",
      amount_usdc: floorUsdc,
      document_ref: `0xhash_${companyId}`,
    });

    // 7. Verify Isolation against otherCompanyId
    let crossTenantPollutionDetected = false;
    let foreignDraftAccessed = false;

    if (otherCompanyId) {
      // Check if this tenant can access otherCompanyId's session
      const otherSessions = await DbClient.query(
        "SELECT session_id FROM onboarding_wizard_sessions WHERE company_id = $1;",
        [otherCompanyId]
      );
      // If we attempt to read otherCompany's session using wizardService or verify isolation
      const myAccounts = await accountService.listAccounts(companyId);
      const containsOtherAccounts = myAccounts.some((a) => a.company_id === otherCompanyId);

      const myLiabilities = await liabilityService.listLiabilities(companyId);
      const containsOtherLiabilities = myLiabilities.some((l) => l.company_id === otherCompanyId);

      const myJournals = await MasterJournalRepo.getEntriesByCompany(companyId);
      const containsOtherJournals = myJournals.some((j) => j.company_id === otherCompanyId);

      if (containsOtherAccounts || containsOtherLiabilities || containsOtherJournals) {
        crossTenantPollutionDetected = true;
      }
    }

    const accounts = await accountService.listAccounts(companyId);
    const liabilities = await liabilityService.listLiabilities(companyId);
    const journals = await MasterJournalRepo.getEntriesByCompany(companyId);

    const result = {
      success: true,
      pid: process.pid,
      companyId,
      accountsCount: accounts.length,
      liabilitiesCount: liabilities.length,
      journalsCount: journals.length,
      crossTenantPollutionDetected,
      accountIds: accounts.map((a) => a.account_id),
      liabilityTitles: liabilities.map((l) => l.title),
    };

    console.log(JSON.stringify(result));
    await DbClient.closePool();
    process.exit(0);
  } catch (err: any) {
    console.error(JSON.stringify({ success: false, pid: process.pid, error: err.message, stack: err.stack }));
    await DbClient.closePool();
    process.exit(1);
  }
}

main();
