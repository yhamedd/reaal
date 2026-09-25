import { all, get, run, tx, type DB } from '../db.js';
import type { AuthUser } from '../auth.js';
import { normalizePhone, isValidPhone } from '../../shared/phone.js';
import { parseLooseNumber } from '../../shared/format.js';
import { UNIT_STATUSES, OWNER_STATUSES, FURNISHING } from '../../shared/constants.js';
import { normalizeUnitNumber } from '../util.js';
import { canonicalValue, ensureDeveloper, ensureProject, findDeveloper, findProject } from './masterData.js';
import { insertUnit } from '../routes/units.js';
import { insertOwner } from '../routes/owners.js';
import { logActivity } from '../activity.js';
import { cleanAddress, cleanArabicName, cleanPersonName, combinePhone, isPhonePlaceholder, parseLocationCode } from './importParsing.js';

export type ImportKind = 'inventory' | 'owners';

export interface TargetField {
  key: string;
  label: string;
  kinds: ImportKind[];
  type: 'text' | 'number' | 'int' | 'phone' | 'date' | 'email';
  required?: boolean;
  synonyms: string[];
}

export const TARGET_FIELDS: TargetField[] = [
  { key: 'owner_name', label: 'Owner name', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['ownername', 'owner', 'clientname', 'client', 'name', 'fullname', 'seller', 'sellername', 'accountname', 'customername', 'اسمالمالك', 'المالك', 'الاسم'] },
  { key: 'owner_name_ar', label: 'Owner name (Arabic)', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['ownernamearabic', 'accountnamearabic', 'namearabic', 'arabicname', 'namear', 'الاسمبالعربي', 'الاسمعربي'] },
  { key: 'primary_phone', label: 'Primary phone', kinds: ['inventory', 'owners'], type: 'phone', synonyms: ['mobile', 'phone', 'primaryphone', 'phone1', 'mobile1', 'tel', 'telephone', 'phonenumber', 'mobilenumber', 'number', 'الموبايل', 'رقمالموبايل', 'التليفون', 'الهاتف'] },
  { key: 'phone_country_code', label: 'Phone country code', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['phonecountrycode', 'phonecc', 'countrycode'] },
  { key: 'mobile_country_code', label: 'Mobile country code', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['mobilecountrycode', 'mobilecc'] },
  { key: 'secondary_phone', label: 'Secondary phone', kinds: ['inventory', 'owners'], type: 'phone', synonyms: ['phone2', 'mobile2', 'secondaryphone', 'otherphone', 'altphone', 'alternativephone', 'secondphone'] },
  { key: 'whatsapp', label: 'WhatsApp number', kinds: ['inventory', 'owners'], type: 'phone', synonyms: ['whatsapp', 'whatsappnumber', 'wa', 'واتساب'] },
  { key: 'owner_email', label: 'Owner email', kinds: ['inventory', 'owners'], type: 'email', synonyms: ['email', 'mail', 'emailaddress', 'owneremail'] },
  { key: 'owner_address', label: 'Owner address', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['address', 'addressdisplay', 'owneraddress', 'mailingaddress', 'العنوان'] },
  { key: 'location_code', label: 'Location code (project + phase + unit)', kinds: ['inventory'], type: 'text', synonyms: ['locationcode', 'unitlocation', 'propertycode', 'unitfullcode'] },
  { key: 'developer', label: 'Developer', kinds: ['inventory'], type: 'text', synonyms: ['developer', 'dev', 'developername', 'المطور'] },
  { key: 'project', label: 'Project', kinds: ['inventory'], type: 'text', required: true, synonyms: ['project', 'compound', 'projectname', 'community', 'propertyname', 'propertyinventorypropertyname', 'المشروع', 'الكمبوند'] },
  { key: 'phase', label: 'Phase', kinds: ['inventory'], type: 'text', synonyms: ['phase', 'parcel', 'zone', 'cluster', 'المرحلة'] },
  { key: 'unit_number', label: 'Unit number', kinds: ['inventory'], type: 'text', synonyms: ['unit', 'unitno', 'unitnumber', 'unitcode', 'villano', 'villanumber', 'aptno', 'apartmentno', 'رقمالوحدة', 'الوحدة'] },
  { key: 'property_type', label: 'Property type', kinds: ['inventory'], type: 'text', synonyms: ['type', 'propertytype', 'unittype', 'category', 'نوعالوحدة', 'النوع'] },
  { key: 'bua', label: 'BUA', kinds: ['inventory'], type: 'number', synonyms: ['bua', 'builtup', 'builtuparea', 'size', 'sqm', 'المساحة'] },
  { key: 'land_area', label: 'Land area', kinds: ['inventory'], type: 'number', synonyms: ['land', 'landarea', 'plot', 'plotarea', 'الارض', 'مساحةالارض'] },
  { key: 'bedrooms', label: 'Bedrooms', kinds: ['inventory'], type: 'int', synonyms: ['bedrooms', 'beds', 'rooms', 'br', 'bedroom', 'غرف', 'الغرف'] },
  { key: 'bathrooms', label: 'Bathrooms', kinds: ['inventory'], type: 'int', synonyms: ['bathrooms', 'baths', 'bathroom', 'حمامات'] },
  { key: 'floors', label: 'Floors', kinds: ['inventory'], type: 'int', synonyms: ['floors', 'floor', 'levels', 'الدور'] },
  { key: 'finishing', label: 'Finishing', kinds: ['inventory'], type: 'text', synonyms: ['finishing', 'finish', 'التشطيب'] },
  { key: 'furnished', label: 'Furnishing', kinds: ['inventory'], type: 'text', synonyms: ['furnished', 'furnishing', 'furniture'] },
  { key: 'view', label: 'View', kinds: ['inventory'], type: 'text', synonyms: ['view', 'الفيو'] },
  { key: 'location', label: 'Location', kinds: ['inventory'], type: 'text', synonyms: ['location', 'area', 'region', 'city', 'الموقع', 'المنطقة'] },
  { key: 'delivery', label: 'Delivery', kinds: ['inventory'], type: 'text', synonyms: ['delivery', 'deliverydate', 'handover', 'الاستلام', 'التسليم'] },
  { key: 'asking_price', label: 'Asking price', kinds: ['inventory'], type: 'number', synonyms: ['price', 'askingprice', 'asking', 'totalprice', 'sellingprice', 'السعر'] },
  { key: 'original_price', label: 'Original price', kinds: ['inventory'], type: 'number', synonyms: ['originalprice', 'developerprice', 'basicprice', 'original', 'السعرالاصلي'] },
  { key: 'paid_amount', label: 'Paid amount', kinds: ['inventory'], type: 'number', synonyms: ['paid', 'paidamount', 'downpayment', 'المدفوع'] },
  { key: 'remaining_amount', label: 'Remaining amount', kinds: ['inventory'], type: 'number', synonyms: ['remaining', 'remainingamount', 'installments', 'balance', 'المتبقي'] },
  { key: 'maintenance', label: 'Maintenance', kinds: ['inventory'], type: 'number', synonyms: ['maintenance', 'maintenancefee', 'الصيانة'] },
  { key: 'payment_notes', label: 'Payment notes', kinds: ['inventory'], type: 'text', synonyms: ['paymentnotes', 'paymentplan', 'payment', 'نظامالسداد'] },
  { key: 'status', label: 'Status', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['status', 'availability', 'الحالة'] },
  { key: 'agent', label: 'Assigned agent (name or email)', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['agent', 'assignedagent', 'assignedto', 'broker', 'salesperson', 'sales', 'owneragent'] },
  { key: 'source', label: 'Source', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['source', 'leadsource', 'المصدر'] },
  { key: 'last_verified', label: 'Last verified', kinds: ['inventory'], type: 'date', synonyms: ['lastverified', 'verified', 'verifieddate', 'verificationdate'] },
  { key: 'notes', label: 'Notes', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['notes', 'comments', 'remarks', 'note', 'comment', 'ملاحظات'] },
  { key: 'tags', label: 'Tags (comma separated)', kinds: ['inventory', 'owners'], type: 'text', synonyms: ['tags', 'labels', 'tag'] },
];

