import React, { useState } from "react";
import { Panel, Button, Badge, DataTable, CopyChip, Banner, Field, TextInput } from "../primitives";
import { API_KEYS } from "../fixtures";
import type * as T from "../types";

export function ApiKeysView() {
  const [keys, setKeys] = useState<T.ApiKeyRecord[]>(API_KEYS);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    "treasury:read",
    "disbursals:execute",
  ]);
  const [newlyCreatedSecret, setNewlyCreatedSecret] = useState<string | null>(null);

  const availableScopes = [
    { id: "treasury:read", label: "Read Treasury Balances & Safe-to-Invest" },
    { id: "disbursals:execute", label: "Execute Autonomous Disbursals" },
    { id: "sprs:decide", label: "Authorize / Co-Sign Human SPRS" },
    { id: "policies:mutate", label: "Modify Corporate Movement Policies" },
    { id: "integrations:manage", label: "Manage ERP & MCP App Tokens" },
  ];

  const handleToggleScope = (scopeId: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyLabel) return;

    const secretKey = `bz_live_${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
    const prefix = `${secretKey.slice(0, 12)}...`;

    const newKey: T.ApiKeyRecord = {
      keyId: `key_${Date.now()}`,
      label: newKeyLabel,
      prefix,
      scopes: selectedScopes,
      createdAt: new Date().toISOString(),
      createdBy: "s.connor@halcyon.ai",
      status: "ACTIVE",
    };

    setKeys([newKey, ...keys]);
    setNewlyCreatedSecret(secretKey);
    setNewKeyLabel("");
  };

  const handleRevoke = (keyId: string) => {
    setKeys((prev) =>
      prev.map((k) => (k.keyId === keyId ? { ...k, status: "REVOKED" } : k))
    );
  };

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-3)", fontWeight: 700, margin: 0, color: "var(--ink)" }}>
            Developer API Keys & Machine-to-Machine Credentials
          </h1>
          <p className="bz-faint" style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>
            Provision scoped API keys for automated CI/CD runners, internal billing pipelines, and autonomous agent sidecars.
          </p>
        </div>
        <Button variant="primary" onClick={() => { setShowGenerateModal(true); setNewlyCreatedSecret(null); }}>
          + Generate New API Key
        </Button>
      </div>

      {newlyCreatedSecret && (
        <Banner tone="gate" title="API Key Generated Successfully">
          <p style={{ margin: "4px 0 8px", fontSize: "0.85rem" }}>
            Make sure to copy your secret API key now. You will not be able to see it again!
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CopyChip text={newlyCreatedSecret} label={newlyCreatedSecret} />
            <Button variant="quiet" onClick={() => setNewlyCreatedSecret(null)} style={{ padding: "4px 8px" }}>
              Dismiss
            </Button>
          </div>
        </Banner>
      )}

      <Panel
        title="Active API Keys"
        action={<Badge tone="neutral">{keys.filter((k) => k.status === "ACTIVE").length} Active</Badge>}
      >
        <DataTable
          columns={[
            {
              key: "label",
              header: "Key Label",
              render: (k: T.ApiKeyRecord) => (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--ink)" }}>{k.label}</div>
                  <div className="bz-faint" style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                    {k.keyId}
                  </div>
                </div>
              ),
            },
            {
              key: "prefix",
              header: "Token Prefix",
              render: (k: T.ApiKeyRecord) => (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--ink-2)" }}>
                  {k.prefix}
                </span>
              ),
            },
            {
              key: "scopes",
              header: "Authorized Scopes",
              render: (k: T.ApiKeyRecord) => (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {k.scopes.map((s) => (
                    <Badge key={s} tone="gate">
                      {s}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (k: T.ApiKeyRecord) => (
                <Badge tone={k.status === "ACTIVE" ? "liquid" : "danger"}>{k.status}</Badge>
              ),
            },
            {
              key: "lastUsed",
              header: "Last Used",
              render: (k: T.ApiKeyRecord) => (
                <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never used"}
                </span>
              ),
            },
            {
              key: "actions",
              header: "Action",
              render: (k: T.ApiKeyRecord) =>
                k.status === "ACTIVE" ? (
                  <Button
                    variant="quiet"
                    onClick={() => handleRevoke(k.keyId)}
                    style={{ fontSize: "0.8rem", color: "var(--danger)" }}
                  >
                    Revoke Key
                  </Button>
                ) : (
                  <span className="bz-faint">—</span>
                ),
            },
          ]}
          rows={keys}
          rowKey={(k) => k.keyId}
        />
      </Panel>

      {/* Generate Key Modal */}
      {showGenerateModal && (
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
          onClick={() => setShowGenerateModal(false)}
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
            <h3 style={{ margin: "0 0 16px", fontSize: "var(--fs-2)" }}>Generate Scoped API Key</h3>
            <form onSubmit={(e) => { handleGenerate(e); setShowGenerateModal(false); }} style={{ display: "grid", gap: 16 }}>
              <Field label="Key Description / Service Name">
                {(id) => (
                  <TextInput
                    id={id}
                    value={newKeyLabel}
                    onChange={(e) => setNewKeyLabel(e.target.value)}
                    placeholder="e.g. AWS Lambda Settlement Worker"
                    required
                  />
                )}
              </Field>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>
                  Granted Capabilities & Scopes
                </label>
                <div style={{ display: "grid", gap: 8 }}>
                  {availableScopes.map((scope) => (
                    <label
                      key={scope.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: "0.85rem",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope.id)}
                        onChange={() => handleToggleScope(scope.id)}
                      />
                      <span>
                        <strong>{scope.id}</strong> — {scope.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <Button variant="quiet" onClick={() => setShowGenerateModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Generate Key
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
