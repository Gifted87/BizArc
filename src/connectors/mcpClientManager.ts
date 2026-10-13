import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { MissingVendorCredentialsError } from "./vendorBillingTypes.js";

export interface McpClientSession {
  companyId: string;
  provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365";
  client: Client;
  transport?: SSEClientTransport;
  connectedAt: Date;
}

export class McpClientManager {
  private static sessions: Map<string, McpClientSession> = new Map();

  /**
   * Initializes or retrieves an active MCP client session for a tenant.
   * Connects via SSE transport to the tenant's configured MCP server endpoint.
   */
  public static async getClientSession(
    companyId: string,
    provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365"
  ): Promise<Client> {
    const sessionKey = `${companyId}:${provider}`;
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      return existing.client;
    }

    const token = await TenantOAuthRepo.getToken(companyId, provider);
    const serverUrl =
      token?.session_metadata?.mcpServerUrl ||
      (provider === "GOOGLE_WORKSPACE"
        ? process.env.GOOGLE_WORKSPACE_MCP_URL
        : process.env.MICROSOFT_365_MCP_URL);

    if (!token && !serverUrl) {
      throw new MissingVendorCredentialsError(
        provider === "GOOGLE_WORKSPACE" ? "Google Workspace MCP" : "Microsoft 365 MCP",
        companyId,
        `No OAuth token record or MCP server URL configured in tenant_oauth_tokens or environment.`
      );
    }

    const client = new Client(
      {
        name: `BizArc-${provider}-Client`,
        version: "1.0.0",
      },
      {
        capabilities: {
          roots: {},
          sampling: {},
        } as any,
      }
    );

    if (serverUrl) {
      const sseTransport = new SSEClientTransport(new URL(serverUrl), {
        eventSourceInit: {
          headers: token?.access_token_encrypted
            ? { Authorization: `Bearer ${token.access_token_encrypted}` }
            : {},
        } as any,
      });

      // 15-second timeout circuit breaker per Section 3.3
      const connectPromise = client.connect(sseTransport);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`MCP server connection timeout (15s exceeded) to ${serverUrl}`)), 15000)
      );

      await Promise.race([connectPromise, timeoutPromise]);

      this.sessions.set(sessionKey, {
        companyId,
        provider,
        client,
        transport: sseTransport,
        connectedAt: new Date(),
      });
    }

    return client;
  }

  /**
   * Closes active MCP sessions for a tenant.
   */
  public static async closeSession(companyId: string, provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365"): Promise<void> {
    const sessionKey = `${companyId}:${provider}`;
    const session = this.sessions.get(sessionKey);
    if (session?.transport) {
      await session.transport.close();
    }
    this.sessions.delete(sessionKey);
  }
}
