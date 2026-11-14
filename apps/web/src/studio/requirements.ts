const LABELS: Record<string, string> = {
  'shop settings': 'Shop settings have not been saved',
  'seller.legalName': 'Seller legal name',
  'seller.address': 'Seller address',
  'seller.contactEmail': 'Seller contact email',
  'legal.terms': 'Terms of sale page',
  'legal.privacy': 'Privacy notice page',
  'legal.refund': 'Refund policy page',
  digitalDeliveryConsent: 'Digital delivery consent wording',
  taxMode: 'Tax setting (choose no tax or Stripe Tax)',
};

/** Plain-language label for a missing launch requirement key from GET /api/owner/overview. */
export function requirementLabel(key: string): string {
  return LABELS[key] ?? key;
}
