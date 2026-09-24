// Filter specification for inventory. The same object drives the grid, saved
// views and filtered exports, so what you see is exactly what you export.

export interface UnitFilters {
  q?: string;
  status?: string[];
  developer_ids?: number[];
  project_ids?: number[];
  property_types?: string[];
  finishing?: string[];
  assigned_user_ids?: number[];
  tag_ids?: number[];
  bedrooms_min?: number;
  bedrooms_max?: number;
  bathrooms_min?: number;
  price_min?: number;
  price_max?: number;
  bua_min?: number;
  bua_max?: number;
  land_min?: number;
  land_max?: number;
  phase?: string;
  delivery?: string;
  verification?: ('current' | 'attention' | 'outdated' | 'never')[];
  updated_from?: string;
  updated_to?: string;
  has_media?: boolean;
  mine?: boolean;
  include_archived?: boolean;
}

export interface SortSpec {
  key: string;
  dir: 'asc' | 'desc';
}

export interface GridViewConfig {
  filters: UnitFilters;
  sort: SortSpec[];
  columns?: { key: string; width?: number; hidden?: boolean; pinned?: boolean }[];
}

export function countActiveFilters(f: UnitFilters): number {
  let n = 0;
  for (const [k, v] of Object.entries(f)) {
    if (k === 'q') continue;
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    n++;
  }
  return n;
}
