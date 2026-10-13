/**
 * Enterprise Financial Document & Invoice Parser.
 * Normalizes messy text, email bodies, PDFs, and spreadsheet rows into
 * structured invoices, contracts, cost-center tags, and 6-decimal USDC amounts.
 */

export interface ParsedFinancialInvoice {
  documentId: string;
  sourceApp: "GMAIL" | "GOOGLE_DRIVE" | "MICROSOFT_ONEDRIVE" | "MICROSOFT_EXCEL" | "ERP";
  vendorName: string;
  amountUsdc: number;
  dueDate: string; // ISO date
  payoutAddress?: `0x${string}`;
  poNumber?: string;
  costCenterTag?: string;
  rawTextExcerpt: string;
  confidenceScore: number; // 0.0 - 1.0
}

export interface ParsedFinancialContract {
  contractId: string;
  sourceApp: "GOOGLE_DRIVE" | "MICROSOFT_ONEDRIVE" | "ERP";
  title: string;
  counterparty: string;
  committedMonthlySpendUsdc: number;
  effectiveDate: string;
  renewalDate: string;
  costCenterTag?: string;
  stealthPriceCreepClause?: string;
  noticePeriodDays?: number;
}

export class FinancialDocumentParser {
  private static readonly EVM_ADDRESS_REGEX = /(0x[a-fA-F0-9]{40})/i;
  private static readonly PO_REGEX = /\b(PO[-_ ]?[A-Z0-9]{3,16})\b/i;
  private static readonly INVOICE_NUM_REGEX = /\b(INV[-_ ]?[A-Z0-9]{3,20})\b/i;

  // Known Enterprise Vendor Counterparties
  private static readonly VENDOR_SIGNATURES: Record<string, string> = {
    "amazon web services": "Amazon Web Services (AWS)",
    "aws": "Amazon Web Services (AWS)",
    "github": "GitHub, Inc.",
    "datadog": "Datadog, Inc.",
    "google cloud": "Google Cloud Platform (GCP)",
    "gcp": "Google Cloud Platform (GCP)",
    "microsoft": "Microsoft Corporation",
    "azure": "Microsoft Azure",
    "openai": "OpenAI, LLC",
    "stripe": "Stripe, Inc.",
    "snowflake": "Snowflake, Inc.",
    "twilio": "Twilio, Inc.",
    "figma": "Figma, Inc.",
  };

  /**
   * Parses arbitrary unstructured text (email body, PDF extract, OCR) into an invoice.
   */
  public static parseInvoiceText(
    text: string,
    documentId: string,
    sourceApp: ParsedFinancialInvoice["sourceApp"]
  ): ParsedFinancialInvoice {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const lowerText = text.toLowerCase();

    // 1. Identify Vendor Name
    let vendorName = "Unknown Enterprise Vendor";
    for (const [key, canonical] of Object.entries(this.VENDOR_SIGNATURES)) {
      if (lowerText.includes(key)) {
        vendorName = canonical;
        break;
      }
    }
    if (vendorName === "Unknown Enterprise Vendor" && lines.length > 0) {
      // First non-empty line heuristic
      const firstLine = lines[0].replace(/invoice|bill|statement/gi, "").trim();
      if (firstLine.length > 2 && firstLine.length < 50) {
        vendorName = firstLine;
      }
    }

    // 2. Extract Amount
    const amountUsdc = this.extractAmountUsdc(text);

    // 3. Extract Due Date
    const dueDate = this.extractDueDate(text);

    // 4. Extract Payout Address
    const addressMatch = text.match(this.EVM_ADDRESS_REGEX);
    const payoutAddress = addressMatch ? (addressMatch[1].toLowerCase() as `0x${string}`) : undefined;

    // 5. Extract PO Reference
    const poNumber = this.extractPoNumber(text);

    // 6. Extract Cost Center / Department Tags
    const costCenterTag = this.extractCostCenterTag(text);

    // 7. Calculate Confidence Score
    let score = 0.4;
    if (vendorName !== "Unknown Enterprise Vendor") score += 0.2;
    if (amountUsdc > 0) score += 0.2;
    if (payoutAddress) score += 0.1;
    if (poNumber) score += 0.1;

    return {
      documentId,
      sourceApp,
      vendorName,
      amountUsdc,
      dueDate,
      payoutAddress,
      poNumber,
      costCenterTag,
      rawTextExcerpt: text.length > 300 ? text.substring(0, 300) + "..." : text,
      confidenceScore: Math.min(score, 1.0),
    };
  }

