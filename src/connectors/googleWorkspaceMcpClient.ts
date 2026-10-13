import { FinancialDocumentParser, ParsedFinancialInvoice, ParsedFinancialContract } from "./financialDocumentParser.js";
import { McpClientManager } from "./mcpClientManager.js";
import { MissingVendorCredentialsError } from "./vendorBillingTypes.js";

export interface GoogleMcpMessageHeader {
  name: string;
  value: string;
}

export interface GoogleMcpMessage {
  id: string;
  threadId: string;
  snippet: string;
  headers: GoogleMcpMessageHeader[];
  bodyText: string;
}

export interface GoogleMcpFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  textContent?: string;
  modifiedTime: string;
}

export interface IGoogleWorkspaceMcpTransport {
  callTool(name: string, args: Record<string, any>): Promise<any>;
}

export class GoogleWorkspaceMcpClient {
  private companyId: string;
  private transport?: IGoogleWorkspaceMcpTransport;

  constructor(companyId: string, transport?: IGoogleWorkspaceMcpTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public setTransport(transport: IGoogleWorkspaceMcpTransport): void {
    this.transport = transport;
  }

  private async executeMcpTool(name: string, args: Record<string, any>): Promise<any> {
    if (this.transport) {
      return await this.transport.callTool(name, args);
    }
    const client = await McpClientManager.getClientSession(this.companyId, "GOOGLE_WORKSPACE");
    const result = await client.callTool({ name, arguments: args });
    if ("structuredContent" in result && result.structuredContent) {
      return result.structuredContent;
    }
    if ("content" in result && Array.isArray(result.content)) {
      const textItem = result.content.find((c: any) => c.type === "text");
      if (textItem && "text" in textItem) {
        try {
          return JSON.parse(textItem.text);
        } catch {
          return { text: textItem.text };
        }
      }
    }
    return result;
  }

  /**
   * Searches Gmail inbox for invoice and billing notifications.
   * Calls MCP tool: gmail_search_messages({ query, maxResults })
   */
  public async searchInvoiceEmails(params?: {
    query?: string;
    maxResults?: number;
  }): Promise<string[]> {
    const q = params?.query || "subject:(invoice OR bill OR renewal OR statement) after:2026/01/01";
    const maxResults = params?.maxResults || 25;

    const res = await this.executeMcpTool("gmail_search_messages", { query: q, maxResults });
    return res.messageIds || [];
  }

  /**
   * Retrieves full email message content by ID from Gmail.
   * Calls MCP tool: gmail_get_message({ messageId, format: 'full' })
   */
  public async getMessage(messageId: string): Promise<GoogleMcpMessage | null> {
    const res = await this.executeMcpTool("gmail_get_message", { messageId, format: "full" });
    if (!res) return null;

    let bodyText = res.bodyText || "";
    if (!bodyText && res.payload) {
      bodyText = res.snippet || "";
    }

    return {
      id: res.id || messageId,
      threadId: res.threadId || "",
      snippet: res.snippet || "",
      headers: res.headers || [],
      bodyText,
    };
  }

  /**
   * Searches Google Drive for vendor agreements, service contracts, and statements.
   * Calls MCP tool: gdrive_search_files({ query, pageSize })
   */
  public async searchDriveContracts(params?: {
    query?: string;
    pageSize?: number;
  }): Promise<GoogleMcpFile[]> {
    const q = params?.query || "mimeType = 'application/pdf' and (name contains 'Agreement' or name contains 'Contract' or name contains 'Statement')";
    const pageSize = params?.pageSize || 20;

    const res = await this.executeMcpTool("gdrive_search_files", { query: q, pageSize });
    return res.files || [];
  }

  /**
   * Downloads and extracts text stream from a Google Drive file.
   * Calls MCP tool: gdrive_download_file({ fileId })
   */
  public async downloadFileText(fileId: string): Promise<string> {
    const res = await this.executeMcpTool("gdrive_download_file", { fileId });
    return res.text || res.content || "";
  }

  /**
   * Comprehensive Ingestion: Executes Gmail AP email search and Google Drive contract search,
   * normalizes all documents via FinancialDocumentParser, and returns structured financial assets.
   */
  public async extractFinancialData(): Promise<{
    invoices: ParsedFinancialInvoice[];
    contracts: ParsedFinancialContract[];
  }> {
    const invoices: ParsedFinancialInvoice[] = [];
    const contracts: ParsedFinancialContract[] = [];

    // 1. Ingest Invoices from Gmail
    try {
      const msgIds = await this.searchInvoiceEmails();
      for (const id of msgIds) {
        const msg = await this.getMessage(id);
        if (msg && msg.bodyText) {
          const parsed = FinancialDocumentParser.parseInvoiceText(msg.bodyText, msg.id, "GMAIL");
          if (parsed.amountUsdc > 0) {
            invoices.push(parsed);
          }
        }
      }
    } catch (err) {
      if (err instanceof MissingVendorCredentialsError) {
        throw err;
      }
      console.warn(`[GoogleWorkspaceMcpClient] Gmail extraction notice for ${this.companyId}:`, err);
    }

    // 2. Ingest Contracts from Google Drive
    try {
      const files = await this.searchDriveContracts();
      for (const file of files) {
        let text = file.textContent;
        if (!text) {
          text = await this.downloadFileText(file.id);
        }
        if (text) {
          const parsed = FinancialDocumentParser.parseContractText(text, file.id, "GOOGLE_DRIVE");
          if (parsed.committedMonthlySpendUsdc > 0) {
            contracts.push(parsed);
          }
        }
      }
    } catch (err) {
      if (err instanceof MissingVendorCredentialsError) {
        throw err;
      }
      console.warn(`[GoogleWorkspaceMcpClient] Google Drive extraction notice for ${this.companyId}:`, err);
    }

    return { invoices, contracts };
  }
}
