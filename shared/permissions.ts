// Catalogue of granular permissions. Roles are simply named bundles of these
// keys and can be edited from Settings → Roles, so access is never hard-wired
// to the three default roles.

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { key: 'owners.view', label: 'View owners', group: 'Owners' },
  { key: 'owners.contact', label: 'See owner phone numbers & email', group: 'Owners' },
  { key: 'owners.create', label: 'Create owners', group: 'Owners' },
  { key: 'owners.edit', label: 'Edit owners', group: 'Owners' },
  { key: 'owners.delete', label: 'Archive owners', group: 'Owners' },
  { key: 'owners.export', label: 'Export owners', group: 'Owners' },

  { key: 'inventory.view', label: 'View inventory', group: 'Inventory' },
  { key: 'inventory.create', label: 'Create units', group: 'Inventory' },
  { key: 'inventory.edit', label: 'Edit units', group: 'Inventory' },
  { key: 'inventory.bulk_edit', label: 'Bulk update units', group: 'Inventory' },
  { key: 'inventory.delete', label: 'Archive units', group: 'Inventory' },
  { key: 'inventory.export', label: 'Export inventory', group: 'Inventory' },

  { key: 'requirements.view', label: 'View requests', group: 'Requests' },
  { key: 'requirements.manage', label: 'Create & edit requests', group: 'Requests' },
  { key: 'requirements.export', label: 'Export requests', group: 'Requests' },

  { key: 'offers.create', label: 'Create offers', group: 'Offers' },
  { key: 'offers.view_all', label: "View everyone's offers", group: 'Offers' },

  { key: 'imports.run', label: 'Import spreadsheets', group: 'Data' },
  { key: 'records.purge', label: 'Permanently delete records', group: 'Data' },

  { key: 'users.manage', label: 'Manage team members', group: 'Administration' },
  { key: 'roles.manage', label: 'Manage roles & permissions', group: 'Administration' },
  { key: 'activity.view', label: 'View team activity log', group: 'Administration' },
  { key: 'masterdata.manage', label: 'Manage dropdown values & tags', group: 'Administration' },
  { key: 'templates.manage', label: 'Manage offer templates', group: 'Administration' },
  { key: 'settings.manage', label: 'Manage system settings', group: 'Administration' },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const DEFAULT_ROLES: { key: string; name: string; permissions: string[] }[] = [
  { key: 'super_admin', name: 'Super Admin', permissions: ALL_PERMISSION_KEYS },
  {
    key: 'admin',
    name: 'Admin / Manager',
    permissions: ALL_PERMISSION_KEYS.filter((k) => !['records.purge', 'roles.manage', 'settings.manage'].includes(k)),
  },
  {
    key: 'agent',
    name: 'Agent',
    permissions: [
      'owners.view',
      'owners.contact',
      'owners.create',
      'owners.edit',
      'inventory.view',
      'inventory.create',
      'inventory.edit',
      'requirements.view',
      'requirements.manage',
      'offers.create',
    ],
  },
];
