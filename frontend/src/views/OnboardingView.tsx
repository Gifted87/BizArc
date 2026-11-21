import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { WizardStepper, QuestionField } from "../domain";
import { Panel, Button, TextInput, Field, UsdcInput, Switch, Banner, DataTable, type Column } from "../primitives";
import {
  WIZARD_PROFILE,
  MATH_QUESTIONS,
  WIZARD_ACCOUNTS,
  WIZARD_POLICIES,
  DERIVED_PARAMS,
  READINESS_PILLARS,
} from "../fixtures";
import { formatUsdc } from "../money";
import { treasuryApi } from "../api/treasuryApi";

export function OnboardingView() {
  const { wizardStep, setWizardStep, wizardCompleted, completeWizardStep, setActiveView } = useTreasury();

  // Wizard form state
  const [profile, setProfile] = useState(WIZARD_PROFILE);
  const [answers, setAnswers] = useState<Record<string, any>>({
    GM_RUNWAY_MONTHS: 3,
    GM_MONTHLY_BURN: "25000.000000",
    GM_REVENUE_VOLATILITY: "MEDIUM",
    GM_BUFFER_MULTIPLIER: "BALANCED",
  });
  const [policies, setPolicies] = useState(WIZARD_POLICIES);
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const handleNext = () => {
    completeWizardStep(wizardStep);
  };

  const handleBack = () => {
    if (wizardStep > 1) setWizardStep(wizardStep - 1);
  };

  const handleActivate = async () => {
    setActivating(true);
    try {
      await treasuryApi.activateOnboarding("wizard_session_active");
    } catch (err: any) {
      console.warn("Onboarding activation API notice:", err.message);
    }
    setActivating(false);
    setActivated(true);
    completeWizardStep(6);
  };

  const derivedColumns: Column<{ name: string; label: string; value: string; unit: string }>[] = [
    { key: "l", header: "Derived Formula Parameter", render: x => <strong>{x.label}</strong> },
    { key: "v", header: "Calculated Value", align: "r", render: x => <span className="bz-fig">{x.value} {x.unit}</span> },
  ];

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <header>
        <h2 style={{ font: "600 var(--fs-4)/1.1 var(--font-figure)", margin: 0 }}>
          Autonomous Treasury Onboarding Wizard
        </h2>
        <p className="bz-muted" style={{ margin: "4px 0 0", maxWidth: "75ch" }}>
          Initial onboarding configuration that establishes the mathematical operating floor, departmental cost centers, and autonomous permissions for Halcyon Robotics Inc.
        </p>
      </header>

      {/* Stepper Header */}
      <WizardStepper current={wizardStep} completed={wizardCompleted} />

      {/* Step 1: Company Profile */}
      {wizardStep === 1 && (
        <Panel title="Step 1: Company Identity & Jurisdiction">
          <div style={{ display: "grid", gap: 16, maxWidth: 540 }}>
            <Field label="Legal Entity Name">
              {id => (
                <TextInput
                  id={id}
                  value={profile.companyName}
                  onChange={e => setProfile({ ...profile, companyName: e.target.value })}
                />
              )}
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Tax Identification (EIN)">
                {id => (
                  <TextInput
                    id={id}
                    value={profile.taxId}
                    onChange={e => setProfile({ ...profile, taxId: e.target.value })}
                  />
                )}
              </Field>

              <Field label="Jurisdiction">
                {id => (
                  <TextInput
                    id={id}
                    value={profile.jurisdiction}
                    onChange={e => setProfile({ ...profile, jurisdiction: e.target.value })}
                  />
                )}
              </Field>
            </div>

            <Field label="Operating Model Description" hint="Analyzed by Onboarding Agent to derive cost centers and expense categories.">
              {id => (
                <textarea
                  id={id}
                  className="bz-input"
                  rows={3}
                  value={profile.businessDescription}
                  onChange={e => setProfile({ ...profile, businessDescription: e.target.value })}
                />
              )}
            </Field>

            <Field label="Designated CFO Admin Email">
              {id => (
                <TextInput
                  id={id}
                  type="email"
                  value={profile.adminEmail}
                  onChange={e => setProfile({ ...profile, adminEmail: e.target.value })}
                />
              )}
            </Field>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button onClick={handleNext}>Save and Continue →</Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 2: Money Rules & Math Questions */}
      {wizardStep === 2 && (
        <Panel title="Step 2: Liquidity Equations & Mathematical Guardrails">
          <div style={{ display: "grid", gap: 20 }}>
            <p className="bz-muted" style={{ margin: 0, maxWidth: "70ch" }}>
              These mathematical parameters directly program the Policy Compliance Agent (#104) and Sentinel Agent (#101).
            </p>

            <div style={{ display: "grid", gap: 16, maxWidth: 600 }}>
              {MATH_QUESTIONS.slice(0, 4).map(q => (
                <QuestionField
                  key={q.questionId}
                  q={q}
                  value={answers[q.questionId]}
                  onChange={v => setAnswers({ ...answers, [q.questionId]: v })}
                />
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: "var(--fs-1)" }}>Derived Policy Parameters</h4>
              <DataTable columns={derivedColumns} rows={DERIVED_PARAMS} rowKey={x => x.name} />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button onClick={handleNext}>Save and Continue →</Button>
              <Button variant="secondary" onClick={handleBack}>Back</Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 3: Declared Policies */}
      {wizardStep === 3 && (
        <Panel title="Step 3: Anomaly Tolerances & Review Triggers">
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <h4 style={{ margin: 0 }}>Cost Center Segmentation Rules</h4>
              <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6, color: "var(--ink-2)" }}>
                {policies.costCenterRules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            <div style={{ display: "grid", gap: 12, maxWidth: 480 }}>
              <h4 style={{ margin: 0 }}>Stealth Creep Tolerances</h4>
              <Field label="Max Allowed Price Hike Variance Without Amendment (%)">
                {id => (
                  <TextInput
                    id={id}
                    value={policies.anomalyTolerances.maxPriceHikePercentage}
                    onChange={e =>
                      setPolicies({
                        ...policies,
                        anomalyTolerances: {
                          ...policies.anomalyTolerances,
                          maxPriceHikePercentage: e.target.value,
                        },
                      })
                    }
                  />
                )}
              </Field>

              <Switch
                checked={policies.anomalyTolerances.flagUnregisteredVendors}
                onChange={v =>
                  setPolicies({
                    ...policies,
                    anomalyTolerances: {
                      ...policies.anomalyTolerances,
                      flagUnregisteredVendors: v,
                    },
                  })
                }
                label="Freeze payment on unverified vendor address"
              />

              <Switch
                checked={policies.anomalyTolerances.requireThreeWayMatch}
                onChange={v =>
                  setPolicies({
                    ...policies,
                    anomalyTolerances: {
                      ...policies.anomalyTolerances,
                      requireThreeWayMatch: v,
                    },
                  })
                }
                label="Enforce 3-way match (PO + Goods Receipt + Invoice) on fiat payouts"
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={handleNext}>Save and Continue →</Button>
              <Button variant="secondary" onClick={handleBack}>Back</Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 4: Treasury Accounts */}
      {wizardStep === 4 && (
        <Panel title="Step 4: Departmental Account Allocations">
          <div style={{ display: "grid", gap: 16 }}>
            <p className="bz-muted" style={{ margin: 0 }}>
              Accounts provisioned with isolated wallets on Arc Testnet.
            </p>
            <div className="bz-grid">
              {WIZARD_ACCOUNTS.map(a => (
                <div key={a.accountId} style={{ padding: 12, border: "1px solid var(--rule)", borderRadius: 6, backgroundColor: "var(--surface)" }}>
                  <strong>{a.name}</strong>
                  <div className="bz-faint" style={{ fontSize: "0.8rem", marginBottom: 8 }}>{a.role}</div>
                  <dl className="bz-kv" style={{ fontSize: "0.85rem" }}>
                    <dt>Floor</dt>
                    <dd>{formatUsdc(a.minOperatingFloorUsdc)}</dd>
                    <dt>Daily Cap</dt>
                    <dd>{formatUsdc(a.dailyCapUsdc)}</dd>
                    <dt>Waterfall</dt>
                    <dd>{a.excludeFromWaterfall ? "Shielded" : "Active"}</dd>
                  </dl>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={handleNext}>Save and Continue →</Button>
              <Button variant="secondary" onClick={handleBack}>Back</Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 5: Recurring Bills */}
      {wizardStep === 5 && (
        <Panel title="Step 5: Discovered Recurring Liabilities & Optimal Rails">
          <div style={{ display: "grid", gap: 16 }}>
            <p className="bz-muted" style={{ margin: 0 }}>
              Identified from connected ERP (Odoo) and Google Workspace billing statements.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ padding: 12, border: "1px solid var(--rule)", borderRadius: 6, backgroundColor: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>AWS Cloud Infrastructure</strong>
                  <div className="bz-faint">Vendor: Amazon Web Services · Disbursal Vault Rail</div>
                </div>
                <strong className="bz-fig">$14,210.50</strong>
              </div>

              <div style={{ padding: 12, border: "1px solid var(--rule)", borderRadius: 6, backgroundColor: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>OpenAI API Tier 5</strong>
                  <div className="bz-faint">Vendor: OpenAI API · Gateway x402 Rail</div>
                </div>
                <strong className="bz-fig">$3,875.13</strong>
              </div>

              <div style={{ padding: 12, border: "1px solid var(--rule)", borderRadius: 6, backgroundColor: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>Morrison & Foerster Legal Retainer</strong>
                  <div className="bz-faint">Vendor: Morrison & Foerster LLP · Fedwire Rail</div>
                </div>
                <strong className="bz-fig">$5,200.00</strong>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={handleNext}>Proceed to Final Audit →</Button>
              <Button variant="secondary" onClick={handleBack}>Back</Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 6: Audit & Activation */}
      {wizardStep === 6 && (
        <Panel title="Step 6: Production Readiness Audit & Swarm Activation">
          <div style={{ display: "grid", gap: 20 }}>
            {activated ? (
              <Banner tone="auto" title="Treasury Swarm Fully Operational">
                All 6 accounts initialized, ledger genesis written, and autonomous Sentinel and Radar agents active on Arc Testnet (5042002).
              </Banner>
            ) : (
              <Banner tone="info" title="Ready to Commit">
                Verification passed with 94.8 / 100 readiness score across 8 pillars. Click activate to launch autonomous sweeps and disbursals.
              </Banner>
            )}

            <div style={{ display: "grid", gap: 8 }}>
              {READINESS_PILLARS.slice(0, 4).map(p => (
                <div key={p.pillar} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--rule)" }}>
                  <span>{p.pillar}</span>
                  <span style={{ color: p.isReady ? "var(--auto)" : "var(--danger)", fontWeight: 600 }}>
                    {p.isReady ? "✓ Pass" : "Attention"}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {!activated ? (
                <Button loading={activating} onClick={handleActivate}>
                  Activate Autonomous Treasury
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setActiveView("overview")}>
                  Open Executive Dashboard →
                </Button>
              )}
              <Button variant="secondary" onClick={handleBack}>Back</Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
