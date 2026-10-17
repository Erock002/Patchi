/**
 * VCardContactBuilder
 * Interactive Contact Card editor supporting vCard 3.0 and MeCard formats.
 * Features live payload preview, QR version telemetry, and persistent local storage.
 */

import React, { useState, useEffect } from 'react';
import { VCardContact } from '../types';
import {
  DEFAULT_VCARD_CONTACT,
  buildContactQrPayload,
  getEstimatedQrVersion,
} from '../services/vcardUtils';
import {
  User,
  Phone,
  Mail,
  Globe,
  Building2,
  Briefcase,
  Send,
  RotateCcw,
  Sparkles,
  Smartphone,
  Check,
} from 'lucide-react';

interface VCardContactBuilderProps {
  onPayloadChange: (payload: string, title: string) => void;
  onBeam: (payload: string, title: string) => void;
  onDone?: () => void;
  isBeaming?: boolean;
}

const STORAGE_KEY = 'PATCHI_VCARD_DATA';
const LEGACY_STORAGE_KEY = 'DIGIPATCH_VCARD_DATA';

export const VCardContactBuilder: React.FC<VCardContactBuilderProps> = ({
  onPayloadChange,
  onBeam,
  onDone,
  isBeaming = false,
}) => {
  const [contact, setContact] = useState<VCardContact>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_VCARD_CONTACT, ...JSON.parse(saved) };
      }
    } catch {}
    return { ...DEFAULT_VCARD_CONTACT };
  });

  const [copiedNotification, setCopiedNotification] = useState(false);

  // Sync to parent and localStorage whenever contact fields change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(contact));
    } catch {}

    const payload = buildContactQrPayload(contact);
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
    const title = fullName ? (fullName.length > 13 ? fullName.substring(0, 13) : fullName) : 'MY CONTACT';
    onPayloadChange(payload, title);
  }, [contact]);

  const handleChange = (field: keyof VCardContact, val: string) => {
    setContact((prev) => ({ ...prev, [field]: val }));
  };

  const handleClear = () => {
    setContact(DEFAULT_VCARD_CONTACT);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const payload = buildContactQrPayload(contact);
  const { version, modules, scale } = getEstimatedQrVersion(payload.length);
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();

  return (
    <div className="space-y-3.5">
      {/* Format Switcher: vCard 3.0 vs MeCard */}
      <div className="flex items-center justify-between bg-[#1A1A1E] p-1 rounded-xl border border-[#2C2C32]">
        <button
          type="button"
          onClick={() => handleChange('format', 'vcard')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            contact.format === 'vcard'
              ? 'bg-white text-black font-extrabold shadow-md'
              : 'text-[#9E9EA8] hover:text-white'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>vCard 3.0 (Universal)</span>
        </button>
        <button
          type="button"
          onClick={() => handleChange('format', 'mecard')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            contact.format === 'mecard'
              ? 'bg-white text-black font-extrabold shadow-md'
              : 'text-[#9E9EA8] hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>MeCard (Compact)</span>
        </button>
      </div>

      {/* Name Input Row */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-bold text-[#9E9EA8] mb-1 uppercase tracking-wider">
            First Name
          </label>
          <div className="relative">
            <User className="w-3.5 h-3.5 text-[#7A7A85] absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={contact.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              placeholder="e.g. Alex"
              className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-[#7A7A85] focus:outline-none transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-[#9E9EA8] mb-1 uppercase tracking-wider">
            Last Name
          </label>
          <input
            type="text"
            value={contact.lastName}
            onChange={(e) => handleChange('lastName', e.target.value)}
            placeholder="e.g. Smith"
            className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl px-3 py-2 text-xs text-white placeholder-[#7A7A85] focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Phone Number Input */}
      <div>
        <label className="block text-[10px] font-bold text-[#9E9EA8] mb-1 uppercase tracking-wider">
          Phone Number
        </label>
        <div className="relative">
          <Phone className="w-3.5 h-3.5 text-[#7A7A85] absolute left-2.5 top-2.5" />
          <input
            type="tel"
            value={contact.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="e.g. +1 (555) 123-4567"
            className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-[#7A7A85] focus:outline-none font-mono-code transition-colors"
          />
        </div>
      </div>

      {/* Email Input */}
      <div>
        <label className="block text-[10px] font-bold text-[#9E9EA8] mb-1 uppercase tracking-wider">
          Email Address
        </label>
        <div className="relative">
          <Mail className="w-3.5 h-3.5 text-[#7A7A85] absolute left-2.5 top-2.5" />
          <input
            type="email"
            value={contact.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="e.g. alex@example.com"
            className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-[#7A7A85] focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Website or Social URL */}
      <div>
        <label className="block text-[10px] font-bold text-[#9E9EA8] mb-1 uppercase tracking-wider">
          Website, Instagram or Portfolio
        </label>
        <div className="relative">
          <Globe className="w-3.5 h-3.5 text-[#7A7A85] absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={contact.website}
            onChange={(e) => handleChange('website', e.target.value)}
            placeholder="e.g. instagram.com/yourhandle"
            className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-[#7A7A85] focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Organization & Job Title (Optional Row) */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-bold text-[#9E9EA8] mb-1 uppercase tracking-wider">
            Company / Org (Opt.)
          </label>
          <div className="relative">
            <Building2 className="w-3.5 h-3.5 text-[#7A7A85] absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={contact.organization}
              onChange={(e) => handleChange('organization', e.target.value)}
              placeholder="e.g. Acme Inc"
              className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-[#7A7A85] focus:outline-none transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-[#9E9EA8] mb-1 uppercase tracking-wider">
            Job Title (Opt.)
          </label>
          <div className="relative">
            <Briefcase className="w-3.5 h-3.5 text-[#7A7A85] absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={contact.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="e.g. Designer"
              className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-[#7A7A85] focus:outline-none transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Live Contact Card Preview Badge */}
      <div className="p-3 bg-[#1A1A1E] rounded-xl border border-[#2C2C32] text-xs space-y-2">
        <div className="flex items-center justify-between text-[11px] font-bold text-[#9E9EA8]">
          <span className="flex items-center gap-1.5 text-white">
            <Smartphone className="w-3.5 h-3.5 text-[#9E9EA8]" />
            <span>Card Preview (What scanner sees)</span>
          </span>
          <span className="font-mono-code text-[10px] text-[#7A7A85]">
            {payload.length} chars · Version {version} ({modules}×{modules} mod, {scale}× px)
          </span>
        </div>

        <div className="bg-[#222228] rounded-lg p-2.5 border border-[#33333C] space-y-1">
          <div className="font-bold text-white text-sm">
            {fullName || 'No Name Provided'}
          </div>
          {(contact.title || contact.organization) && (
            <div className="text-[11px] text-[#9E9EA8]">
              {[contact.title, contact.organization].filter(Boolean).join(' at ')}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-mono-code text-white">
            {contact.phone && (
              <span className="flex items-center gap-1 text-white bg-white/10 px-2 py-0.5 rounded border border-white/20">
                <Phone className="w-3 h-3 text-[#9E9EA8]" />
                {contact.phone}
              </span>
            )}
            {contact.email && (
              <span className="flex items-center gap-1 text-white bg-white/10 px-2 py-0.5 rounded border border-white/20">
                <Mail className="w-3 h-3 text-[#9E9EA8]" />
                {contact.email}
              </span>
            )}
            {contact.website && (
              <span className="flex items-center gap-1 text-white bg-white/10 px-2 py-0.5 rounded border border-white/20 truncate max-w-full">
                <Globe className="w-3 h-3 text-[#9E9EA8] flex-shrink-0" />
                <span className="truncate">{contact.website}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-1">
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="py-3 px-3.5 rounded-xl font-bold text-xs bg-[#222228] hover:bg-[#2C2C32] text-white flex items-center justify-center gap-1.5 transition-all border border-[#33333C] shadow-md active:scale-95"
          >
            <Check className="w-4 h-4 text-white" />
            <span>Done & Lock</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            const title = fullName ? (fullName.length > 13 ? fullName.substring(0, 13) : fullName) : 'MY CONTACT';
            onBeam(payload, title);
          }}
          disabled={isBeaming || !payload}
          className="flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-white hover:bg-[#E8E8EC] text-black flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 disabled:opacity-50"
        >
          <Send className="w-4 h-4 text-black" />
          <span>{isBeaming ? 'Beaming Contact...' : 'Beam Contact QR to Screen'}</span>
        </button>

        <button
          type="button"
          onClick={handleClear}
          title="Clear contact card form"
          className="p-3 rounded-xl bg-[#222228] border border-[#33333C] hover:border-white text-[#9E9EA8] hover:text-white transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
