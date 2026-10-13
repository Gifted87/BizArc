import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AwsBillingConnector,
  GithubBillingConnector,
  DatadogBillingConnector,
  GoogleCloudBillingConnector,
  AzureBillingConnector,
  OpenAiBillingConnector,
  StripeBillingConnector,
  SnowflakeBillingConnector,
  TwilioBillingConnector,
  FigmaBillingConnector,
  VendorBillingAggregator,
  MissingVendorCredentialsError,
  IVendorTransport,
} from "../src/connectors/index.js";

describe("Phase 2: Top 10 Major Enterprise Vendor MCP & Billing Connectors Verification", () => {
  const companyId = "cmp_enterprise_corp_2026";

  // Mock transports to simulate vendor API JSON responses over wire protocols
  const awsTransport: IVendorTransport = {
    async request(action, options) {
      assert.equal(action, "GetCostAndUsage");
      return {
        ResultsByTime: [
          {
            TimePeriod: { Start: "2026-09-01", End: "2026-09-30" },
            Groups: [
              {
                Keys: ["Core Cloud Compute", "Amazon EC2"],
                Metrics: { AmortizedCost: { Amount: "9200.50", Unit: "USD" } },
              },
              {
                Keys: ["Cloud Storage & S3", "Amazon S3"],
                Metrics: { AmortizedCost: { Amount: "2150.25", Unit: "USD" } },
              },
              {
                Keys: ["Managed Databases", "Amazon RDS"],
                Metrics: { AmortizedCost: { Amount: "3499.25", Unit: "USD" } },
              },
            ],
          },
        ],
      };
    },
  };

  const githubTransport: IVendorTransport = {
    async request(endpoint) {
      if (endpoint.includes("/actions")) {
        return { total_paid_minutes_used: 15000, total_spend: 120.0 };
      }
      if (endpoint.includes("/shared-storage")) {
        return { estimated_paid_storage_for_month: 45.0 };
      }
      if (endpoint.includes("/copilot/billing")) {
        return {
          seat_breakdown: { total: 50, active_this_cycle: 30 },
          seats_count: 50,
        };
      }
      if (endpoint.includes("/cost-centers")) {
        return {
          cost_centers: [
            { name: "Frontend Platform Team" },
            { name: "Backend Infrastructure Team" },
          ],
        };
      }
      return {};
    },
  };

  const datadogTransport: IVendorTransport = {
    async request(endpoint) {
      if (endpoint.includes("/estimated_cost")) {
        return {
          data: [
            {
              attributes: {
                charges: [
                  { product_name: "infra_hosts", cost: "2500.00", projected_cost: "2600.00" },
                  { product_name: "logs_indexed", cost: "1750.50", projected_cost: "1800.00" },
                ],
              },
            },
          ],
        };
      }
      if (endpoint.includes("/billing_dimensions")) {
        return {
          data: [
            { id: "dim_1", attributes: { dimension_name: "Production APM Tracing" } },
            { id: "dim_2", attributes: { dimension_name: "Security SIEM Cluster" } },
          ],
        };
      }
      return {};
    },
  };

  const gcpTransport: IVendorTransport = {
    async request(endpoint) {
      if (endpoint.includes("/budgets")) {
        return {
          budgets: [
            { amount: { specifiedAmount: { units: "8950.00", currencyCode: "USD" } } },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const azureTransport: IVendorTransport = {
    async request(endpoint) {
      if (endpoint.includes("/query")) {
        return {
          properties: {
            rows: [
              ["4500.00", "rg-core-kubernetes-prod"],
              ["2950.00", "rg-entra-identity-services"],
            ],
          },
        };
      }
      return { value: [] };
    },
  };

  const openAiTransport: IVendorTransport = {
    async request(endpoint) {
      if (endpoint.includes("/costs")) {
        return {
          data: [
            {
              results: [
                { project_id: "agentic-autonomous-core", amount: { value: 2100.50 } },
                { project_id: "customer-support-copilot", amount: { value: 1019.50 } },
              ],
            },
          ],
        };
      }
      return { data: [] };
    },
  };

  const stripeTransport: IVendorTransport = {
    async request(endpoint) {
      if (endpoint.includes("/invoices")) {
        return {
          data: [
            {
              amount_due: 215000, // $2150.00
              metadata: { cost_center: "Payment Processing Fees", department: "Finance Ops" },
            },
          ],
        };
      }
      return { data: [] };
    },
  };

  const snowflakeTransport: IVendorTransport = {
    async request(endpoint, options) {
      assert.equal(endpoint, "/api/v2/statements");
      return {
        data: [
          ["2026-09-15", "ANALYTICS_WH", "1500.0"],
          ["2026-09-15", "DATA_SCIENCE_WH", "1000.0"],
        ],
      };
    },
  };

  const twilioTransport: IVendorTransport = {
    async request(endpoint) {
      if (endpoint.includes("/Usage/Records")) {
        return {
          usage_records: [
            { category: "sms-outbound", description: "Global SMS Delivery", price: "950.00" },
            { category: "voice", description: "Interactive Voice Response", price: "500.00" },
            { category: "totalprice", description: "All Usage", price: "1450.00" },
          ],
        };
      }
      return { usage_triggers: [] };
    },
  };

  const figmaTransport: IVendorTransport = {
    async request(endpoint) {
      if (endpoint.includes("/scim/v2/Users")) {
        return {
          Resources: [
            { roles: [{ value: "design" }] },
            { roles: [{ value: "design" }] },
            { roles: [{ value: "dev" }] },
            { roles: [{ value: "figjam" }] },
          ],
        };
      }
      return { events: [] };
    },
  };

  it("1. AWS Billing Connector extracts metrics and enforces DISBURSAL_VAULT rail", async () => {
    const connector = new AwsBillingConnector(companyId, awsTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_aws_cloud");
    assert.equal(data.vendorName, "Amazon Web Services, Inc.");
    assert.equal(data.monthlySpendUsdc, 14850.0);
    assert.equal(data.optimalPaymentRail, "DISBURSAL_VAULT");
    assert.ok(data.invoices.length >= 1);
    assert.ok(data.discoveredCostCenters.length >= 2);
  });

  it("2. GitHub Enterprise Connector computes seats + compute overages with MODULAR_SESSION_KEY rail", async () => {
    const connector = new GithubBillingConnector(companyId, githubTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_github_enterprise");
    // 50 enterprise seats * 21 = 1050, 30 copilot * 39 = 1170, actions = 120, storage = 45 -> total = 2385
    assert.equal(data.monthlySpendUsdc, 2385.0);
    assert.equal(data.optimalPaymentRail, "MODULAR_SESSION_KEY");
    assert.ok(data.discoveredCostCenters.some((c) => c.tag === "Frontend Platform Team"));
  });

  it("3. Datadog Connector maps APM usage dimensions with MODULAR_SESSION_KEY rail", async () => {
    const connector = new DatadogBillingConnector(companyId, datadogTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_datadog");
    assert.equal(data.monthlySpendUsdc, 4250.5);
    assert.equal(data.optimalPaymentRail, "MODULAR_SESSION_KEY");
    assert.ok(data.discoveredCostCenters.some((c) => c.tag === "Production APM Tracing"));
  });

  it("4. Google Cloud Billing Connector parses budgets with DISBURSAL_VAULT rail", async () => {
    const connector = new GoogleCloudBillingConnector(companyId, gcpTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_google_cloud");
    assert.equal(data.monthlySpendUsdc, 8950.0);
    assert.equal(data.optimalPaymentRail, "DISBURSAL_VAULT");
    assert.ok(data.discoveredCostCenters.some((c) => c.tag.includes("GKE")));
  });

  it("5. Azure Cost Management Connector queries resource groups with DISBURSAL_VAULT rail", async () => {
    const connector = new AzureBillingConnector(companyId, azureTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_microsoft_azure");
    assert.equal(data.monthlySpendUsdc, 7450.0);
    assert.equal(data.optimalPaymentRail, "DISBURSAL_VAULT");
    assert.ok(data.discoveredCostCenters.some((c) => c.tag === "rg-core-kubernetes-prod"));
  });

  it("6. OpenAI Costs & Usage Connector groups token spend by project with GATEWAY_X402 rail", async () => {
    const connector = new OpenAiBillingConnector(companyId, openAiTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_openai");
    assert.equal(data.monthlySpendUsdc, 3120.0);
    assert.equal(data.optimalPaymentRail, "GATEWAY_X402");
    assert.ok(data.discoveredCostCenters.some((c) => c.tag.includes("agentic-autonomous-core")));
  });

  it("7. Stripe Invoices & Subscriptions Connector extracts processing fees with ERC3009_AUTHORIZATION rail", async () => {
    const connector = new StripeBillingConnector(companyId, stripeTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_stripe");
    assert.equal(data.monthlySpendUsdc, 2150.0);
    assert.equal(data.optimalPaymentRail, "ERC3009_AUTHORIZATION");
    assert.ok(data.discoveredCostCenters.some((c) => c.tag === "Payment Processing Fees"));
  });

  it("8. Snowflake SQL Connector calculates compute credit burn with DISBURSAL_VAULT rail", async () => {
    const connector = new SnowflakeBillingConnector(companyId, snowflakeTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_snowflake");
    // 2500 credits * $3.00 = $7500.00
    assert.equal(data.monthlySpendUsdc, 7500.0);
    assert.equal(data.optimalPaymentRail, "DISBURSAL_VAULT");
    assert.ok(data.discoveredCostCenters.some((c) => c.tag.includes("ANALYTICS_WH")));
  });

  it("9. Twilio Usage Records Connector tallies SMS/Voice with MODULAR_SESSION_KEY rail", async () => {
    const connector = new TwilioBillingConnector(companyId, twilioTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_twilio");
    assert.equal(data.monthlySpendUsdc, 1450.0);
    assert.equal(data.optimalPaymentRail, "MODULAR_SESSION_KEY");
    assert.ok(data.discoveredCostCenters.some((c) => c.tag.includes("Global SMS Delivery")));
  });

  it("10. Figma SCIM & Activity Connector audits seat tiers with MODULAR_SESSION_KEY rail", async () => {
    const connector = new FigmaBillingConnector(companyId, figmaTransport);
    const data = await connector.fetchBillingData();

    assert.equal(data.vendorId, "vendor_figma");
    // 2 design seats * 75 = 150, 1 dev mode * 25 = 25, 1 figjam * 5 = 5 -> total 180
    assert.equal(data.monthlySpendUsdc, 180.0);
    assert.equal(data.optimalPaymentRail, "MODULAR_SESSION_KEY");
    assert.ok(data.discoveredCostCenters.some((c) => c.suggestedRole === "OPEX_DESIGN"));
  });

  it("11. Loud Failure Enforcer (Rule 5): Connectors throw MissingVendorCredentialsError if credentials missing", async () => {
    const unauthedCompany = "cmp_unauthenticated_tenant_999";
    const awsConn = new AwsBillingConnector(unauthedCompany);
    const ghConn = new GithubBillingConnector(unauthedCompany);
    const openAiConn = new OpenAiBillingConnector(unauthedCompany);

    await assert.rejects(
      async () => await awsConn.fetchBillingData(),
      (err: any) => {
        assert.ok(err instanceof MissingVendorCredentialsError);
        assert.equal(err.vendorName, "AWS");
        return true;
      }
    );

    await assert.rejects(
      async () => await ghConn.fetchBillingData(),
      (err: any) => {
        assert.ok(err instanceof MissingVendorCredentialsError);
        assert.equal(err.vendorName, "GitHub Enterprise");
        return true;
      }
    );

    await assert.rejects(
      async () => await openAiConn.fetchBillingData(),
      (err: any) => {
        assert.ok(err instanceof MissingVendorCredentialsError);
        assert.equal(err.vendorName, "OpenAI");
        return true;
      }
    );
  });

  it("12. VendorBillingAggregator successfully aggregates all 10 major vendor connectors simultaneously", async () => {
    const aggregator = new VendorBillingAggregator(companyId, {
      AWS: awsTransport,
      GITHUB: githubTransport,
      DATADOG: datadogTransport,
      GCP: gcpTransport,
      AZURE: azureTransport,
      OPENAI: openAiTransport,
      STRIPE: stripeTransport,
      SNOWFLAKE: snowflakeTransport,
      TWILIO: twilioTransport,
      FIGMA: figmaTransport,
    });

    const summary = await aggregator.aggregateAllVendors();

    assert.equal(summary.companyId, companyId);
    assert.equal(summary.vendors.length, 10);
    assert.equal(summary.aggregatedInvoices.length, 10);
    assert.ok(summary.aggregatedCostCenters.length >= 10);

    // Verify sum of monthly spend across all 10
    // 14850 + 2385 + 4250.5 + 8950 + 7450 + 3120 + 2150 + 7500 + 1450 + 180 = 52285.50
    assert.equal(summary.totalMonthlySpendUsdc, 52285.5);
    assert.ok(summary.totalForecastedMonthlySpendUsdc > summary.totalMonthlySpendUsdc);

    // Verify payment rail distribution covers all 4 rails across the 10 vendors
    assert.ok(summary.railDistribution["DISBURSAL_VAULT"] >= 4); // AWS, GCP, Azure, Snowflake
    assert.ok(summary.railDistribution["MODULAR_SESSION_KEY"] >= 4); // GitHub, Datadog, Twilio, Figma
    assert.ok(summary.railDistribution["GATEWAY_X402"] >= 1); // OpenAI
    assert.ok(summary.railDistribution["ERC3009_AUTHORIZATION"] >= 1); // Stripe
  });
});
