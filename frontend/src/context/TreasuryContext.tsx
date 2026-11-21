import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import * as T from "../types";
import { treasuryApi } from "../api/treasuryApi";
import {
  ACCOUNTS as INITIAL_ACCOUNTS,
  LIABILITIES as INITIAL_LIABILITIES,
  SPR_PENDING_ALL as INITIAL_PENDING_SPRS,
  SPR_DECIDED as INITIAL_DECIDED_SPRS,
  JOURNAL as INITIAL_JOURNAL,
  JOURNAL_BROKEN,
  AUDIT as INITIAL_AUDIT,
  COMPANY,
  ME,
  MEMBERSHIPS,
  NOTIFICATIONS as INITIAL_NOTIFICATIONS,
  hex,
} from "../fixtures";
import { toMicro, fromMicro, sumUsdc } from "../money";

interface TreasuryContextType {
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  toggleTheme: () => void;
  activeView: string;
  setActiveView: (view: string) => void;

  company: T.Company;
  setCompany: (c: T.Company) => void;
  currentUser: T.Member;
  setCurrentUser: (m: T.Member) => void;
  switchUser: (m: T.Member) => void;
  switchCompany: (companyId: string) => Promise<void>;

  // Accounts & Balances
  accounts: T.AccountDistribution[];
  totalLiquid: string;
  totalInvested: string;
  totalEffective: string;
  safeToInvestTotal: string;

  // Liabilities
  liabilities: T.Liability[];
  addLiability: (liability: Omit<T.Liability, "liabilityId">) => void;
  updateLiabilityStatus: (id: string, status: T.LiabilityStatus) => void;
  payLiability: (id: string) => Promise<void>;
  disputeLiability: (id: string, reason?: string) => Promise<void>;

  // SPRS (Human Approval Gates)
  pendingSprs: T.PermissionRequest[];
  decidedSprs: T.PermissionRequest[];
  decideSpr: (
    requestId: string,
    decision: "APPROVE" | "CANCEL_WITH_INSTRUCTIONS",
    memo?: string,
    adminSignature?: string
  ) => Promise<void>;

  // Journal & Cryptographic Audit
  journal: T.JournalVoucher[];
  isChainTampered: boolean;
  toggleChainTamper: () => void;
  appendJournalVoucher: (voucher: Omit<T.JournalVoucher, "sequenceId" | "previousHash" | "currentHash">) => void;

  // Circuit Breaker
  circuitBreakerTripped: boolean;
  circuitBreakerReason?: string;
  tripCircuitBreaker: (reason: string) => Promise<void>;
  resetCircuitBreaker: () => Promise<void>;

  // Swarm & Yield Operations
  sweepExcessLiquidity: (accountId: string, amountUsdc: string) => Promise<void>;
  recallLiquidity: (accountId: string, amountUsdc: string) => Promise<void>;

  // Notifications & Audit Log
  notifications: T.AppNotification[];
  markNotificationRead: (id: string) => void;
  auditEvents: T.AuditEvent[];

  // Onboarding Wizard Session
  wizardStep: number;
  setWizardStep: (step: number) => void;
  wizardCompleted: number[];
  completeWizardStep: (step: number) => void;

  // Shortfalls & Live Backend Sync
  shortfalls: any[];
  hasShortfalls: boolean;
  isLiveBackend: boolean;
  refreshData: () => Promise<void>;
  runShortfallRebalance: () => Promise<void>;
  createAccount: (data: any) => Promise<void>;
  updateAccountPolicy: (accountId: string, data: any) => Promise<void>;
  fundAccount: (accountId: string, amountUsdc: string, method?: string) => Promise<void>;
}

const TreasuryContext = createContext<TreasuryContextType | null>(null);