  /**
   * Parses contract text into a structured contract schedule.
   */
  public static parseContractText(
    text: string,
    contractId: string,
    sourceApp: ParsedFinancialContract["sourceApp"]
  ): ParsedFinancialContract {
    const lowerText = text.toLowerCase();

    // Identify Counterparty
    let counterparty = "Enterprise Service Provider";
    for (const [key, canonical] of Object.entries(this.VENDOR_SIGNATURES)) {
      if (lowerText.includes(key)) {
        counterparty = canonical;
        break;
      }
    }

    // Monthly Fee / Commitment
    const committedMonthlySpendUsdc = this.extractAmountUsdc(text);

    // Dates
    const effectiveDate = this.extractDateNearKeywords(text, ["effective", "commencement", "start date"]) || new Date().toISOString().split("T")[0];
    const renewalDate = this.extractDateNearKeywords(text, ["renewal", "expiration", "end date", "term expires"]) || 
      new Date(Date.now() + 86400000 * 365).toISOString().split("T")[0];

    // Notice Period / Stealth Price Creep Clause
    let stealthPriceCreepClause: string | undefined;
    let noticePeriodDays: number | undefined = 30;
    const noticeMatch = text.match(/(\d{1,3})[- \t]*(?:day|days)[- \t]*(?:prior\s*)?(?:written\s*)?notice/i);
    if (noticeMatch) {
      noticePeriodDays = parseInt(noticeMatch[1], 10);
      stealthPriceCreepClause = `Vendor must provide ${noticePeriodDays}-day prior written notice for price changes.`;
    }

    // Cost Center Tag
    const costCenterTag = this.extractCostCenterTag(text);

    return {
      contractId,
      sourceApp,
      title: `${counterparty} Master Services Agreement`,
      counterparty,
      committedMonthlySpendUsdc,
      effectiveDate,
      renewalDate,
      costCenterTag,
      stealthPriceCreepClause,
      noticePeriodDays,
    };
  }

  /**
   * Parses tabular spreadsheet cells (e.g. from Excel range A1:H50).
   */
  public static parseSpreadsheetRow(
    row: Record<string, any>,
    rowIndex: number,
    sourceApp: "MICROSOFT_EXCEL"
  ): ParsedFinancialInvoice | null {
    const keys = Object.keys(row);
    if (keys.length === 0) return null;

    // Detect column values case-insensitively
    const getVal = (candidates: string[]): any => {
      for (const k of keys) {
        const lower = k.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (candidates.some((c) => lower.includes(c))) {
          return row[k];
        }
      }
      return undefined;
    };

    const vendorRaw = getVal(["vendor", "supplier", "merchant", "provider", "name"]);
    const amountRaw = getVal(["amount", "total", "cost", "fee", "balance", "price"]);
    const dueRaw = getVal(["due", "date", "expiry", "billingdate"]);
    const addressRaw = getVal(["wallet", "address", "payout", "recipient", "account"]);
    const poRaw = getVal(["po", "ponumber", "reference", "ref"]);
    const tagRaw = getVal(["department", "costcenter", "team", "project", "category"]);

    if (!vendorRaw && !amountRaw) return null;

    const vendorName = String(vendorRaw || "Corporate Payee").trim();
    const amountUsdc = this.parseNumericAmount(amountRaw);
    if (amountUsdc <= 0) return null;

    let dueDate = new Date(Date.now() + 86400000 * 14).toISOString();
    if (dueRaw) {
      const parsedDate = new Date(dueRaw);
      if (!isNaN(parsedDate.getTime())) {
        dueDate = parsedDate.toISOString();
      }
    }

    let payoutAddress: `0x${string}` | undefined;
    if (addressRaw && typeof addressRaw === "string") {
      const match = addressRaw.match(this.EVM_ADDRESS_REGEX);
      if (match) payoutAddress = match[1].toLowerCase() as `0x${string}`;
    }

    return {
      documentId: `excel_row_${rowIndex}`,
      sourceApp,
      vendorName,
      amountUsdc,
      dueDate,
      payoutAddress,
      poNumber: poRaw ? String(poRaw).trim() : undefined,
      costCenterTag: tagRaw ? String(tagRaw).trim() : undefined,
      rawTextExcerpt: JSON.stringify(row),
      confidenceScore: 0.9,
    };
  }

