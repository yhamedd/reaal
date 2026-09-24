import { MessageCircle, Phone } from 'lucide-react';
import { api } from '../api';
import { internationalPhone } from '../../../shared/phone';

/** Call / WhatsApp links. Opening one records "last contacted" on the owner. */
export function ContactButtons({ phone, whatsapp, ownerId, size = 'md', hidden }: { phone?: string | null; whatsapp?: string | null; ownerId?: number | null; size?: 'sm' | 'md'; hidden?: boolean }) {
  if (hidden) return null;
  const wa = whatsapp || phone;
  const track = (channel: string) => {
    if (ownerId) api.post(`/api/owners/${ownerId}/contacted`, { channel }).catch(() => undefined);
  };
  const cls = `btn ${size === 'sm' ? 'sm' : ''}`;
  return (
    <>
      {phone && (
        <a className={cls} href={`tel:${phone.replace(/[^\d+]/g, '')}`} onClick={() => track('phone')}>
          <Phone size={14} /> Call
        </a>
      )}
      {wa && (
        <a className={`${cls} whatsapp`} href={`https://wa.me/${internationalPhone(wa)}`} target="_blank" rel="noreferrer" onClick={() => track('whatsapp')}>
          <MessageCircle size={14} /> WhatsApp
        </a>
      )}
    </>
  );
}
