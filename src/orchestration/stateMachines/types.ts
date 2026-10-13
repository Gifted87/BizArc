/**
 * Core Types and Interfaces for BizArc's 5 Reactive State Machines.
 * ================================================================
 * Defines the state transitions, triggers, and execution payload contracts
 * for the unbroken cognitive agent action chains.
 */

export type StateMachineName =
  | "ONBOARDING_STATE_MACHINE"
  | "LIABILITY_DISCOVERY_STATE_MACHINE"
  | "YIELD_REBALANCING_STATE_MACHINE"
  | "LIABILITY_DISBURSAL_STATE_MACHINE"
  | "AD_HOC_PAYMENT_STATE_MACHINE";

export interface StateMachineTransitionRecord {
  machineName: StateMachineName;
  instanceId: string;
  fromState: string;
  toState: string;
  trigger: string;
  actorAgentId?: number;
  actorAgentName?: string;
  timestamp: Date;
  details?: Record<string, any>;
}

export interface StateMachineExecutionResult<TData = any> {
  success: boolean;
  machineName: StateMachineName;
  instanceId: string;
  currentState: string;
  data?: TData;
  error?: string;
  unbrokenChainLog: StateMachineTransitionRecord[];
}
