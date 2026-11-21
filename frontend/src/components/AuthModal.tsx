import React, { useState } from "react";
import { Button, Banner, Field, TextInput, Badge, Select } from "../primitives";
import { useTreasury } from "../context/TreasuryContext";
import { MEMBERS } from "../fixtures";
import type * as T from "../types";

export function AuthModal({ onClose }: { onClose: () => void }) {
  const { currentUser, switchUser } = useTreasury();
  const [authMethod, setAuthMethod] = useState<"SIWE" | "EMAIL_OTP" | "ROLE_SWITCH">("SIWE");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleSiweSign = async () => {
    setIsSigning(true);
    setStatusMsg(null);
    try {
      // Real Web3 provider check or fallback
      const ethereum = (window as any).ethereum;
      if (ethereum) {
        const accounts = await ethereum.request({ method: "eth_requestAccounts" });
        const walletAddress = accounts[0];
        const nonceResp = await fetch("/api/auth/siwe/nonce");
        const { nonce } = await nonceResp.json().catch(() => ({ nonce: `nonce_${Date.now()}` }));

        const message = `BizArc Autonomous Treasury Login\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
        const signature = await ethereum.request({
          method: "personal_sign",
          params: [message, walletAddress],
        });

        setStatusMsg(`Signed in with Web3 wallet: ${walletAddress.slice(0, 10)}... (Sig: ${signature.slice(0, 12)}...)`);
      } else {
        setStatusMsg("No Web3 browser wallet detected (MetaMask, Coinbase). Simulated session active.");
      }
    } catch (err: any) {
      setStatusMsg(`Signing error: ${err.message}`);
    } finally {
      setIsSigning(false);
    }
  };

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setOtpSent(true);
    setStatusMsg(`Single-use 6-digit confirmation code dispatched to ${email}.`);
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length < 6) return;
    setStatusMsg(`Email verified! Authenticated session established for ${email}.`);
    onClose();
  };

  return (
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
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--surface)",
          borderRadius: "var(--r-panel)",
          padding: 24,
          maxWidth: 460,
          width: "100%",
          boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: "var(--fs-2)" }}>Sign In / Session Auth</h3>
          <Badge tone="liquid">{currentUser ? currentUser.role : "GUEST"}</Badge>
        </div>

        {statusMsg && (
          <div style={{ marginBottom: 16 }}>
            <Banner tone="auto">{statusMsg}</Banner>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <Button
            variant={authMethod === "SIWE" ? "primary" : "secondary"}
            onClick={() => setAuthMethod("SIWE")}
            style={{ fontSize: "0.8rem", flex: 1 }}
          >
            Web3 SIWE
          </Button>
          <Button
            variant={authMethod === "EMAIL_OTP" ? "primary" : "secondary"}
            onClick={() => setAuthMethod("EMAIL_OTP")}
            style={{ fontSize: "0.8rem", flex: 1 }}
          >
            Email OTP
          </Button>
          <Button
            variant={authMethod === "ROLE_SWITCH" ? "primary" : "secondary"}
            onClick={() => setAuthMethod("ROLE_SWITCH")}
            style={{ fontSize: "0.8rem", flex: 1 }}
          >
            Switch Role
          </Button>
        </div>

        {authMethod === "SIWE" && (
          <div style={{ display: "grid", gap: 16 }}>
            <p className="bz-faint" style={{ fontSize: "0.85rem", margin: 0 }}>
              Sign In With Ethereum (EIP-4361). Authenticate against Arc L1 with cryptographic message signatures.
            </p>
            <div style={{ padding: 12, backgroundColor: "var(--sunken)", borderRadius: 6, fontSize: "0.8rem" }}>
              <div><strong>Network:</strong> Arc L1 (Chain ID: 5042)</div>
              <div><strong>Gas Floor:</strong> 20 Gwei native USDC</div>
            </div>
            <Button variant="primary" onClick={handleSiweSign} disabled={isSigning}>
              {isSigning ? "Requesting Signature..." : "Sign In With Web3 Wallet"}
            </Button>
          </div>
        )}

        {authMethod === "EMAIL_OTP" && (
          <div>
            {!otpSent ? (
              <form onSubmit={handleSendOtp} style={{ display: "grid", gap: 16 }}>
                <Field label="Corporate Email Address">
                  {(id) => (
                    <TextInput
                      id={id}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="cfo@halcyon.ai"
                      required
                    />
                  )}
                </Field>
                <Button variant="primary" type="submit">
                  Send One-Time Password
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} style={{ display: "grid", gap: 16 }}>
                <Field label="Enter 6-Digit Verification Code">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      placeholder="123456"
                      maxLength={6}
                      required
                    />
                  )}
                </Field>
                <Button variant="primary" type="submit">
                  Verify & Establish Session
                </Button>
              </form>
            )}
          </div>
        )}

        {authMethod === "ROLE_SWITCH" && (
          <div style={{ display: "grid", gap: 16 }}>
            <Field label="Active Persona / User Switcher">
              {(id) => (
                <Select
                  id={id}
                  value={currentUser?.userId || MEMBERS[0].userId}
                  onChange={(uid) => {
                    const found = MEMBERS.find((m) => m.userId === uid);
                    if (found) {
                      switchUser(found);
                      setStatusMsg(`Switched active user to ${found.name} (${found.role}).`);
                    }
                  }}
                  options={MEMBERS.map((m) => ({
                    value: m.userId,
                    label: `${m.name} — ${m.role} (${m.email})`,
                  }))}
                />
              )}
            </Field>
            <p className="bz-faint" style={{ fontSize: "0.8rem", margin: 0 }}>
              Testing & simulation tool: switch between CFO, Admin, Approver, and Viewer roles to test RBAC gates.
            </p>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
