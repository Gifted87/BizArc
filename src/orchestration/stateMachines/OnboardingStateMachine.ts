/**
 * Machine 1: Onboarding & Tenant Genesis Reactive State Machine.
 * ================================================================
 * Governs the unbroken transition from initial signup / workspace OAuth
 * to full corporate activation and dashboard readiness.
 */

import { OnboardingWizardService, WizardSession } from "../../services/onboardingWizardService.js";
import { IntakeDiscoveryAgent } from "../../services/intakeDiscoveryAgent.js";
import { OnboardingLlmAgent } from "../../agents/onboardingLlmAgent.js";
import { StateMachineExecutionResult, StateMachineTransitionRecord } from "./types.js";

export type OnboardingState =
  | "UNINITIALIZED"
  | "DISCOVERY_INGESTION"
  | "DRAFT_SYNTHESIS"
  | "QA_MATH_DERIVATION"
  | "ACCOUNTS_CONFIGURED"
  | "LIABILITIES_ATTACHED"
  | "ATOMIC_ACTIVATION_PENDING"
  | "COMPLETED_OPERATIONAL"
  | "FAILED";

export interface OnboardingInitParams {
  companyId: string;
  entryPath: "MANUAL" | "CONNECTED_WORKSPACE" | "CONNECTED_ERP";
  companyName?: string;
  adminEmail?: string;
  sourceCredentials?: Record<string, any>;
}

export class OnboardingStateMachine {
  private wizardService: OnboardingWizardService;
  private onboardingAgent: OnboardingLlmAgent;
  private transitionLog: StateMachineTransitionRecord[] = [];

  constructor(wizardService?: OnboardingWizardService, onboardingAgent?: OnboardingLlmAgent) {
    this.wizardService = wizardService ?? new OnboardingWizardService();
    this.onboardingAgent = onboardingAgent ?? new OnboardingLlmAgent();
  }

  private logTransition(instanceId: string, from: string, to: string, trigger: string, details?: any) {
    this.transitionLog.push({
      machineName: "ONBOARDING_STATE_MACHINE",
      instanceId,
      fromState: from,
      toState: to,
      trigger,
      actorAgentId: 106,
      actorAgentName: "OnboardingLlmAgent",
      timestamp: new Date(),
      details,
    });
  }

  /**
   * Unbroken Chain Execution: Initializes session and synthesizes draft if connected source provided.
   */
  public async startOnboarding(params: OnboardingInitParams): Promise<StateMachineExecutionResult<WizardSession>> {
    const session = await this.wizardService.createSession({
      companyId: params.companyId,
      entryPath: params.entryPath,
      initialDraft: {
        step1_profile: {
          companyName: params.companyName || params.companyId,
          adminEmail: params.adminEmail || `admin@${params.companyId}.internal`,
        },
      },
    });

    this.logTransition(session.sessionId, "UNINITIALIZED", "DISCOVERY_INGESTION", "SIGNUP_TRIGGER", { entryPath: params.entryPath });

    if (params.entryPath === "CONNECTED_WORKSPACE" || params.entryPath === "CONNECTED_ERP") {
      try {
        const discoveryAgent = new IntakeDiscoveryAgent({ companyId: params.companyId });
        const synthesis = await discoveryAgent.synthesizeAllSources();

        this.logTransition(session.sessionId, "DISCOVERY_INGESTION", "DRAFT_SYNTHESIS", "DATA_EXTRACTED", {
          discoveredCostCenters: synthesis.discoveredCostCenters.length,
          discoveredLiabilities: synthesis.discoveredLiabilities.length,
        });

        // Agent synthesizes pre-fill draft
        const prefilledSession = await this.wizardService.prefillDraftFromConnectedSource(session.sessionId, {
          companyName: params.companyName || params.companyId,
          costCenters: synthesis.discoveredCostCenters,
          invoices: synthesis.discoveredLiabilities,
        });

        return {
          success: true,
          machineName: "ONBOARDING_STATE_MACHINE",
          instanceId: session.sessionId,
          currentState: "DRAFT_SYNTHESIS",
          data: prefilledSession,
          unbrokenChainLog: [...this.transitionLog],
        };
      } catch (err: any) {
        // Fall back to manual draft if external connector is not configured
        console.warn(`[OnboardingStateMachine] External discovery note: ${err.message}. Progressing to manual intake.`);
      }
    }

    return {
      success: true,
      machineName: "ONBOARDING_STATE_MACHINE",
      instanceId: session.sessionId,
      currentState: "QA_MATH_DERIVATION",
      data: session,
      unbrokenChainLog: [...this.transitionLog],
    };
  }

  /**
   * Transitions through Math Q&A, Account Setup, and Liability Attachment.
   */
  public async submitStep(
    sessionId: string,
    step: number,
    payload: Record<string, any>
  ): Promise<StateMachineExecutionResult<WizardSession>> {
    const updated = await this.wizardService.saveStepDraft(sessionId, step, payload);
    const stateMap: Record<number, OnboardingState> = {
      1: "DISCOVERY_INGESTION",
      2: "QA_MATH_DERIVATION",
      3: "QA_MATH_DERIVATION",
      4: "ACCOUNTS_CONFIGURED",
      5: "LIABILITIES_ATTACHED",
      6: "ATOMIC_ACTIVATION_PENDING",
    };

    const nextState = stateMap[step] || "DRAFT_SYNTHESIS";
    this.logTransition(sessionId, `STEP_${step - 1}`, nextState, `SUBMIT_STEP_${step}`, { step });

    return {
      success: true,
      machineName: "ONBOARDING_STATE_MACHINE",
      instanceId: sessionId,
      currentState: nextState,
      data: updated,
      unbrokenChainLog: [...this.transitionLog],
    };
  }

  /**
   * Final atomic commitment: provisions database tables, locks vendor master, mints Genesis block.
   */
  public async activateOrganization(
    sessionId: string
  ): Promise<StateMachineExecutionResult<{ companyId: string; dashboardUrl: string }>> {
    this.logTransition(sessionId, "ATOMIC_ACTIVATION_PENDING", "COMPLETED_OPERATIONAL", "ATOMIC_ACTIVATION_TRIGGER");
    const activation = await this.wizardService.activateOrganization(sessionId);

    return {
      success: true,
      machineName: "ONBOARDING_STATE_MACHINE",
      instanceId: sessionId,
      currentState: "COMPLETED_OPERATIONAL",
      data: activation,
      unbrokenChainLog: [...this.transitionLog],
    };
  }
}