export function TreasuryProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [activeView, setActiveView] = useState<string>("overview");

  const [company, setCompany] = useState<T.Company>(COMPANY);
  const [currentUser, setCurrentUser] = useState<T.Member>(ME);

  const [accounts, setAccounts] = useState<T.AccountDistribution[]>(INITIAL_ACCOUNTS);
  const [liabilities, setLiabilities] = useState<T.Liability[]>(INITIAL_LIABILITIES);
  const [pendingSprs, setPendingSprs] = useState<T.PermissionRequest[]>(INITIAL_PENDING_SPRS);
  const [decidedSprs, setDecidedSprs] = useState<T.PermissionRequest[]>(INITIAL_DECIDED_SPRS);
  const [journal, setJournal] = useState<T.JournalVoucher[]>(INITIAL_JOURNAL);
  const [isChainTampered, setIsChainTampered] = useState(false);

  const [circuitBreakerTripped, setCircuitBreakerTripped] = useState(false);
  const [circuitBreakerReason, setCircuitBreakerReason] = useState<string>();

  const [notifications, setNotifications] = useState<T.AppNotification[]>(INITIAL_NOTIFICATIONS);
  const [auditEvents, setAuditEvents] = useState<T.AuditEvent[]>(INITIAL_AUDIT);

  const [wizardStep, setWizardStep] = useState(1);
  const [wizardCompleted, setWizardCompleted] = useState<number[]>([1, 2]);

  const [shortfalls, setShortfalls] = useState<any[]>([]);
  const [isLiveBackend, setIsLiveBackend] = useState<boolean>(false);

  const refreshData = useCallback(async () => {
    try {
      const [distRes, sfRes] = await Promise.all([
        treasuryApi.getDistribution(),
        treasuryApi.getShortfalls(),
      ]);

      if (distRes.success && distRes.data) {
        setIsLiveBackend(true);
        if (Array.isArray(distRes.data.accounts) && distRes.data.accounts.length > 0) {
          setAccounts(distRes.data.accounts);
        }
      }
      if (sfRes.success && Array.isArray(sfRes.data)) {
        setShortfalls(sfRes.data);
      }
    } catch {
      // Keep running smoothly on local fixtures
    }
  }, []);

  useEffect(() => {
    refreshData();
    const unsubscribe = treasuryApi.subscribeToEvents((event) => {
      if (
        event.type === "balance:mutated" ||
        event.type === "yield:swept" ||
        event.type === "yield:recalled"
      ) {
        refreshData();
      } else if (event.type === "circuit_breaker:tripped") {
        setCircuitBreakerTripped(true);
        setCircuitBreakerReason(event.data?.reason || "Autonomous operations halted by system policy.");
      } else if (event.type === "circuit_breaker:disarmed") {
        setCircuitBreakerTripped(false);
        setCircuitBreakerReason(undefined);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [refreshData]);

  const runShortfallRebalance = async () => {
    const res = await treasuryApi.runShortfallRebalance();
    if (!res.success) {
      throw new Error(res.error || "Failed to execute shortfall rebalance");
    }
    await refreshData();
  };

  const createAccount = async (data: any) => {
    const res = await treasuryApi.createAccount(data);
    if (!res.success) {
      throw new Error(res.error || "Failed to create account");
    }
    await refreshData();
  };

  const updateAccountPolicy = async (accountId: string, data: any) => {
    const res = await treasuryApi.updateAccount(accountId, data);
    if (!res.success) {
      throw new Error(res.error || "Failed to update account policy");
    }
    await refreshData();
  };

  // Sync theme to root html element
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => setTheme(prev => (prev === "dark" ? "light" : "dark"));

  // Computed totals
  const totalLiquid = sumUsdc(accounts.map(a => a.liquidUsdc));
  const totalInvested = sumUsdc(accounts.map(a => a.investedUsyc));
  const totalEffective = sumUsdc(accounts.map(a => a.totalEffectiveUsdc));
  const safeToInvestTotal = sumUsdc(accounts.map(a => a.safeToInvestUsdc));

  const appendJournalVoucher = (
    voucherData: Omit<T.JournalVoucher, "sequenceId" | "previousHash" | "currentHash">
  ) => {
    setJournal(prev => {
      const last = prev[prev.length - 1];
      const seq = last ? last.sequenceId + 1 : 1;
      const prevHash = last ? last.currentHash : ("0x" + "0".repeat(64));
      const curHash = hex(`journal-${seq}-${prevHash}-${voucherData.documentRef}`);
      const newVoucher: T.JournalVoucher = {
        ...voucherData,
        sequenceId: seq,
        previousHash: prevHash,
        currentHash: curHash,
      };
      return [...prev, newVoucher];
    });
  };

  const addLiability = (liabilityData: Omit<T.Liability, "liabilityId">) => {
    const id = `0b6f1c2e-5a7d-4c1e-9d3b-${String(liabilities.length + 1).padStart(12, "0")}`;
    const newLiab: T.Liability = {
      ...liabilityData,
      liabilityId: id,
    };
    setLiabilities(prev => [newLiab, ...prev]);

    // Recalculate committed liabilities on target account
    setAccounts(prev =>
      prev.map(a => {
        if (a.accountId === liabilityData.accountId) {
          const newCommitted = fromMicro(toMicro(a.committedLiabilities30dUsdc) + toMicro(liabilityData.amountUsdc));
          return {
            ...a,
            committedLiabilities30dUsdc: newCommitted,
          };
        }
        return a;
      })
    );

    // Add notification
    setNotifications(prev => [
      {
        id: `notif-${Date.now()}`,
        kind: "BILL_ADDED",
        tone: "info",
        title: `New Bill Added: ${liabilityData.title}`,
        body: `${liabilityData.amountUsdc} USDC due on ${new Date(liabilityData.dueDate).toLocaleDateString()}`,
        createdAt: new Date().toISOString(),
        read: false,
      },
      ...prev,
    ]);
  };

  const switchCompany = async (companyId: string) => {
    treasuryApi.setCompanyId(companyId);
    const m = MEMBERSHIPS.find(mem => mem.companyId === companyId);
    if (m) {
      setCompany(prev => ({
        ...prev,
        companyId: m.companyId,
        name: m.companyName,
        network: m.network,
      }));
    }
    await refreshData();
  };

  const disputeLiability = async (id: string, reason = "Disputed by corporate officer") => {
    try {
      await treasuryApi.disputeLiability(id, reason);
    } catch (e) {
      console.warn("Backend dispute failed, updating local state:", e);
    }
    updateLiabilityStatus(id, "FROZEN");
    const l = liabilities.find(item => item.liabilityId === id);
    appendJournalVoucher({
      timestamp: new Date().toISOString(),
      accountId: l?.accountId || "acc_primary",
      actionType: "INVOICE_DISPUTED",
      debitAccount: l?.vendorId || "vendor_disputed",
      creditAccount: `${l?.accountId || "acc_primary"}:disputed`,
      amountUsdc: l?.amountUsdc || "0.000000",
      documentRef: `DISPUTE-${id.slice(-6)}`,
      memo: reason,
    });
  };

  const updateLiabilityStatus = (id: string, status: T.LiabilityStatus) => {
    setLiabilities(prev => prev.map(l => (l.liabilityId === id ? { ...l, status } : l)));
  };

  const payLiability = async (id: string) => {
    const l = liabilities.find(x => x.liabilityId === id);
    if (!l) return;

    if (circuitBreakerTripped) {
      throw new Error("Emergency stop is active. Autonomous and scheduled disbursals are halted.");
    }

    const acct = accounts.find(a => a.accountId === l.accountId);
    if (!acct) return;

    const liabMicro = toMicro(l.amountUsdc);
    const liquidMicro = toMicro(acct.liquidUsdc);

    if (liquidMicro < liabMicro) {
      throw new Error(
        `Insufficient liquid cash in ${acct.name}. Required: ${l.amountUsdc} USDC, Available: ${acct.liquidUsdc} USDC.`
      );
    }

    // Deduct cash from account
    const newLiquid = fromMicro(liquidMicro - liabMicro);
    const newTotal = fromMicro(toMicro(newLiquid) + toMicro(acct.investedUsyc));
    const newFree = toMicro(newLiquid) > toMicro(acct.protectedReserveUsdc)
      ? fromMicro(toMicro(newLiquid) - toMicro(acct.protectedReserveUsdc))
      : "0.000000";

    setAccounts(prev =>
      prev.map(a =>
        a.accountId === acct.accountId
          ? {
            ...a,
            liquidUsdc: newLiquid,
            totalEffectiveUsdc: newTotal,
            freeCapitalUsdc: newFree,
            committedLiabilities30dUsdc:
              toMicro(a.committedLiabilities30dUsdc) >= liabMicro
                ? fromMicro(toMicro(a.committedLiabilities30dUsdc) - liabMicro)
                : "0.000000",
          }
          : a
      )
    );

    // Update liability to SETTLED
    setLiabilities(prev => prev.map(item => (item.liabilityId === id ? { ...item, status: "SETTLED" } : item)));

    try {
      await treasuryApi.payLiability(id);
    } catch (err: any) {
      console.warn("API payLiability notice:", err.message);
    }

    // Record in journal
    const tx = hex(`tx-disburse-${id}`);
    appendJournalVoucher({
      timestamp: new Date().toISOString(),
      accountId: acct.accountId,
      actionType: "DISBURSEMENT",
      debitAccount: `${acct.accountId}:liquid`,
      creditAccount: l.vendorId,
      amountUsdc: l.amountUsdc,
      documentRef: `SETTLE-${l.title.slice(0, 10)}`,
      txHash: tx,
    });

    // Audit log
    setAuditEvents(prev => [
      {
        logId: String(Date.now()).slice(-4),
        accountId: acct.accountId,
        actionType: "DISBURSEMENT",
        amountUsdc: l.amountUsdc,
        isAutonomous: false,
        txHash: tx,
        reason: `Settled bill "${l.title}" via ${l.rail || "Disbursal Vault"}.`,
        createdAt: new Date().toISOString(),
        actorAgent: "DisbursalRouterAgent",
      },
      ...prev,
    ]);
  };



  const decideSpr = async (
    requestId: string,
    decision: "APPROVE" | "CANCEL_WITH_INSTRUCTIONS",
    memo?: string,
    adminSignature?: string
  ) => {
    const spr = pendingSprs.find(s => s.requestId === requestId);
    if (!spr) return;

    if (decision === "APPROVE") {
      // Execute account balance mutations if affected
      if (spr.affectedAccounts.length > 0) {
        setAccounts(prev =>
          prev.map(a => {
            const imp = spr.affectedAccounts.find(x => x.accountId === a.accountId);
            if (imp) {
              const postLiquid = imp.postTxLiquidBalance;
              const postInvested = imp.postTxInvestedUsyc;
              const postTotal = fromMicro(toMicro(postLiquid) + toMicro(postInvested));
              return {
                ...a,
                liquidUsdc: postLiquid,
                investedUsyc: postInvested,
                totalEffectiveUsdc: postTotal,
              };
            }
            return a;
          })
        );
      }

      // Add to decided SPRS
      const updatedSpr: T.PermissionRequest = {
        ...spr,
        status: "APPROVED",
        decidedAt: new Date().toISOString(),
        adminInstructions: adminSignature ? `Signed by Amara Okafor (${adminSignature.slice(0, 14)}…)` : undefined,
      };

      setPendingSprs(prev => prev.filter(s => s.requestId !== requestId));
      setDecidedSprs(prev => [updatedSpr, ...prev]);

      // Journal entry
      const tx = hex(`tx-spr-approved-${requestId}`);
      appendJournalVoucher({
        timestamp: new Date().toISOString(),
        accountId: spr.affectedAccounts[0]?.accountId || "acc_treasury",
        actionType: spr.action,
        debitAccount: "SPRS_CLEARANCE",
        creditAccount: spr.targetRecipient?.vendorId || "SYSTEM",
        amountUsdc: spr.amountUsdc,
        documentRef: spr.associatedRecords.invoiceDocumentId || spr.requestId,
        txHash: tx,
      });

      // Audit log
      setAuditEvents(prev => [
        {
          logId: String(Date.now()).slice(-4),
          accountId: spr.affectedAccounts[0]?.accountId || "acc_treasury",
          actionType: spr.action,
          amountUsdc: spr.amountUsdc,
          isAutonomous: false,
          txHash: tx,
          reason: `Human approved SPRS #${requestId}: ${spr.reason}. Signed by Amara Okafor.`,
          createdAt: new Date().toISOString(),
          actorAgent: "PolicyComplianceAgent",
        },
        ...prev,
      ]);
    } else {
      // Cancel with instructions
      const updatedSpr: T.PermissionRequest = {
        ...spr,
        status: "CANCELLED_WITH_INSTRUCTIONS",
        decidedAt: new Date().toISOString(),
        adminInstructions: memo,
      };

      setPendingSprs(prev => prev.filter(s => s.requestId !== requestId));
      setDecidedSprs(prev => [updatedSpr, ...prev]);

      // Audit log
      setAuditEvents(prev => [
        {
          logId: String(Date.now()).slice(-4),
          accountId: spr.affectedAccounts[0]?.accountId || "acc_treasury",
          actionType: "SPRS_CANCELLED",
          amountUsdc: spr.amountUsdc,
          isAutonomous: false,
          reason: `Cancelled by human with instructions: "${memo}"`,
          createdAt: new Date().toISOString(),
          actorAgent: "PolicyComplianceAgent",
        },
        ...prev,
      ]);
    }

    try {
      await treasuryApi.decideSpr(requestId, decision, memo, adminSignature);
    } catch (apiErr: any) {
      console.warn("API decideSpr notice:", apiErr.message);
    }
  };

  const toggleChainTamper = () => {
    setIsChainTampered(prev => {
      const next = !prev;
      if (next) {
        setJournal(JOURNAL_BROKEN);
      } else {
        setJournal(INITIAL_JOURNAL);
      }
      return next;
    });
  };

  const tripCircuitBreaker = async (reason: string) => {
    setCircuitBreakerTripped(true);
    setCircuitBreakerReason(reason);
    treasuryApi.tripCircuitBreaker(reason).catch(() => { });

    setAuditEvents(prev => [
      {
        logId: String(Date.now()).slice(-4),
        accountId: "all",
        actionType: "CIRCUIT_BREAKER_TRIPPED",
        amountUsdc: "0.000000",
        isAutonomous: false,
        reason: `Emergency stop initiated: ${reason}`,
        createdAt: new Date().toISOString(),
        actorAgent: "LedgerWitnessAgent",
      },
      ...prev,
    ]);

    setNotifications(prev => [
      {
        id: `notif-${Date.now()}`,
        kind: "CIRCUIT_BREAKER",
        tone: "danger",
        title: "Emergency Stop Activated",
        body: `All autonomous operations paused: ${reason}`,
        createdAt: new Date().toISOString(),
        read: false,
      },
      ...prev,
    ]);
  };



  const resetCircuitBreaker = async () => {
    setCircuitBreakerTripped(false);
    setCircuitBreakerReason(undefined);
    treasuryApi.disarmCircuitBreaker("CLEAR-DISARM-EMERGENCY").catch(() => { });

    setAuditEvents(prev => [
      {
        logId: String(Date.now()).slice(-4),
        accountId: "all",
        actionType: "CIRCUIT_BREAKER_RESET",
        amountUsdc: "0.000000",
        isAutonomous: false,
        reason: "Emergency stop cleared. Swarm resumed.",
        createdAt: new Date().toISOString(),
        actorAgent: "PolicyComplianceAgent",
      },
      ...prev,
    ]);
  };



  const sweepExcessLiquidity = async (accountId: string, amountUsdc: string) => {
    if (circuitBreakerTripped) {
      throw new Error("Cannot sweep: Emergency stop is active.");
    }

    const acct = accounts.find(a => a.accountId === accountId);
    if (!acct) return;

    const sweepMicro = toMicro(amountUsdc);
    const liquidMicro = toMicro(acct.liquidUsdc);

    if (liquidMicro < sweepMicro) {
      throw new Error(`Cannot sweep ${amountUsdc}: exceeds liquid cash ${acct.liquidUsdc} USDC.`);
    }

    const newLiquid = fromMicro(liquidMicro - sweepMicro);
    const newInvested = fromMicro(toMicro(acct.investedUsyc) + sweepMicro);
    const newTotal = fromMicro(toMicro(newLiquid) + toMicro(newInvested));
    const newSafe = toMicro(acct.safeToInvestUsdc) > sweepMicro
      ? fromMicro(toMicro(acct.safeToInvestUsdc) - sweepMicro)
      : "0.000000";

    setAccounts(prev =>
      prev.map(a =>
        a.accountId === accountId
          ? {
            ...a,
            liquidUsdc: newLiquid,
            investedUsyc: newInvested,
            totalEffectiveUsdc: newTotal,
            safeToInvestUsdc: newSafe,
          }
          : a
      )
    );

    try {
      await treasuryApi.executeSweep(accountId, amountUsdc);
    } catch (err: any) {
      console.warn("API executeSweep notice:", err.message);
    }

    const tx = hex(`tx-sweep-${Date.now()}`);
    appendJournalVoucher({
      timestamp: new Date().toISOString(),
      accountId,
      actionType: "SWEEP_TO_YIELD",
      debitAccount: `${accountId}:liquid`,
      creditAccount: `${accountId}:invested`,
      amountUsdc,
      documentRef: `SWP-${Date.now().toString().slice(-4)}`,
      txHash: tx,
    });

    setAuditEvents(prev => [
      {
        logId: String(Date.now()).slice(-4),
        accountId,
        actionType: "SWEEP_TO_YIELD",
        amountUsdc,
        isAutonomous: true,
        txHash: tx,
        reason: `TreasurySentinel swept ${amountUsdc} USDC idle surplus into tokenized USYC vault.`,
        createdAt: new Date().toISOString(),
        actorAgent: "TreasurySentinelAgent",
      },
      ...prev,
    ]);
  };



  const recallLiquidity = async (accountId: string, amountUsdc: string) => {
    const acct = accounts.find(a => a.accountId === accountId);
    if (!acct) return;

    const recallMicro = toMicro(amountUsdc);
    const investedMicro = toMicro(acct.investedUsyc);

    if (investedMicro < recallMicro) {
      throw new Error(`Cannot recall ${amountUsdc}: exceeds invested USYC ${acct.investedUsyc}.`);
    }

    const newInvested = fromMicro(investedMicro - recallMicro);
    const newLiquid = fromMicro(toMicro(acct.liquidUsdc) + recallMicro);
    const newTotal = fromMicro(toMicro(newLiquid) + toMicro(newInvested));

    setAccounts(prev =>
      prev.map(a =>
        a.accountId === accountId
          ? {
            ...a,
            liquidUsdc: newLiquid,
            investedUsyc: newInvested,
            totalEffectiveUsdc: newTotal,
          }
          : a
      )
    );

    try {
      await treasuryApi.executeRecall(accountId, amountUsdc);
    } catch (err: any) {
      console.warn("API executeRecall notice:", err.message);
    }

    const tx = hex(`tx-recall-${Date.now()}`);
    appendJournalVoucher({
      timestamp: new Date().toISOString(),
      accountId,
      actionType: "RECALL_FROM_YIELD",
      debitAccount: `${accountId}:invested`,
      creditAccount: `${accountId}:liquid`,
      amountUsdc,
      documentRef: `RCL-${Date.now().toString().slice(-4)}`,
      txHash: tx,
    });

    setAuditEvents(prev => [
      {
        logId: String(Date.now()).slice(-4),
        accountId,
        actionType: "RECALL_FROM_YIELD",
        amountUsdc,
        isAutonomous: true,
        txHash: tx,
        reason: `Sentinel recalled ${amountUsdc} USDC from USYC vault to cover impending commitments.`,
        createdAt: new Date().toISOString(),
        actorAgent: "TreasurySentinelAgent",
      },
      ...prev,
    ]);
  };



  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
  };

  const completeWizardStep = (step: number) => {
    setWizardCompleted(prev => Array.from(new Set([...prev, step])));
    if (step < 6) {
      setWizardStep(step + 1);
    }
  };

  const fundAccount = async (accountId: string, amountUsdc: string, method = "CRYPTO") => {
    const amtNum = parseFloat(amountUsdc) || 0;
    if (amtNum <= 0) throw new Error("Invalid deposit amount.");

    const acct = accounts.find(a => a.accountId === accountId);
    if (!acct) return;

    try {
      if (method === "WIRE" || method === "ACH") {
        await treasuryApi.reconcileFiatDeposit({
          targetAccountId: accountId,
          amountUsdc: amtNum,
          wireReference: `FIAT-DEP-${Date.now()}`,
          sourceBank: "Commercial Settlement Clearing Bank",
        });
      } else {
        await treasuryApi.fundAccount(accountId, {
          method: "CRYPTO",
          amountUsdc: amtNum,
          sourceChain: "Arc",
          sourceToken: "USDC",
        });
      }
    } catch (err: any) {
      console.warn("API fundAccount warning:", err.message);
    }

    const depMicro = toMicro(amountUsdc);
    const newLiquid = fromMicro(toMicro(acct.liquidUsdc) + depMicro);
    const newTotal = fromMicro(toMicro(newLiquid) + toMicro(acct.investedUsyc));
    const newSafe = fromMicro(toMicro(acct.safeToInvestUsdc) + depMicro);

    setAccounts(prev =>
      prev.map(a =>
        a.accountId === accountId
          ? {
            ...a,
            liquidUsdc: newLiquid,
            totalEffectiveUsdc: newTotal,
            safeToInvestUsdc: newSafe,
          }
          : a
      )
    );

    const tx = hex(`tx-fund-${Date.now()}`);
    appendJournalVoucher({
      timestamp: new Date().toISOString(),
      accountId,
      actionType: "DEPOSIT",
      debitAccount: `${accountId}:liquid`,
      creditAccount: `external:${method.toLowerCase()}`,
      amountUsdc,
      documentRef: `DEP-${Date.now().toString().slice(-4)}`,
      txHash: tx,
    });

    setAuditEvents(prev => [
      {
        logId: String(Date.now()).slice(-4),
        accountId,
        actionType: "DEPOSIT",
        amountUsdc,
        isAutonomous: false,
        txHash: tx,
        reason: `Manual treasury deposit of ${amountUsdc} USDC credited via ${method}.`,
        createdAt: new Date().toISOString(),
        actorAgent: "TreasuryAdmin",
      },
      ...prev,
    ]);
  };



  return (
    <TreasuryContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        activeView,
        setActiveView,
        company,
        setCompany,
        currentUser,
        setCurrentUser,
        switchUser: setCurrentUser,
        switchCompany,
        accounts,
        totalLiquid,
        totalInvested,
        totalEffective,
        safeToInvestTotal,
        liabilities,
        addLiability,
        updateLiabilityStatus,
        payLiability,
        disputeLiability,
        pendingSprs,
        decidedSprs,
        decideSpr,
        journal,
        isChainTampered,
        toggleChainTamper,
        appendJournalVoucher,
        circuitBreakerTripped,
        circuitBreakerReason,
        tripCircuitBreaker,
        resetCircuitBreaker,
        sweepExcessLiquidity,
        recallLiquidity,
        notifications,
        markNotificationRead,
        auditEvents,
        wizardStep,
        setWizardStep,
        wizardCompleted,
        completeWizardStep,
        shortfalls,
        hasShortfalls: shortfalls.length > 0,
        isLiveBackend,
        refreshData,
        runShortfallRebalance,
        createAccount,
        updateAccountPolicy,
        fundAccount,
      }}
    >
      {children}
    </TreasuryContext.Provider>
  );
}

export function useTreasury() {
  const context = useContext(TreasuryContext);
  if (!context) {
    throw new Error("useTreasury must be used within a TreasuryProvider");
  }
  return context;
}