  /**
   * Extracts exact numeric amount in USDC from text with currency symbols.
   */
  public static extractAmountUsdc(text: string): number {
    // Match amounts like $12,500.00 or 12500.00 USDC or USD 450
    const matches = text.match(/(?:[$€£]|USD|USDC)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,6})?|[0-9]+(?:\.[0-9]{1,6})?)\s*(?:USD|USDC)?/gi);
    if (!matches) return 0;

    let bestAmount = 0;
    for (const m of matches) {
      const cleaned = m.replace(/[$€£,a-zA-Z\s]/g, "");
      const val = parseFloat(cleaned);
      if (!isNaN(val) && val > bestAmount && val < 50000000) {
        bestAmount = val;
      }
    }

    return Math.round(bestAmount * 1_000_000) / 1_000_000;
  }

  private static parseNumericAmount(val: any): number {
    if (typeof val === "number") return Math.round(val * 1_000_000) / 1_000_000;
    if (typeof val === "string") {
      const cleaned = val.replace(/[$€£,]/g, "").trim();
      const num = parseFloat(cleaned);
      return !isNaN(num) ? Math.round(num * 1_000_000) / 1_000_000 : 0;
    }
    return 0;
  }

  private static extractDueDate(text: string): string {
    const dueMatch = text.match(/(?:due(?:\s+date)?|payable(?:\s+by)?|payment\s+due)[:\s]+([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    if (dueMatch) {
      const parsed = new Date(dueMatch[1]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    // Default: 14 days from now
    return new Date(Date.now() + 86400000 * 14).toISOString();
  }

  private static extractDateNearKeywords(text: string, keywords: string[]): string | undefined {
    for (const kw of keywords) {
      const regex = new RegExp(`${kw}(?:\\s+date)?[:\\s]+([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[A-Za-z]+\\s+\\d{1,2},?\\s+\\d{4})`, "i");
      const match = text.match(regex);
      if (match) {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
      }
    }
    return undefined;
  }

  private static extractCostCenterTag(text: string): string | undefined {
    const tagMatch = text.match(/(?:cost\s*center|department|team|project|dimension|analytic)[:\s]+([A-Za-z0-9_\- ]{3,32})/i);
    if (tagMatch) {
      return tagMatch[1].trim();
    }
    return undefined;
  }

  private static extractPoNumber(text: string): string | undefined {
    // Match explicit labels like "PO Reference: PO-123" or "PO: PO-123"
    const labeledMatch = text.match(/(?:PO\s*Reference|Purchase\s*Order|PO\s*#|PO\s*Number|PO)[:\s]+([A-Z0-9\-_]{3,30})/i);
    if (labeledMatch) {
      const candidate = labeledMatch[1].toUpperCase().trim();
      if (!candidate.startsWith("REFERENCE") && !candidate.startsWith("NUMBER")) {
        return candidate;
      }
    }

    // Match freestanding PO codes like PO-2026-DATADOG-99
    const directMatch = text.match(/\b(PO[-_][A-Z0-9\-_]{2,25})\b/i);
    if (directMatch) {
      return directMatch[1].toUpperCase().trim();
    }

    return undefined;
  }
}