export function fieldsFor(kind: ImportKind) {
  return TARGET_FIELDS.filter((f) => f.kinds.includes(kind)).map((f) => ({
    ...f,
    required: kind === 'owners' ? f.key === 'owner_name' : !!f.required,
  }));
}

const normHeader = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}#]/gu, '');

export function suggestMapping(headers: string[], kind: ImportKind): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const fields = fieldsFor(kind);
  // With both "Phone" and "Mobile" columns, the mobile is the primary number (it's the one on WhatsApp).
  const normed = headers.map(normHeader);
  const mobileIdx = normed.findIndex((n) => ['mobile', 'mobilenumber', 'mobile1', 'الموبايل'].includes(n));
  const phoneIdx = normed.findIndex((n) => ['phone', 'phonenumber', 'tel', 'telephone', 'التليفون', 'الهاتف'].includes(n));
  if (mobileIdx >= 0 && phoneIdx >= 0) {
    mapping[headers[mobileIdx]] = 'primary_phone';
    mapping[headers[phoneIdx]] = 'secondary_phone';
    used.add('primary_phone');
    used.add('secondary_phone');
  }
  // exact synonym matches first, then "contains" matches
  for (const pass of ['exact', 'contains'] as const) {
    for (const h of headers) {
      if (mapping[h]) continue;
      const n = normHeader(h);
      if (!n) continue;
      const field = fields.find(
        (f) => !used.has(f.key) && (pass === 'exact' ? f.synonyms.includes(n) || normHeader(f.label) === n || f.key.replace(/_/g, '') === n : f.synonyms.some((s) => s.length >= 5 && n.includes(s))),
      );
      if (field) {
        mapping[h] = field.key;
        used.add(field.key);
      }
    }
  }
  return mapping;
}

