import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

/**
 * Enterprise Password & Token Cryptographic Utilities
 * Uses Node.js native crypto with scrypt key derivation (N=16384, r=8, p=1).
 * Constant-time comparison defends against timing attacks.
 */
export class PasswordHasher {
  private static readonly SALT_LENGTH = 16;
  private static readonly KEY_LENGTH = 64;

  /**
   * Derives a cryptographically secure password hash formatted as:
   * scrypt$saltHex$hashHex
   */
  public static async hashPassword(password: string): Promise<string> {
    if (!password || password.length < 8) {
      throw new Error("PASSWORD_TOO_SHORT: Password must be at least 8 characters.");
    }
    const salt = crypto.randomBytes(this.SALT_LENGTH).toString("hex");
    const derivedKey = (await scryptAsync(password, salt, this.KEY_LENGTH)) as Buffer;
    return `scrypt$${salt}$${derivedKey.toString("hex")}`;
  }

  /**
   * Verifies password against stored scrypt hash using timing-safe buffer comparison.
   */
  public static async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (!password || !storedHash) return false;
    const parts = storedHash.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") {
      return false;
    }
    const [, salt, expectedHashHex] = parts;
    const derivedKey = (await scryptAsync(password, salt, this.KEY_LENGTH)) as Buffer;
    const expectedBuffer = Buffer.from(expectedHashHex, "hex");

    if (derivedKey.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, expectedBuffer);
  }

  /**
   * Computes SHA-256 hash of high-entropy tokens (sessions, invitations, API keys)
   * so tokens are NEVER stored in plaintext in the database.
   */
  public static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Generates a random URL-safe cryptographically secure token.
   */
  public static generateSecureToken(prefix = "tok", bytes = 32): string {
    const randomHex = crypto.randomBytes(bytes).toString("hex");
    return `${prefix}_${randomHex}`;
  }

  /**
   * Generates a tenant API key:
   * Format: biz_live_<prefix8>_<secret24>
   * Returns the rawKey (to show user once), the keyPrefix (for display), and keyHash (for DB lookup).
   */
  public static generateApiKey(environment: "live" | "test" = "live"): {
    rawKey: string;
    keyPrefix: string;
    keyHash: string;
  } {
    const prefixRandom = crypto.randomBytes(3).toString("hex");
    const secretRandom = crypto.randomBytes(24).toString("hex");
    const keyPrefix = `biz_${environment}_${prefixRandom}`;
    const rawKey = `${keyPrefix}_${secretRandom}`;
    const keyHash = this.hashToken(rawKey);
    return { rawKey, keyPrefix, keyHash };
  }
}
