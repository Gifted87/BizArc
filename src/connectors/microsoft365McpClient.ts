import { FinancialDocumentParser, ParsedFinancialInvoice, ParsedFinancialContract } from "./financialDocumentParser.js";
import { McpClientManager } from "./mcpClientManager.js";
import { MissingVendorCredentialsError } from "./vendorBillingTypes.js";

export interface MicrosoftMcpFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  textContent?: string;
  webUrl?: string;
}

export interface MicrosoftExcelWorksheet {
  id: string;
  name: string;
  position: number;
  visibility: "Visible" | "Hidden";
}

export interface MicrosoftExcelRangeResult {
  address: string;
  rowCount: number;
  columnCount: number;
  values: any[][];
}

export interface IMicrosoft365McpTransport {
  callTool(name: string, args: Record<string, any>): Promise<any>;
}

export class Microsoft365McpClient {
  private companyId: string;
  private transport?: IMicrosoft365McpTransport;

  constructor(companyId: string, transport?: IMicrosoft365McpTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public setTransport(transport: IMicrosoft365McpTransport): void {
    this.transport = transport;
  }

  private async executeMcpTool(name: string, args: Record<string, any>): Promise<any> {
    if (this.transport) {
      return await this.transport.callTool(name, args);
    }
    const client = await McpClientManager.getClientSession(this.companyId, "MICROSOFT_365");
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
   * Searches OneDrive/SharePoint for budget spreadsheets, invoices, and supplier contracts.
   * Calls MCP tool: onedrive_search_files({ query })
   */
  public async searchOneDriveFiles(query?: string): Promise<MicrosoftMcpFile[]> {
    const q = query || "invoice OR subscription OR contract OR budget OR schedule";
    const res = await this.executeMcpTool("onedrive_search_files", { query: q });
    return res.files || [];
  }

  /**
   * Reads raw range from a workbook spreadsheet on OneDrive/Excel.
   * Calls MCP tool: excel_read_range({ workbookId, worksheetName, range })
   */
  public async readExcelRange(
    workbookId: string,
    worksheetName: string,
    range: string = "A1:H100"
  ): Promise<MicrosoftExcelRangeResult> {
    const res = await this.executeMcpTool("excel_read_range", { workbookId, worksheetName, range });
    return {
      address: res.address || range,
      rowCount: res.rowCount || (res.values ? res.values.length : 0),
      columnCount: res.columnCount || (res.values?.[0] ? res.values[0].length : 0),
      values: res.values || [],
    };
  }

  /**
   * Comprehensive Ingestion: Searches OneDrive for agreements and budget spreadsheets,
   * extracts tabular records and MSA commitments, and returns normalized financial assets.
   */
  public async extractFinancialData(): Promise<{
    invoices: ParsedFinancialInvoice[];
    contracts: ParsedFinancialContract[];
  }> {
    const invoices: ParsedFinancialInvoice[] = [];
    const contracts: ParsedFinancialContract[] = [];

    // 1. Discover OneDrive files
    let files: MicrosoftMcpFile[] = [];
    try {
      files = await this.searchOneDriveFiles();
    } catch (err) {
      if (err instanceof MissingVendorCredentialsError) {
        throw err;
      }
      console.warn(`[Microsoft365McpClient] OneDrive search notice for ${this.companyId}:`, err);
    }

    // 2. Process Excel Budget Spreadsheets
    const excelFiles = files.filter(
      (f) =>
        f.name.endsWith(".xlsx") ||
        f.name.endsWith(".xls") ||
        f.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    for (const file of excelFiles) {
      try {
        const rangeResult = await this.readExcelRange(file.id, "Sheet1", "A1:G50");
        if (rangeResult.values && rangeResult.values.length > 1) {
          const headers = rangeResult.values[0].map((h: any) => String(h || "").trim());
          for (let rowIdx = 1; rowIdx < rangeResult.values.length; rowIdx++) {
            const rowValues = rangeResult.values[rowIdx];
            const rowObj: Record<string, any> = {};
            headers.forEach((header: string, i: number) => {
              if (header) rowObj[header] = rowValues[i];
            });

            const parsed = FinancialDocumentParser.parseSpreadsheetRow(rowObj, rowIdx, "MICROSOFT_EXCEL");
            if (parsed && parsed.amountUsdc > 0) {
              invoices.push(parsed);
            }
          }
        }
      } catch (err) {
        if (err instanceof MissingVendorCredentialsError) {
          throw err;
        }
        console.warn(`[Microsoft365McpClient] Failed to read Excel workbook ${file.id}:`, err);
      }
    }

    // 3. Process PDF / Text Contracts
    const docFiles = files.filter(
      (f) =>
        f.name.endsWith(".pdf") ||
        f.name.endsWith(".docx") ||
        f.mimeType === "application/pdf"
    );

    for (const file of docFiles) {
      try {
        let text = file.textContent;
        if (!text) {
          const downloadRes = await this.executeMcpTool("onedrive_download_file", { fileId: file.id });
          text = downloadRes.text || downloadRes.content || "";
        }
        if (text) {
          const parsed = FinancialDocumentParser.parseContractText(text, file.id, "MICROSOFT_ONEDRIVE");
          if (parsed.committedMonthlySpendUsdc > 0) {
            contracts.push(parsed);
          }
        }
      } catch (err) {
        if (err instanceof MissingVendorCredentialsError) {
          throw err;
        }
        console.warn(`[Microsoft365McpClient] Failed to process contract ${file.id}:`, err);
      }
    }

    return { invoices, contracts };
  }
}
