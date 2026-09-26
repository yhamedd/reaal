import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { HttpError, can, requirePermission, type AuthUser } from '../auth.js';
import { idList, intParam, likeEscape, maskPhone } from '../util.js';
import { OFFER_TEMPLATES } from '../../shared/constants.js';
import { UNIT_SELECT } from '../services/units.js';
import { renderOffer, sensitiveTokens, type TemplateDef } from '../services/offerText.js';
import { renderOfferPdf, type PdfUnit } from '../services/pdf.js';
import { getSettings } from '../settings.js';
import { logActivity, offerCode, unitLabel } from '../activity.js';
import { readStored } from './files.js';
import type { DB } from '../db.js';

export const offersRouter = Router();

async function loadUnits(db: DB, ids: number[]) {
  if (!ids.length) throw new HttpError(400, 'Select at least one unit');
  if (ids.length > 50) throw new HttpError(400, 'An offer can include at most 50 units');
  const rows = await all<any>(db, `${UNIT_SELECT} WHERE u.id IN (${ids.map(() => '?').join(',')})`, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!ordered.length) throw new HttpError(404, 'Units not found');
  return ordered;
}

async function loadTemplate(db: DB, key: string): Promise<TemplateDef> {
  const t = await get<TemplateDef>(db, 'SELECT * FROM offer_templates WHERE key = ?', [key]);
  if (!t) throw new HttpError(400, 'Unknown template');
  return t;
}

/** Owner details appear only when the template asks for them and the user may see contacts. */
function ownerAllowed(user: AuthUser, template: TemplateDef, requested: unknown) {
  if (!can(user, 'owners.view') || !can(user, 'owners.contact')) return false;
  if (requested === undefined || requested === null) return !!template.include_owner;
  return !!requested;
}

