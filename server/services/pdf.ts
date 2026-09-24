import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import type { Writable } from 'node:stream';
import { formatMoney, formatNumber } from '../../shared/format.js';
import type { AppSettings } from '../settings.js';
import type { UnitForOffer } from './offerText.js';

export interface PdfImage {
  path: string;
  mime: string;
  category: string;
}

export interface PdfUnit extends UnitForOffer {
  images: PdfImage[];
}

export interface PdfOptions {
  settings: AppSettings;
  units: PdfUnit[];
  clientName?: string | null;
  agent: { name: string; phone?: string | null; email?: string | null };
  includeOwner: boolean;
  includePrice: boolean;
  logoPath?: string | null;
}

const PAGE_MARGIN = 48;

function isEmbeddable(img: PdfImage) {
  return /^image\/(png|jpe?g)$/.test(img.mime) && fs.existsSync(img.path);
}

export function renderOfferPdf(out: Writable, opts: PdfOptions) {
  const { settings } = opts;
  const accent = settings.pdf.accent_color || '#1f4b99';
  const currency = settings.general.currency;
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, info: { Title: `${settings.company.name} – Property Offer`, Author: settings.company.name } });
  doc.pipe(out);
  const width = doc.page.width - PAGE_MARGIN * 2;

  const header = () => {
    doc.save();
    doc.rect(0, 0, doc.page.width, 64).fill(accent);
    let x = PAGE_MARGIN;
    if (opts.logoPath && fs.existsSync(opts.logoPath)) {
      try {
        doc.image(opts.logoPath, x, 14, { height: 36 });
        x += 48;
      } catch {
        /* unsupported logo format */
      }
    }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(settings.company.name, x, 24, { width: width - (x - PAGE_MARGIN) });
    doc.restore();
    doc.fillColor('#111111');
    doc.y = 88;
  };

  const footer = () => {
    const y = doc.page.height - PAGE_MARGIN + 8;
    const contact = [settings.company.phone, settings.company.email, settings.company.website].filter(Boolean).join('   ·   ');
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // allow writing inside the bottom margin without triggering a page break
    doc.save();
    doc.font('Helvetica').fontSize(8).fillColor('#777777');
    if (contact) doc.text(contact, PAGE_MARGIN, y - 22, { width, align: 'center', lineBreak: false });
    if (settings.pdf.footer_text) doc.text(settings.pdf.footer_text, PAGE_MARGIN, y - 10, { width, align: 'center', lineBreak: false });
    doc.restore();
    doc.page.margins.bottom = bottom;
  };

  opts.units.forEach((u, index) => {
    if (index > 0) doc.addPage();
    header();

    if (opts.clientName && index === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#555555').text(`Prepared for ${opts.clientName}`, { width });
      doc.moveDown(0.5);
    }

    doc.font('Helvetica-Bold').fontSize(24).fillColor('#111111').text((u.project ?? 'Property').toUpperCase(), { width });
    const subtitle = [u.property_type, u.phase, settings.pdf.show_unit_number && u.unit_number ? `Unit ${u.unit_number}` : null].filter(Boolean).join('  ·  ');
    if (subtitle) doc.font('Helvetica').fontSize(13).fillColor('#444444').text(subtitle, { width });
    if (u.developer) doc.fontSize(10).fillColor('#777777').text(`by ${u.developer}`, { width });
    doc.moveDown(0.8);

    // Hero image
    const images = settings.pdf.show_images ? u.images.filter((i) => i.category === 'image' && isEmbeddable(i)) : [];
    if (images.length) {
      const h = 230;
      try {
        doc.image(images[0].path, PAGE_MARGIN, doc.y, { fit: [width, h], align: 'center', valign: 'center' });
      } catch {
        /* corrupt image */
      }
      doc.y += h + 12;
    }

    // Specifications grid
    const specs: [string, string][] = (
      [
        ['BUA', u.bua ? `${formatNumber(u.bua)} SQM` : ''],
        ['Land', u.land_area ? `${formatNumber(u.land_area)} SQM` : ''],
        ['Bedrooms', u.bedrooms != null ? String(u.bedrooms) : ''],
        ['Bathrooms', u.bathrooms != null ? String(u.bathrooms) : ''],
        ['Floors', u.floors != null ? String(u.floors) : ''],
        ['Finishing', u.finishing ?? ''],
        ['Furnishing', u.furnished ?? ''],
        ['View', u.view ?? ''],
        ['Location', u.location ?? ''],
        ['Delivery', u.delivery ?? ''],
      ] as [string, string][]
    ).filter(([, v]) => v);

    const colW = width / 2;
    const rowH = 30;
    const startY = doc.y;
    specs.forEach(([k, v], i) => {
      const cx = PAGE_MARGIN + (i % 2) * colW;
      const cy = startY + Math.floor(i / 2) * rowH;
      doc.save().moveTo(cx, cy + rowH - 4).lineTo(cx + colW - 12, cy + rowH - 4).lineWidth(0.5).strokeColor('#dddddd').stroke().restore();
      doc.font('Helvetica').fontSize(8).fillColor('#888888').text(k.toUpperCase(), cx, cy, { width: colW - 12 });
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(v, cx, cy + 10, { width: colW - 12, lineBreak: false, ellipsis: true });
    });
    doc.y = startY + Math.ceil(specs.length / 2) * rowH + 12;
    doc.x = PAGE_MARGIN;

    if (opts.includePrice && u.asking_price) {
      const boxY = doc.y;
      doc.save().rect(PAGE_MARGIN, boxY, width, 50).fill('#f3f5f9').restore();
      doc.font('Helvetica').fontSize(9).fillColor('#666666').text('ASKING PRICE', PAGE_MARGIN + 14, boxY + 10);
      doc.font('Helvetica-Bold').fontSize(18).fillColor(accent).text(formatMoney(u.asking_price, currency), PAGE_MARGIN + 14, boxY + 22);
      doc.y = boxY + 62;
      const pay = [
        u.paid_amount ? `Paid: ${formatMoney(u.paid_amount, currency)}` : '',
        u.remaining_amount ? `Remaining: ${formatMoney(u.remaining_amount, currency)}` : '',
        u.maintenance ? `Maintenance: ${formatMoney(u.maintenance, currency)}` : '',
      ].filter(Boolean);
      if (pay.length) doc.font('Helvetica').fontSize(10).fillColor('#444444').text(pay.join('    '), PAGE_MARGIN, doc.y, { width });
      if (u.payment_notes) doc.font('Helvetica').fontSize(10).fillColor('#444444').text(u.payment_notes, { width });
      doc.moveDown(0.5);
    }

    if (opts.includeOwner && (u.owner_name || u.owner_phone)) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text('Owner', PAGE_MARGIN, doc.y + 4);
      doc.font('Helvetica').fontSize(10).fillColor('#444444').text([u.owner_name, u.owner_phone].filter(Boolean).join(' – '), { width });
      doc.moveDown(0.5);
    }

    // Additional gallery thumbnails if space permits
    const extra = images.slice(1, 4);
    if (extra.length && doc.y < doc.page.height - 260) {
      const thumbW = (width - 16) / 3;
      const y = doc.y + 6;
      extra.forEach((img, i) => {
        try {
          doc.image(img.path, PAGE_MARGIN + i * (thumbW + 8), y, { fit: [thumbW, 110], align: 'center', valign: 'center' });
        } catch {
          /* skip */
        }
      });
      doc.y = y + 118;
    }

    if (settings.pdf.show_agent_contact) {
      const y = Math.max(doc.y + 8, doc.page.height - PAGE_MARGIN - 90);
      if (y < doc.page.height - PAGE_MARGIN - 40) {
        doc.save().moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + width, y).lineWidth(0.5).strokeColor('#cccccc').stroke().restore();
        doc.font('Helvetica').fontSize(9).fillColor('#777777').text('YOUR CONTACT', PAGE_MARGIN, y + 8);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(opts.agent.name, PAGE_MARGIN, y + 20);
        const line = [opts.agent.phone || settings.company.phone, opts.agent.email || settings.company.email].filter(Boolean).join('   ·   ');
        if (line) doc.font('Helvetica').fontSize(10).fillColor('#444444').text(line, PAGE_MARGIN, y + 34);
      }
    }
    footer();

    // Floor plan & master plan pages
    const plans = u.images.filter(
      (i) => isEmbeddable(i) && ((i.category === 'floor_plan' && settings.pdf.show_floor_plan) || (i.category === 'master_plan' && settings.pdf.show_master_plan)),
    );
    for (const plan of plans) {
      doc.addPage();
      header();
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text(`${u.project ?? ''} – ${plan.category === 'floor_plan' ? 'Floor Plan' : 'Master Plan'}`, { width });
      doc.moveDown(0.5);
      try {
        doc.image(plan.path, PAGE_MARGIN, doc.y, { fit: [width, doc.page.height - doc.y - PAGE_MARGIN - 40], align: 'center', valign: 'center' });
      } catch {
        /* skip */
      }
      footer();
    }
  });

  doc.end();
}