const STATUS_SYNONYMS: Record<string, string> = {
  available: 'Available', avail: 'Available', 'for sale': 'Available', متاح: 'Available', open: 'Available',
  reserved: 'Reserved', hold: 'Reserved', 'on hold': 'Reserved', محجوز: 'Reserved',
  sold: 'Sold', مباع: 'Sold', closed: 'Sold',
  'off market': 'Off Market', offmarket: 'Off Market', withdrawn: 'Off Market',
  pending: 'Pending Verification', 'pending verification': 'Pending Verification', unverified: 'Pending Verification',
  archived: 'Archived',
};

function parseDate(v: string): string | null | undefined {
  if (!v) return undefined;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const serial = Number(v);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export interface RowResult {
  row: number;
  status: 'ready' | 'duplicate' | 'error';
  errors: string[];
  warnings: string[];
  data: Record<string, any>;
  duplicate_unit_id?: number | null;
  duplicate_owner_id?: number | null;
  owner_match_id?: number | null;
  owner_key?: string | null;
}

export interface ValidationSummary {
  total: number;
  ready: number;
  duplicates: number;
  errors: number;
  warnings: number;
  new_projects: string[];
  new_developers: string[];
  ignored_columns: string[];
  missing_required: string[];
}

/** Values applied to rows that don't specify them (chosen on the mapping step). */
export interface ImportOptions {
  developer?: string | null;
  location?: string | null;
  status?: string | null;
}

export function validateRows(db: DB, kind: ImportKind, headers: string[], rows: Record<string, string>[], mapping: Record<string, string>, options: ImportOptions = {}) {
  const fields = fieldsFor(kind);
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const inverse = new Map<string, string>(); // target → header
  for (const [h, t] of Object.entries(mapping)) if (t && fieldByKey.has(t) && headers.includes(h)) inverse.set(t, h);
  const ignored = headers.filter((h) => !mapping[h] || !fieldByKey.has(mapping[h]));
  // A location code carries the project, so it satisfies the "Project" requirement.
  const missingRequired = fields
    .filter((f) => f.required && !inverse.has(f.key) && !(f.key === 'project' && inverse.has('location_code')))
    .map((f) => f.label);
  const projectNames = all<{ name: string }>(db, 'SELECT name FROM projects').map((p) => p.name);
  // Pair each phone column with its country-code column ("Mobile" ↔ "Mobile Country Code").
  const ccFor = (key: string) => {
    const header = normHeader(inverse.get(key) ?? '');
    const pref = header.includes('mobile') ? ['mobile_country_code', 'phone_country_code'] : ['phone_country_code', 'mobile_country_code'];
    return pref.find((k) => inverse.has(k));
  };
  const status = options.status ? UNIT_STATUSES.find((s) => s.toLowerCase() === String(options.status).toLowerCase()) : undefined;

  const users = all<{ id: number; name: string; email: string }>(db, "SELECT id, name, email FROM users WHERE status = 'active'");
  const tagNames = new Map(all<{ id: number; name: string }>(db, 'SELECT id, name FROM tags').map((t) => [t.name.toLowerCase(), t.id]));
  const newProjects = new Set<string>();
  const newDevelopers = new Set<string>();
  const seenUnits = new Map<string, number>();
  const seenOwnerPhones = new Map<string, { key: string; row: number }>();
  const results: RowResult[] = [];

  rows.forEach((raw, idx) => {
    const r: RowResult = { row: idx + 2, status: 'ready', errors: [], warnings: [], data: {} };
    const val = (key: string) => {
      const h = inverse.get(key);
      return h ? String(raw[h] ?? '').trim() : '';
    };
    for (const f of fields) {
      const v = val(f.key);
      if (!inverse.has(f.key)) continue;
      if (!v) {
        if (f.required) r.errors.push(`Missing ${f.label}`);
        continue;
      }
      switch (f.type) {
        case 'number':
        case 'int': {
          const n = parseLooseNumber(v);
          if (n === undefined) break;
          if (Number.isNaN(n) || n < 0) r.errors.push(`Invalid number in ${f.label}: “${v}”`);
          else r.data[f.key] = f.type === 'int' ? Math.round(n) : n;
          break;
        }
        case 'phone': {
          const ccKey = ccFor(f.key);
          const { phone, extra } = combinePhone(ccKey ? val(ccKey) : null, v);
          // A bad number is dropped with a warning; the owner and unit still import.
          if (!phone || !isValidPhone(phone)) {
            if (/\d{3,}/.test(v) && !isPhonePlaceholder(v)) r.warnings.push(`Invalid phone number in ${f.label}: “${v}” – skipped`);
          } else r.data[f.key] = phone;
          if (extra) r.data.__extra_phone = extra;
          break;
        }
        case 'email':
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) r.warnings.push(`Email “${v}” looks invalid and was skipped`);
          else r.data[f.key] = v.toLowerCase();
          break;
        case 'date': {
          const d = parseDate(v);
          if (d === null) r.warnings.push(`Unrecognised date in ${f.label}: “${v}”`);
          else if (d) r.data[f.key] = d;
          break;
        }
        default:
          if (f.key === 'owner_name') {
            const n = cleanPersonName(v);
            if (n) r.data[f.key] = n;
          } else if (f.key === 'owner_name_ar') {
            const ar = cleanArabicName(v);
            if (ar) r.data[f.key] = ar;
          } else if (f.key === 'owner_address') {
            const a = cleanAddress(v);
            if (a) r.data[f.key] = a;
          } else if (f.key !== 'phone_country_code' && f.key !== 'mobile_country_code') {
            r.data[f.key] = v;
          }
      }
    }
    if (r.data.__extra_phone) {
      if (!r.data.secondary_phone && r.data.__extra_phone !== r.data.primary_phone) r.data.secondary_phone = r.data.__extra_phone;
      delete r.data.__extra_phone;
    }
    if (r.data.secondary_phone && normalizePhone(r.data.secondary_phone) === normalizePhone(r.data.primary_phone)) delete r.data.secondary_phone;
    if (!r.data.primary_phone && r.data.secondary_phone) {
      r.data.primary_phone = r.data.secondary_phone;
      delete r.data.secondary_phone;
    }

    // Location code → project, phase, unit number and (when recognisable) property type
    if (r.data.location_code) {
      const parsed = parseLocationCode(String(r.data.location_code), projectNames, r.data.project);
      if (!parsed) r.warnings.push(`Could not read location code “${r.data.location_code}”`);
      else {
        if (!r.data.project && parsed.project) r.data.project = parsed.project;
        if (!r.data.project) r.errors.push(`Location code “${r.data.location_code}” doesn't start with a known project`);
        if (!r.data.phase && parsed.phase) r.data.phase = parsed.phase;
        if (!r.data.unit_number) r.data.unit_number = parsed.unit_number;
        if (!r.data.property_type && parsed.property_type) r.data.property_type = parsed.property_type;
      }
      delete r.data.location_code;
      if (r.data.project) r.errors = r.errors.filter((e) => e !== 'Missing Project');
    }
    if (kind === 'inventory') {
      if (!r.data.developer && options.developer) r.data.developer = options.developer;
      if (!r.data.location && options.location) r.data.location = options.location;
      if (!r.data.status && status) r.data.status = status;
    }

    // Status
    if (r.data.status) {
      const s = String(r.data.status);
      if (kind === 'inventory') {
        const match = UNIT_STATUSES.find((x) => x.toLowerCase() === s.toLowerCase()) ?? STATUS_SYNONYMS[s.toLowerCase()];
        if (match) r.data.status = match;
        else {
          r.warnings.push(`Unknown status “${s}” – will be set to Pending Verification`);
          r.data.status = 'Pending Verification';
        }
      } else {
        const match = OWNER_STATUSES.find((x) => x.toLowerCase() === s.toLowerCase());
        if (match) r.data.status = match;
        else {
          r.warnings.push(`Unknown owner status “${s}” – will be set to Active`);
          r.data.status = 'Active';
        }
      }
    }
    if (r.data.furnished) {
      const f = FURNISHING.find((x) => x.toLowerCase() === String(r.data.furnished).toLowerCase());
      if (f) r.data.furnished = f;
      else {
        r.warnings.push(`Unknown furnishing “${r.data.furnished}” ignored`);
        delete r.data.furnished;
      }
    }

    // Agent
    if (r.data.agent) {
      const a = String(r.data.agent).toLowerCase();
      const u = users.find((x) => x.email.toLowerCase() === a || x.name.toLowerCase() === a);
      if (u) r.data.assigned_user_id = u.id;
      else r.warnings.push(`Agent “${r.data.agent}” not found – left unassigned`);
    }

    // Tags
    if (r.data.tags) {
      const ids: number[] = [];
      for (const t of String(r.data.tags).split(/[,;|]/).map((s) => s.trim()).filter(Boolean)) {
        const id = tagNames.get(t.toLowerCase());
        if (id) ids.push(id);
        else r.warnings.push(`Unknown tag “${t}” ignored`);
      }
      r.data.tag_ids = ids;
    }

    // Owner matching (by any phone number)
    const phones = ['primary_phone', 'secondary_phone', 'whatsapp'].map((k) => normalizePhone(r.data[k])).filter((p) => p.length >= 7);
    if (phones.length) {
      const ph = phones.map(() => '?').join(',');
      const existing = get<any>(
        db,
        `SELECT id, name FROM owners WHERE primary_phone_norm IN (${ph}) OR secondary_phone_norm IN (${ph}) OR whatsapp_norm IN (${ph}) LIMIT 1`,
        [...phones, ...phones, ...phones],
      );
      if (existing) {
        r.owner_match_id = existing.id;
        if (kind === 'owners') {
          r.duplicate_owner_id = existing.id;
          r.status = 'duplicate';
          r.warnings.push(`Owner already exists: ${existing.name}`);
        } else if (r.data.owner_name && existing.name.toLowerCase() !== String(r.data.owner_name).toLowerCase()) {
          r.warnings.push(`Phone belongs to existing owner “${existing.name}” – unit will be linked to them`);
        }
      } else {
        // Rows sharing any phone number belong to the same (new) owner.
        const seen = phones.map((p) => seenOwnerPhones.get(p)).find(Boolean);
        if (seen && kind === 'owners') {
          r.status = 'duplicate';
          r.warnings.push(`Same phone as row ${seen.row}`);
        }
        const key = seen?.key ?? phones[0];
        for (const p of phones) if (!seenOwnerPhones.has(p)) seenOwnerPhones.set(p, { key, row: r.row });
        r.owner_key = key;
      }
    } else if (r.data.owner_name) {
      const byName = get<any>(db, 'SELECT id, name FROM owners WHERE TRIM(name) = ? COLLATE NOCASE LIMIT 1', [String(r.data.owner_name).trim()]);
      if (byName) {
        r.owner_match_id = byName.id;
        if (kind === 'owners') {
          r.status = 'duplicate';
          r.duplicate_owner_id = byName.id;
          r.warnings.push(`An owner named “${byName.name}” already exists`);
        } else {
          r.warnings.push(`No phone – matched existing owner by name “${byName.name}”`);
        }
      }
      r.owner_key = r.owner_key ?? `name:${String(r.data.owner_name).trim().toLowerCase()}`;
    } else if (kind === 'inventory') {
      r.warnings.push('No owner information');
    }

    if (kind === 'inventory') {
      // Master data
      if (r.data.developer && !findDeveloper(db, r.data.developer)) newDevelopers.add(String(r.data.developer));
      const project = r.data.project ? findProject(db, r.data.project) : null;
      if (r.data.project && !project) {
        newProjects.add(String(r.data.project));
        r.warnings.push(`New project “${r.data.project}” will be created`);
      }
      if (r.data.property_type) {
        const canonical = canonicalValue(db, 'property_type', r.data.property_type);
        if (canonical) r.data.property_type = canonical;
        else r.warnings.push(`Property type “${r.data.property_type}” is not in the master list`);
      }
      if (r.data.finishing) r.data.finishing = canonicalValue(db, 'finishing', r.data.finishing) ?? r.data.finishing;

      // Duplicate property detection
      const unitNo = normalizeUnitNumber(r.data.unit_number);
      if (!unitNo) r.warnings.push('No unit number – duplicates cannot be detected');
      if (unitNo && r.data.project) {
        // Same unit number in different phases is a different unit (Marassi reuses V-V-153 across neighbourhoods).
        const phase = String(r.data.phase ?? '').trim().toLowerCase();
        const key = `${String(r.data.project).toLowerCase()}|${phase}|${unitNo}`;
        if (project) {
          const dup = get<any>(
            db,
            `SELECT id FROM units WHERE project_id = ? AND unit_number_norm = ? AND archived_at IS NULL
               AND (? = '' OR phase IS NULL OR TRIM(phase) = '' OR LOWER(TRIM(phase)) = ?) LIMIT 1`,
            [project.id, unitNo, phase, phase],
          );
          if (dup) {
            r.duplicate_unit_id = dup.id;
            r.status = 'duplicate';
            r.warnings.push(`Unit already exists in inventory (U-${String(dup.id).padStart(5, '0')})`);
          }
        }
        const prev = seenUnits.get(key);
        if (prev && r.status !== 'duplicate') {
          r.status = 'duplicate';
          r.warnings.push(`Same project and unit as row ${prev}`);
        }
        if (!prev) seenUnits.set(key, r.row);
      }
    }

    if (r.errors.length) r.status = 'error';
    results.push(r);
  });

  if (missingRequired.length) {
    for (const r of results) {
      if (!r.errors.some((e) => e.startsWith('Missing'))) r.errors.unshift(...missingRequired.map((m) => `Missing ${m}`));
      r.status = 'error';
    }
  }

  const summary: ValidationSummary = {
    total: results.length,
    ready: results.filter((r) => r.status === 'ready').length,
    duplicates: results.filter((r) => r.status === 'duplicate').length,
    errors: results.filter((r) => r.status === 'error').length,
    warnings: results.filter((r) => r.warnings.length).length,
    new_projects: [...newProjects],
    new_developers: [...newDevelopers],
    ignored_columns: ignored,
    missing_required: missingRequired,
  };
  return { summary, results };
}

