// External links shown in the UI.
export const LINKS = {
  officialCalculator: "https://azure.microsoft.com/pricing/calculator/",
  calculatorGuide: "https://learn.microsoft.com/azure/cost-management-billing/costs/pricing-calculator",
  retailPricesApi: "https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices",
  exporter: "https://github.com/sbroenne/azureretailprices-exporter",
  exporterReleases: "https://github.com/sbroenne/azureretailprices-exporter/releases",
  architectureIcons: "https://learn.microsoft.com/azure/architecture/icons/",
  /** Icon provenance and terms, published with the site (web/public/icons/README.md). */
  iconsReadme: `${import.meta.env.BASE_URL}icons/README.md`,
  savingsPlans: "https://learn.microsoft.com/azure/cost-management-billing/savings-plan/savings-plan-compute-overview",
  hybridBenefit: "https://azure.microsoft.com/pricing/hybrid-benefit/",
} as const;
