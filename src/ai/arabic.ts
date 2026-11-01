const DIAC = /[ً-ٰٟـ]/g;
const DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
export function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(DIAC, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => DIGITS[d] ?? d).replace(/[،,؛]/g, ' ').replace(/\s+/g, ' ').trim();
}
