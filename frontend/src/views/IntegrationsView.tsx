import React, { useState, useEffect } from "react";
import { Panel, Button, Badge, DataTable, Banner, Field, TextInput, Select } from "../primitives";
import { treasuryApi } from "../api/treasuryApi";

interface ConnectorItem {
  provider: string;
  name: string;
  category: "MCP" | "ERP" | "SAAS";
  status: "CONNECTED" | "DISCONNECTED";
  connectedAt?: string;
  scope?: string;
  hasRefreshToken?: boolean;
}

const DEFAULT_CONNECTORS: ConnectorItem[] = [
  { provider: "GOOGLE_WORKSPACE", name: "Google Workspace (Drive & Gmail MCP)", category: "MCP", status: "DISCONNECTED" },
  { provider: "MICROSOFT_365", name: "Microsoft 365 (OneDrive & Excel MCP)", category: "MCP", status: "DISCONNECTED" },
  { provider: "ERPNEXT_KEY", name: "ERPNext Accounting & Ledger", category: "ERP", status: "CONNECTED", connectedAt: "2026-03-01T08:00:00Z" },
  { provider: "ODOO_SESSION", name: "Odoo Enterprise Accounting", category: "ERP", status: "DISCONNECTED" },
  { provider: "AWS_STS_ROLE", name: "AWS Cloud Infrastructure Billing", category: "SAAS", status: "CONNECTED", connectedAt: "2026-02-15T12:00:00Z" },
  { provider: "STRIPE_RESTRICTED", name: "Stripe Billing & Subscriptions", category: "SAAS", status: "CONNECTED", connectedAt: "2026-02-20T10:00:00Z" },
  { provider: "GITHUB_ENTERPRISE", name: "GitHub Enterprise Subscriptions", category: "SAAS", status: "DISCONNECTED" },
  { provider: "OPENAI_ADMIN", name: "OpenAI Platform & Model API Spend", category: "SAAS", status: "CONNECTED", connectedAt: "2026-01-10T14:00:00Z" },
  { provider: "DATADOG_API", name: "Datadog Cloud Observability", category: "SAAS", status: "DISCONNECTED" },
  { provider: "GCP_SERVICE_ACCOUNT", name: "Google Cloud Platform Billing", category: "SAAS", status: "DISCONNECTED" },
  { provider: "AZURE_SERVICE_PRINCIPAL", name: "Microsoft Azure Cloud Services", category: "SAAS", status: "DISCONNECTED" },
  { provider: "FIGMA_ADMIN", name: "Figma Enterprise Design Subscriptions", category: "SAAS", status: "DISCONNECTED" },
  { provider: "SNOWFLAKE_JWT", name: "Snowflake Data Cloud Warehouse", category: "SAAS", status: "DISCONNECTED" },
  { provider: "TWILIO_AUTH", name: "Twilio Telephony & Messaging", category: "SAAS", status: "DISCONNECTED" },
];

