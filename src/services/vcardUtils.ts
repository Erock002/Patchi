/**
 * Utilities for formatting vCard 3.0 and MeCard contact payloads for QR codes.
 * Ensures maximum smartphone camera compatibility (iOS Apple Contacts & Android Google Contacts).
 */

import { VCardContact } from '../types';

export const DEFAULT_VCARD_CONTACT: VCardContact = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  website: '',
  organization: '',
  title: '',
  format: 'vcard',
};

/**
 * Standard RFC 2426 vCard 3.0 formatter.
 * Triggers native "Add to Contacts" sheet on iOS and Android camera scanners.
 */
export function formatVCard(contact: VCardContact): string {
  const first = (contact.firstName || '').trim();
  const last = (contact.lastName || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ') || 'Contact';

  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

  // Name fields
  if (last || first) {
    lines.push(`N:${escapeVCard(last)};${escapeVCard(first)};;;`);
    lines.push(`FN:${escapeVCard(fullName)}`);
  } else {
    lines.push(`FN:${escapeVCard(fullName)}`);
  }

  // Organization & Title
  if (contact.organization?.trim()) {
    lines.push(`ORG:${escapeVCard(contact.organization.trim())}`);
  }
  if (contact.title?.trim()) {
    lines.push(`TITLE:${escapeVCard(contact.title.trim())}`);
  }

  // Telephone (Cell / Mobile)
  if (contact.phone?.trim()) {
    const cleanPhone = contact.phone.trim();
    lines.push(`TEL;TYPE=CELL:${cleanPhone}`);
  }

  // Email
  if (contact.email?.trim()) {
    lines.push(`EMAIL:${contact.email.trim()}`);
  }

  // URL / Website / Social profile
  if (contact.website?.trim()) {
    let url = contact.website.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    lines.push(`URL:${url}`);
  }

  lines.push('END:VCARD');
  return lines.join('\n');
}

/**
 * Compact MeCard formatter (NTT DoCoMo standard).
 * Ultra-compact character footprint yielding larger physical QR modules on the WaveShare 172x320 display.
 */
export function formatMeCard(contact: VCardContact): string {
  const first = (contact.firstName || '').trim();
  const last = (contact.lastName || '').trim();

  let out = 'MECARD:';
  if (last || first) {
    out += `N:${escapeMeCard(last)}${first ? `,${escapeMeCard(first)}` : ''};`;
  }
  if (contact.phone?.trim()) {
    out += `TEL:${contact.phone.replace(/[^0-9+]/g, '')};`;
  }
  if (contact.email?.trim()) {
    out += `EMAIL:${contact.email.trim()};`;
  }
  if (contact.website?.trim()) {
    let url = contact.website.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    out += `URL:${url};`;
  }
  if (contact.organization?.trim()) {
    out += `ORG:${escapeMeCard(contact.organization.trim())};`;
  }
  out += ';';
  return out;
}

/**
 * Build active contact QR payload according to preferred format.
 */
export function buildContactQrPayload(contact: VCardContact): string {
  if (contact.format === 'mecard') {
    return formatMeCard(contact);
  }
  return formatVCard(contact);
}

function escapeVCard(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function escapeMeCard(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/:/g, '\\:').replace(/,/g, '\\,');
}

/**
 * Estimates hardware QR version based on payload byte length
 */
export function getEstimatedQrVersion(length: number): { version: number; modules: number; scale: number } {
  if (length <= 35) return { version: 3, modules: 29, scale: 4 };
  if (length <= 55) return { version: 4, modules: 33, scale: 4 };
  if (length <= 80) return { version: 6, modules: 41, scale: 3 };
  if (length <= 120) return { version: 8, modules: 49, scale: 3 };
  return { version: 10, modules: 57, scale: 2 };
}
