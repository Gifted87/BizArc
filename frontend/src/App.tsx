/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { TreasuryProvider, useTreasury } from "./context/TreasuryContext";
import { Sidebar } from "./components/Sidebar";
import { TopHeader } from "./components/TopHeader";
import { OverviewView } from "./views/OverviewView";
import { ApprovalsView } from "./views/ApprovalsView";
import { AccountsView } from "./views/AccountsView";
import { LiabilitiesView } from "./views/LiabilitiesView";
import { LedgerView } from "./views/LedgerView";
import { AgentsView } from "./views/AgentsView";
import { OnboardingView } from "./views/OnboardingView";
import { TeamView } from "./views/TeamView";
import { IntegrationsView } from "./views/IntegrationsView";
import { ApiKeysView } from "./views/ApiKeysView";
import { VendorsView } from "./views/VendorsView";
import { LiabilityDetailModal } from "./components/LiabilityDetailModal";
import { AddLiabilityModal } from "./components/AddLiabilityModal";
import { SweepModal } from "./components/SweepModal";
import { FundModal } from "./components/FundModal";
import { TransferModal } from "./components/TransferModal";
import { AccountConfigModal } from "./components/AccountConfigModal";
import { AuthModal } from "./components/AuthModal";
import { TenantSwitcherModal } from "./components/TenantSwitcherModal";
import { AdHocDisbursalModal } from "./components/AdHocDisbursalModal";
import { DisputeModal } from "./components/DisputeModal";
import { TokenSwapModal } from "./components/TokenSwapModal";
import { Button, Banner } from "./primitives";
import type * as T from "./types";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, maxWidth: 640, margin: "40px auto", fontFamily: "var(--font-sans)" }}>
          <Banner tone="danger" title="An error occurred rendering this view">
            <p style={{ margin: "8px 0" }}>{this.state.error?.message || "Unknown error occurred"}</p>
            <Button onClick={() => window.location.reload()}>Reload Page</Button>
          </Banner>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { activeView, theme } = useTreasury();

  // Modals state
  const [inspectingLiability, setInspectingLiability] = useState<T.Liability | null>(null);
  const [showAddBillModal, setShowAddBillModal] = useState(false);
  const [showSweepModal, setShowSweepModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [fundingAccount, setFundingAccount] = useState<T.AccountDistribution | null>(null);
  const [configuringAccount, setConfiguringAccount] = useState<T.AccountDistribution | null | undefined>(undefined);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showTenantSwitcherModal, setShowTenantSwitcherModal] = useState(false);
  const [showAdHocDisbursalModal, setShowAdHocDisbursalModal] = useState(false);
  const [disputingLiability, setDisputingLiability] = useState<T.Liability | null | undefined>(undefined);
  const [showTokenSwapModal, setShowTokenSwapModal] = useState(false);

  return (
    <div className="bz" data-theme={theme} style={{ display: "flex", minHeight: "100vh" }}>
      {/* 260px Sticky Navigation Sidebar */}
      <Sidebar
        onOpenTenantSwitcher={() => setShowTenantSwitcherModal(true)}
        onOpenAuthModal={() => setShowAuthModal(true)}
      />

      {/* Main Viewport */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopHeader
          onOpenAddBill={() => setShowAddBillModal(true)}
          onOpenSweepModal={() => setShowSweepModal(true)}
          onOpenPayVendor={() => setShowAdHocDisbursalModal(true)}
          onOpenTokenSwap={() => setShowTokenSwapModal(true)}
          onOpenTenantSwitcher={() => setShowTenantSwitcherModal(true)}
        />

        <main style={{ flex: 1, padding: "24px 32px 64px", maxWidth: 1200, width: "100%", margin: "0 auto" }}>
          {activeView === "overview" && (
            <OverviewView
              onOpenLiability={l => setInspectingLiability(l)}
              onOpenSweepModal={() => setShowSweepModal(true)}
              onOpenFundModal={a => setFundingAccount(a)}
            />
          )}

          {activeView === "approvals" && <ApprovalsView />}

          {activeView === "accounts" && (
            <AccountsView
              onOpenFundModal={a => setFundingAccount(a)}
              onOpenTransferModal={() => setShowTransferModal(true)}
              onOpenCreateAccount={() => setConfiguringAccount(null)}
              onOpenConfigAccount={a => setConfiguringAccount(a)}
            />
          )}

          {activeView === "bills" && (
            <LiabilitiesView
              onOpenLiability={l => setInspectingLiability(l)}
              onOpenAddBill={() => setShowAddBillModal(true)}
              onOpenDispute={l => setDisputingLiability(l || null)}
            />
          )}

          {activeView === "vendors" && <VendorsView />}

          {activeView === "ledger" && <LedgerView />}

          {activeView === "agents" && <AgentsView />}

          {activeView === "integrations" && <IntegrationsView />}

          {activeView === "team" && <TeamView />}

          {activeView === "api-keys" && <ApiKeysView />}

          {activeView === "onboarding" && <OnboardingView />}
        </main>
      </div>

      {/* Interactive Modals */}
      {inspectingLiability && (
        <LiabilityDetailModal
          liability={inspectingLiability}
          onClose={() => setInspectingLiability(null)}
        />
      )}

      {showAddBillModal && (
        <AddLiabilityModal onClose={() => setShowAddBillModal(false)} />
      )}

      {showSweepModal && (
        <SweepModal onClose={() => setShowSweepModal(false)} />
      )}

      {fundingAccount && (
        <FundModal account={fundingAccount} onClose={() => setFundingAccount(null)} />
      )}

      {showTransferModal && (
        <TransferModal onClose={() => setShowTransferModal(false)} />
      )}

      {configuringAccount !== undefined && (
        <AccountConfigModal
          account={configuringAccount}
          onClose={() => setConfiguringAccount(undefined)}
          onSaved={() => setConfiguringAccount(undefined)}
        />
      )}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}

      {showTenantSwitcherModal && (
        <TenantSwitcherModal onClose={() => setShowTenantSwitcherModal(false)} />
      )}

      {showAdHocDisbursalModal && (
        <AdHocDisbursalModal onClose={() => setShowAdHocDisbursalModal(false)} />
      )}

      {disputingLiability !== undefined && (
        <DisputeModal
          liability={disputingLiability}
          onClose={() => setDisputingLiability(undefined)}
        />
      )}

      {showTokenSwapModal && (
        <TokenSwapModal onClose={() => setShowTokenSwapModal(false)} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TreasuryProvider>
        <AppContent />
      </TreasuryProvider>
    </ErrorBoundary>
  );
}