export type DuplicatePolicy = 'skip' | 'create' | 'update';

const UNIT_KEYS = ['phase', 'unit_number', 'property_type', 'bua', 'land_area', 'bedrooms', 'bathrooms', 'floors', 'finishing', 'furnished', 'view', 'location', 'delivery', 'asking_price', 'original_price', 'paid_amount', 'remaining_amount', 'maintenance', 'payment_notes', 'status', 'assigned_user_id', 'source', 'last_verified'];

export function executeImport(db: DB, user: AuthUser, importId: number, kind: ImportKind, results: RowResult[], policy: DuplicatePolicy, filename: string) {
  const counts = { created_units: 0, updated_units: 0, created_owners: 0, linked_owners: 0, updated_owners: 0, skipped: 0, errors: 0 };
  tx(db, () => {
    const ownerCache = new Map<string, number>();
    const resolveOwner = (r: RowResult): number | null => {
      if (r.owner_match_id) {
        counts.linked_owners++;
        // Fill in details the existing owner record is missing, never overwrite.
        if (r.data.owner_name_ar || r.data.owner_address) {
          run(db, 'UPDATE owners SET name_ar = COALESCE(name_ar, ?), address = COALESCE(address, ?) WHERE id = ?', [r.data.owner_name_ar ?? null, r.data.owner_address ?? null, r.owner_match_id]);
        }
        return r.owner_match_id;
      }
      if (!r.data.owner_name && !r.data.primary_phone) return null;
      if (r.owner_key && ownerCache.has(r.owner_key)) return ownerCache.get(r.owner_key)!;
      const id = insertOwner(db, user, {
        name: r.data.owner_name || 'Unknown owner',
        primary_phone: r.data.primary_phone ?? r.data.whatsapp ?? null,
        secondary_phone: r.data.secondary_phone ?? null,
        whatsapp: r.data.whatsapp ?? null,
        email: r.data.owner_email ?? null,
        name_ar: r.data.owner_name_ar ?? null,
        address: r.data.owner_address ?? null,
        source: r.data.source ?? 'Import',
        assigned_user_id: r.data.assigned_user_id ?? null,
        status: kind === 'owners' ? r.data.status ?? 'Active' : 'Active',
      });
      counts.created_owners++;
      if (r.owner_key) ownerCache.set(r.owner_key, id);
      return id;
    };
    const addNoteAndTags = (entityType: string, id: number, r: RowResult) => {
      if (r.data.notes) run(db, 'INSERT INTO notes (entity_type, entity_id, content, author_id) VALUES (?, ?, ?, ?)', [entityType, id, `Imported note: ${r.data.notes}`, user.id]);
      for (const t of r.data.tag_ids ?? []) run(db, 'INSERT OR IGNORE INTO taggings (tag_id, entity_type, entity_id) VALUES (?, ?, ?)', [t, entityType, id]);
    };

    for (const r of results) {
      if (r.status === 'error') {
        counts.errors++;
        continue;
      }
      if (r.status === 'duplicate' && policy === 'skip') {
        counts.skipped++;
        continue;
      }
      if (kind === 'owners') {
        if (r.status === 'duplicate' && policy === 'update' && r.duplicate_owner_id) {
          const patch: Record<string, any> = {};
          if (r.data.secondary_phone) patch.secondary_phone = r.data.secondary_phone;
          if (r.data.whatsapp) patch.whatsapp = r.data.whatsapp;
          if (r.data.owner_email) patch.email = r.data.owner_email;
          if (r.data.source) patch.source = r.data.source;
          if (r.data.assigned_user_id) patch.assigned_user_id = r.data.assigned_user_id;
          if (Object.keys(patch).length) {
            if (patch.secondary_phone) patch.secondary_phone_norm = normalizePhone(patch.secondary_phone);
            if (patch.whatsapp) patch.whatsapp_norm = normalizePhone(patch.whatsapp);
            const cols = Object.keys(patch);
            run(db, `UPDATE owners SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, [...cols.map((k) => patch[k]), r.duplicate_owner_id]);
          }
          addNoteAndTags('owner', r.duplicate_owner_id, r);
          counts.updated_owners++;
          continue;
        }
        const id = insertOwner(db, user, {
          name: r.data.owner_name,
          primary_phone: r.data.primary_phone ?? r.data.whatsapp ?? null,
          secondary_phone: r.data.secondary_phone ?? null,
          whatsapp: r.data.whatsapp ?? null,
          email: r.data.owner_email ?? null,
          name_ar: r.data.owner_name_ar ?? null,
          address: r.data.owner_address ?? null,
          source: r.data.source ?? 'Import',
          assigned_user_id: r.data.assigned_user_id ?? null,
          status: r.data.status ?? 'Active',
        });
        counts.created_owners++;
        addNoteAndTags('owner', id, r);
        continue;
      }

      // Inventory
      const developerId = r.data.developer ? ensureDeveloper(db, r.data.developer) : null;
      const project = r.data.project ? ensureProject(db, r.data.project, developerId) : null;
      const ownerId = resolveOwner(r);
      const unitData: Record<string, any> = {};
      for (const k of UNIT_KEYS) if (r.data[k] !== undefined) unitData[k] = r.data[k];
      unitData.project_id = project?.id ?? null;
      unitData.developer_id = project?.developer_id ?? developerId;
      if (ownerId) unitData.owner_id = ownerId;
      if (!unitData.source) unitData.source = 'Import';
      // Imported units stay unassigned unless the sheet names an agent; assign them in bulk later.
      if (unitData.assigned_user_id === undefined) unitData.assigned_user_id = null;
      if (!unitData.location && project) unitData.location = get<{ location: string | null }>(db, 'SELECT location FROM projects WHERE id = ?', [project.id])?.location ?? null;

      if (r.status === 'duplicate' && policy === 'update' && r.duplicate_unit_id) {
        const keys = Object.keys(unitData).filter((k) => unitData[k] !== null && unitData[k] !== undefined && k !== 'source');
        if (keys.includes('unit_number')) unitData.unit_number_norm = normalizeUnitNumber(unitData.unit_number);
        const setKeys = keys.includes('unit_number') ? [...keys, 'unit_number_norm'] : keys;
        if (setKeys.length) {
          run(db, `UPDATE units SET ${setKeys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, [...setKeys.map((k) => unitData[k]), r.duplicate_unit_id]);
        }
        addNoteAndTags('unit', r.duplicate_unit_id, r);
        counts.updated_units++;
        continue;
      }
      const id = insertUnit(db, user, unitData);
      addNoteAndTags('unit', id, r);
      counts.created_units++;
    }

    run(db, "UPDATE imports SET status = 'completed', result = ?, completed_at = datetime('now'), rows = '[]' WHERE id = ?", [JSON.stringify(counts), importId]);
    const parts = [
      counts.created_units && `${counts.created_units} units created`,
      counts.updated_units && `${counts.updated_units} units updated`,
      counts.created_owners && `${counts.created_owners} owners created`,
      counts.updated_owners && `${counts.updated_owners} owners updated`,
      counts.skipped && `${counts.skipped} duplicates skipped`,
      counts.errors && `${counts.errors} rows with errors skipped`,
    ].filter(Boolean);
    logActivity(db, {
      userId: user.id,
      action: 'import_completed',
      entityType: 'import',
      entityId: importId,
      label: filename,
      message: `imported ${filename}: ${parts.join(', ') || 'no changes'}`,
    });
    run(db, 'INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)', [user.id, 'import', `Import of ${filename} completed – ${parts.join(', ') || 'no changes'}`, '/imports']);
  });
  return counts;
}
