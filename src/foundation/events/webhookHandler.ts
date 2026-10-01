import crypto from "crypto";

export interface CircleWebhookPayload {
  notificationId: string;
  type: string;
  data: {
    id: string; // transactionId
    state: "INITIATED" | "WAITING" | "QUEUED" | "CLEARED" | "SENT" | "CONFIRMED" | "COMPLETE" | "FAILED" | "DENIED" | "CANCELLED";
    txHash?: `0x${string}`;
    walletId?: string;
    tokenId?: string;
    amount?: string;
    amounts?: string[];
    destinationAddress?: string;
    errorReason?: string;
  };
  timestamp: string;
}

export class WebhookHandler {
  /**
   * Verifies the cryptographic signature of an incoming Circle Webhook request.
   */
  public static verifyCircleSignature(params: {
    rawBody: string;
    signatureHeader?: string;
    keyIdHeader?: string;
    publicKeyPem?: string;
  }): boolean {
    if (!params.signatureHeader || !params.publicKeyPem) {
      // In development or local testing without public key, flag for caution
      return false;
    }

    try {
      const verifier = crypto.createVerify("SHA256");
      verifier.update(params.rawBody);
      return verifier.verify(params.publicKeyPem, params.signatureHeader, "base64");
    } catch (err) {
      console.error("[WebhookHandler] Signature verification error:", err);
      return false;
    }
  }

  /**
   * Parses and validates a webhook payload.
   */
  public static parsePayload(rawBody: string): CircleWebhookPayload {
    const parsed = JSON.parse(rawBody) as CircleWebhookPayload;
    if (!parsed.notificationId || !parsed.type || !parsed.data) {
      throw new Error("Invalid Circle webhook payload structure.");
    }
    return parsed;
  }
}
