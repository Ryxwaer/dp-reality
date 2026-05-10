import { Injectable } from '@nestjs/common';
import type { Listing } from './listing.schema.js';

const PRICE_LABELS: Record<string, string> = { sale: 'Sale', rent: 'Rent / mo' };
const PROPERTY_LABELS: Record<string, string> = {
  apartment: 'Apartment',
  house: 'House',
};

function esc(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value: number | undefined, priceType: string): string {
  if (value === undefined || value === null) return 'Price on request';
  const formatted = value.toLocaleString('cs-CZ').replace(/\u00A0/g, ' ');
  const label = PRICE_LABELS[priceType] ?? priceType;
  return `${formatted} CZK · ${label}`;
}

function formatLocality(listing: Listing): string {
  const bits: string[] = [];
  if (listing.city) bits.push(listing.city);
  if (listing.district) bits.push(listing.district);
  return bits.join(' · ') || 'Czechia';
}

function formatLabels(labels: string[]): string {
  if (!labels?.length) return '';
  const chips = labels
    .slice(0, 6)
    .map(
      (l) =>
        `<span style="display:inline-block;padding:2px 8px;margin:2px 4px 0 0;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:11px">${esc(l)}</span>`,
    )
    .join('');
  return `<div style="margin-top:8px">${chips}</div>`;
}

@Injectable()
export class NotificationRendererService {
  renderCard(listing: Listing): string {
    const title = esc(listing.title) || '(untitled listing)';
    const url = esc(listing.source_url) || '#';
    const locality = esc(formatLocality(listing));
    const propertyLabel = esc(
      `${PROPERTY_LABELS[listing.property_type] ?? ''}${
        listing.disposition ? ' · ' + listing.disposition : ''
      }`,
    );
    const priceLine = esc(formatPrice(listing.price, listing.price_type));
    const labelsHtml = formatLabels(listing.labels ?? []);

    return (
      '<div style="max-width:600px;margin:0 0 12px;padding:14px 16px;' +
      'border:1px solid #e2e8f0;border-radius:10px;' +
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
      'background:#ffffff">' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
      `<a href="${url}" target="_blank" rel="noopener noreferrer" ` +
      'style="font-weight:600;font-size:15px;color:#0f172a;text-decoration:none">' +
      `${title}</a>` +
      `<span style="font-size:12px;color:#64748b;white-space:nowrap">${propertyLabel}</span>` +
      '</div>' +
      `<div style="margin-top:6px;font-size:13px;color:#1e293b">${priceLine}</div>` +
      `<div style="margin-top:2px;font-size:12px;color:#64748b">${locality}</div>` +
      `${labelsHtml}` +
      '<div style="margin-top:10px">' +
      `<a href="${url}" target="_blank" rel="noopener noreferrer" ` +
      'style="display:inline-block;padding:6px 10px;border-radius:6px;' +
      'background:#0f172a;color:#ffffff;font-size:12px;text-decoration:none">' +
      'Open listing on Sreality →</a></div>' +
      '</div>'
    );
  }

  buildNotification(input: { userId: string; configId: string; listing: Listing }) {
    const { userId, configId, listing } = input;
    return {
      user_id: userId,
      config_id: configId,
      source_ref: `sreality:${listing._id}`,
      title: listing.title,
      url: listing.source_url,
      html: this.renderCard(listing),
      created_at: new Date(),
      unread: true,
      sent_at: null,
    };
  }
}
