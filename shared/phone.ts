// Phone numbers arrive in many shapes: "+20 101 234 5678", "0020-1012345678",
// "1012345678", "010 1234 5678". We store a canonical digits-only form next to
// the display value so search and duplicate detection ignore formatting.

export function normalizePhone(input: string | null | undefined): string {
  if (!input) return '';
  let d = String(input).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  // Egyptian mobile numbers: 20 + 10 digits → local 0 + 10 digits
  if (d.startsWith('20') && d.length === 12) d = '0' + d.slice(2);
  // Local mobile number missing its leading zero
  if (d.length === 10 && d.startsWith('1')) d = '0' + d;
  return d;
}

export function isValidPhone(input: string | null | undefined): boolean {
  const n = normalizePhone(input);
  return n.length >= 7 && n.length <= 15;
}

/** Converts a stored number to international digits for wa.me / tel: links. */
export function internationalPhone(input: string | null | undefined): string {
  const n = normalizePhone(input);
  if (!n) return '';
  if (n.startsWith('0') && n.length === 11) return '20' + n.slice(1);
  return n;
}
