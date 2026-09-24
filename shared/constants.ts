export const UNIT_STATUSES = ['Available', 'Reserved', 'Sold', 'Off Market', 'Pending Verification', 'Archived'] as const;
export const OWNER_STATUSES = ['Active', 'Inactive', 'Do Not Contact', 'Archived'] as const;
export const REQUIREMENT_STATUSES = ['Active', 'Contacted', 'Matched', 'Closed', 'Inactive'] as const;
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export const FURNISHING = ['Furnished', 'Semi Furnished', 'Unfurnished'] as const;
export const OFFER_TEMPLATES = ['whatsapp', 'short', 'detailed', 'pdf', 'internal'] as const;
export type OfferTemplateKey = (typeof OFFER_TEMPLATES)[number];

export const FILE_CATEGORIES = ['image', 'floor_plan', 'master_plan', 'document'] as const;

/** Master data categories editable in Settings → Master data (besides developers/projects). */
export const MASTER_CATEGORIES: { key: string; label: string }[] = [
  { key: 'property_type', label: 'Property types' },
  { key: 'finishing', label: 'Finishing' },
  { key: 'source', label: 'Lead / listing sources' },
  { key: 'view', label: 'Views' },
];