export function IntegrationsView() {
  const [connectors, setConnectors] = useState<ConnectorItem[]>(DEFAULT_CONNECTORS);
  const [selectedCategory, setSelectedCategory] = useState<"ALL" | "MCP" | "ERP" | "SAAS">("ALL");
  const [connectingProvider, setConnectingProvider] = useState<ConnectorItem | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/connectors")
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setConnectors(res.data);
        }
      })
      .catch(() => {});
  }, []);

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectingProvider || !apiKeyInput) return;
    setIsSubmitting(true);

    try {
      const resp = await fetch("/api/integrations/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: connectingProvider.provider,
          accessToken: apiKeyInput,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setConnectors((prev) =>
          prev.map((c) =>
            c.provider === connectingProvider.provider
              ? { ...c, status: "CONNECTED", connectedAt: new Date().toISOString() }
              : c
          )
        );
        setSyncFeedback(`Successfully authorized ${connectingProvider.name}.`);
        setConnectingProvider(null);
        setApiKeyInput("");
      } else {
        setSyncFeedback(`Failed to connect: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setSyncFeedback(`Network error connecting provider: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async (provider: string) => {
    try {
      await fetch(`/api/integrations/connectors/${provider}`, { method: "DELETE" });
      setConnectors((prev) =>
        prev.map((c) => (c.provider === provider ? { ...c, status: "DISCONNECTED", connectedAt: undefined } : c))
      );
      setSyncFeedback(`Disconnected ${provider}.`);
    } catch {}
  };

  const filteredConnectors =
    selectedCategory === "ALL" ? connectors : connectors.filter((c) => c.category === selectedCategory);

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: "var(--fs-3)", fontWeight: 700, margin: 0, color: "var(--ink)" }}>
          Connected Apps, MCP Servers & ERP Connectors
        </h1>
        <p className="bz-faint" style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>
          Ingest contracts, invoices, and billing schedules via Model Context Protocol (MCP) clients and sync vouchers to corporate ERPs.
        </p>
      </div>

      {syncFeedback && (
        <Banner tone="auto">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <span>{syncFeedback}</span>
            <Button variant="quiet" onClick={() => setSyncFeedback(null)} style={{ padding: "2px 8px" }}>
              Dismiss
            </Button>
          </div>
        </Banner>
      )}

      {/* Category Tabs */}
      <div style={{ display: "flex", gap: 8 }}>
        {(["ALL", "MCP", "ERP", "SAAS"] as const).map((cat) => (
          <Button
            key={cat}
            variant={selectedCategory === cat ? "primary" : "secondary"}
            onClick={() => setSelectedCategory(cat)}
            style={{ fontSize: "0.85rem", padding: "6px 14px" }}
          >
            {cat === "ALL"
              ? "All Connectors"
              : cat === "MCP"
              ? "Model Context Protocol (MCP)"
              : cat === "ERP"
              ? "Enterprise ERPs"
              : "Top-10 SaaS Billing"}
          </Button>
        ))}
      </div>

      {/* Connectors Grid */}
      <Panel
        title={`Registered Integrations (${filteredConnectors.length})`}
        action={
          <Badge tone="liquid">
            {filteredConnectors.filter((c) => c.status === "CONNECTED").length} Connected
          </Badge>
        }
      >
        <DataTable
          columns={[
            {
              key: "name",
              header: "Connector / Protocol",
              render: (c: ConnectorItem) => (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--ink)" }}>{c.name}</div>
                  <div className="bz-faint" style={{ fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                    {c.provider}
                  </div>
                </div>
              ),
            },
            {
              key: "category",
              header: "Category",
              render: (c: ConnectorItem) => (
                <Badge tone={c.category === "MCP" ? "gate" : c.category === "ERP" ? "liquid" : "neutral"}>
                  {c.category}
                </Badge>
              ),
            },
            {
              key: "status",
              header: "Connection State",
              render: (c: ConnectorItem) => (
                <Badge tone={c.status === "CONNECTED" ? "liquid" : "neutral"}>
                  {c.status === "CONNECTED" ? "CONNECTED" : "DISCONNECTED"}
                </Badge>
              ),
            },
            {
              key: "connectedAt",
              header: "Last Synchronized",
              render: (c: ConnectorItem) => (
                <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                  {c.connectedAt ? new Date(c.connectedAt).toLocaleDateString() : "Never configured"}
                </span>
              ),
            },
            {
              key: "actions",
              header: "Action",
              render: (c: ConnectorItem) => (
                <div style={{ display: "flex", gap: 8 }}>
                  {c.status === "CONNECTED" ? (
                    <Button
                      variant="quiet"
                      onClick={() => handleDisconnect(c.provider)}
                      style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => setConnectingProvider(c)}
                      style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                    >
                      Connect App
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          rows={filteredConnectors}
          rowKey={(c) => c.provider}
        />
      </Panel>

      {/* Connect Modal */}
      {connectingProvider && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setConnectingProvider(null)}
        >
          <div
            style={{
              backgroundColor: "var(--surface)",
              borderRadius: "var(--r-panel)",
              padding: 24,
              maxWidth: 480,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: "var(--fs-2)" }}>Connect {connectingProvider.name}</h3>
            <p className="bz-faint" style={{ fontSize: "0.85rem", marginBottom: 16 }}>
              Provide the API secret, OAuth access token, or service account credential to enable autonomous invoice extraction and billing reconciliation.
            </p>

            <form onSubmit={handleConnectSubmit} style={{ display: "grid", gap: 16 }}>
              <Field label="API Key / OAuth Access Token / Session Secret">
                {(id) => (
                  <TextInput
                    id={id}
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="e.g. sk_live_... / Bearer token / App Password"
                    required
                  />
                )}
              </Field>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <Button variant="quiet" onClick={() => setConnectingProvider(null)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Verifying..." : "Authorize Connector"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