async function globalContext(db: DB, user: AuthUser, clientName?: string | null) {
  const s = await getSettings(db);
  return {
    company_name: s.company.name,
    company_phone: s.company.phone,
    company_email: s.company.email,
    agent_name: user.name,
    agent_phone: user.phone || s.company.phone,
    agent_email: user.email,
    client_name: clientName ?? '',
    date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

offersRouter.get('/templates', requirePermission('offers.create'), async (req, res) => {
  const rows = await all<any>(req.db, 'SELECT key, name, description, include_owner FROM offer_templates');
  const order = OFFER_TEMPLATES as readonly string[];
  rows.sort((a, b) => (order.indexOf(a.key) === -1 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) === -1 ? 99 : order.indexOf(b.key)));
  res.json(rows);
});

offersRouter.post('/generate', requirePermission('offers.create', 'inventory.view'), async (req, res) => {
  const db = req.db;
  const unitIds = idList(req.body?.unit_ids);
  const units = await loadUnits(db, unitIds);
  const template = await loadTemplate(db, String(req.body?.template ?? 'whatsapp'));
  const includeOwner = ownerAllowed(req.user!, template, req.body?.include_owner);
  let clientName: string | null = req.body?.client_name ? String(req.body.client_name).slice(0, 200) : null;
  const requirementId = Number(req.body?.requirement_id) || null;
  if (requirementId && !clientName) {
    clientName = (await get<any>(db, 'SELECT client_name FROM requirements WHERE id = ?', [requirementId]))?.client_name ?? null;
  }
  const currency = (await getSettings(db)).general.currency;
  const content = renderOffer({ template, units, currency, global: await globalContext(db, req.user!, clientName), includeOwner });
  const tokens = sensitiveTokens(units, currency);
  res.json({
    content,
    template: template.key,
    include_owner: includeOwner,
    client_name: clientName,
    tokens: { price: tokens.price, owner: can(req.user, 'owners.contact') ? tokens.owner : [] },
    units: await Promise.all(units.map(async (u) => ({ id: u.id, label: await unitLabel(db, u.id), project: u.project, property_type: u.property_type, asking_price: u.asking_price, status: u.status, image_count: u.image_count }))),
  });
});

offersRouter.post('/', requirePermission('offers.create'), async (req, res) => {
  const db = req.db;
  const unitIds = idList(req.body?.unit_ids);
  await loadUnits(db, unitIds);
  const template = String(req.body?.template ?? '');
  if (!await get(db, 'SELECT 1 FROM offer_templates WHERE key = ?', [template])) throw new HttpError(400, 'Unknown template');
  const content = String(req.body?.content ?? '');
  if (!content.trim()) throw new HttpError(400, 'Offer content is empty');
  if (content.length > 50_000) throw new HttpError(400, 'Offer content is too long');
  const requirementId = Number(req.body?.requirement_id) || null;
  if (requirementId && !await get(db, 'SELECT 1 FROM requirements WHERE id = ?', [requirementId])) throw new HttpError(400, 'Unknown request');
  const clientName = req.body?.client_name ? String(req.body.client_name).slice(0, 200) : null;
  const id = await tx(db, async (db) => {
    const { lastId } = await run(db, 'INSERT INTO offers (created_by, client_name, requirement_id, template, content) VALUES (?, ?, ?, ?, ?)', [
      req.user!.id,
      clientName,
      requirementId,
      template,
      content,
    ]);
    for (const [i, u] of unitIds.entries()) await run(db, 'INSERT INTO offer_units (offer_id, unit_id, position) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [lastId, u, i]);
    const labels: string[] = [];
    for (const u of unitIds) labels.push(await unitLabel(db, u));
    await logActivity(db, {
      userId: req.user!.id,
      action: 'offer_created',
      entityType: 'offer',
      entityId: lastId,
      label: offerCode(lastId),
      message: `generated an offer${clientName ? ` for ${clientName}` : ''} with ${labels.length > 3 ? `${labels.length} units` : labels.join(', ')}`,
    });
    if (requirementId) {
      const r = await get<any>(db, 'SELECT status, client_name FROM requirements WHERE id = ?', [requirementId]);
      if (r?.status === 'Active') {
        await run(db, "UPDATE requirements SET status = 'Contacted', updated_at = datetime('now') WHERE id = ?", [requirementId]);
        await logActivity(db, { userId: req.user!.id, action: 'status_changed', entityType: 'requirement', entityId: requirementId, label: r.client_name, field: 'status', oldValue: 'Active', newValue: 'Contacted', message: `changed ${r.client_name} from Active to Contacted` });
      }
    }
    return lastId;
  });
  res.status(201).json({ id, code: offerCode(id) });
});

offersRouter.get('/', requirePermission('offers.create'), async (req, res) => {
  const db = req.db;
  const clauses: string[] = [];
  const params: any[] = [];
  if (!can(req.user, 'offers.view_all') || req.query.mine === '1') {
    clauses.push('o.created_by = ?');
    params.push(req.user!.id);
  }
  const q = String(req.query.q ?? '').trim();
  if (q) {
    const like = `%${likeEscape(q)}%`;
    clauses.push("(o.client_name ILIKE ? ESCAPE '\\' OR o.content ILIKE ? ESCAPE '\\' OR u.name ILIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  if (req.query.template) {
    clauses.push('o.template = ?');
    params.push(String(req.query.template));
  }
  const unitId = Number(req.query.unit_id);
  if (unitId) {
    clauses.push('o.id IN (SELECT offer_id FROM offer_units WHERE unit_id = ?)');
    params.push(unitId);
  }
  const rows = await all<any>(
    db,
    `SELECT o.id, o.client_name, o.requirement_id, o.template, o.created_at, substr(o.content, 1, 240) AS preview,
            u.name AS created_by_name, r.client_name AS requirement_client,
            (SELECT COUNT(*) FROM offer_units ou WHERE ou.offer_id = o.id) AS unit_count,
            (SELECT string_agg(COALESCE(p.name, '') || ' ' || COALESCE(un.unit_number, ''), ', ')
               FROM offer_units ou JOIN units un ON un.id = ou.unit_id LEFT JOIN projects p ON p.id = un.project_id
              WHERE ou.offer_id = o.id) AS unit_labels
       FROM offers o LEFT JOIN users u ON u.id = o.created_by LEFT JOIN requirements r ON r.id = o.requirement_id
      ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
      ORDER BY o.created_at DESC, o.id DESC LIMIT 500`,
    params,
  );
  res.json(rows.map((r) => ({ ...r, code: offerCode(r.id) })));
});

offersRouter.get('/:id', requirePermission('offers.create'), async (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const o = await get<any>(
    db,
    `SELECT o.*, u.name AS created_by_name, r.client_name AS requirement_client FROM offers o
       LEFT JOIN users u ON u.id = o.created_by LEFT JOIN requirements r ON r.id = o.requirement_id WHERE o.id = ?`,
    [id],
  );
  if (!o) throw new HttpError(404, 'Offer not found');
  if (o.created_by !== req.user!.id && !can(req.user, 'offers.view_all')) throw new HttpError(403, "You can only view your own offers");
  const units = await all<any>(
    db,
    `SELECT un.id, p.name AS project, un.unit_number, un.property_type, un.asking_price, un.status
       FROM offer_units ou JOIN units un ON un.id = ou.unit_id LEFT JOIN projects p ON p.id = un.project_id
      WHERE ou.offer_id = ? ORDER BY ou.position`,
    [id],
  );
  res.json({ ...o, code: offerCode(id), units });
});

offersRouter.post('/pdf', requirePermission('offers.create', 'inventory.view'), async (req, res) => {
  const db = req.db;
  const s = await getSettings(db);
  const unitIds = idList(req.body?.unit_ids);
  const units = await loadUnits(db, unitIds);
  const includeOwner = s.pdf.show_owner && can(req.user, 'owners.contact') && !!req.body?.include_owner;
  const includePrice = s.pdf.show_price && req.body?.include_price !== false;
  const pdfUnits: PdfUnit[] = await Promise.all(units.map(async (u) => ({
    ...u,
    owner_phone: can(req.user, 'owners.contact') ? u.owner_phone : maskPhone(u.owner_phone),
    // Only PNG/JPEG can be embedded; fetch their bytes from storage.
    images: await Promise.all(
      (await all<any>(db, "SELECT * FROM files WHERE entity_type = 'unit' AND entity_id = ? AND mime IN ('image/png', 'image/jpeg', 'image/jpg') ORDER BY created_at", [u.id])).map(async (f) => ({
        data: await readStored(f.stored_name).catch(() => null),
        mime: f.mime,
        category: f.category,
      })),
    ),
  })));
  const logo = s.company.logo_file_id ? await get<any>(db, 'SELECT stored_name FROM files WHERE id = ?', [s.company.logo_file_id]) : null;
  await logActivity(db, {
    userId: req.user!.id,
    action: 'pdf_generated',
    entityType: 'unit',
    entityId: unitIds.length === 1 ? unitIds[0] : null,
    label: unitIds.length === 1 ? await unitLabel(db, unitIds[0]) : null,
    message: `downloaded an offer PDF for ${unitIds.length === 1 ? await unitLabel(db, unitIds[0]) : `${unitIds.length} units`}`,
  });
  const name = unitIds.length === 1 ? (await unitLabel(db, unitIds[0])).replace(/[^\w\- ]/g, '') : 'Property Offer';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name || 'offer'}.pdf"`);
  renderOfferPdf(res, {
    settings: s,
    units: pdfUnits,
    clientName: req.body?.client_name ? String(req.body.client_name) : null,
    agent: { name: req.user!.name, phone: req.user!.phone, email: req.user!.email },
    includeOwner,
    includePrice,
    logo: logo ? await readStored(logo.stored_name).catch(() => null) : null,
  });
});
