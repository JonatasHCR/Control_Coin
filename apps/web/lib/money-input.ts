/**
 * The money field speaks pt-BR; the API speaks `1234.56`.
 *
 * BR29 says language changes formatting, never the currency, and BR26 that an
 * amount stays a string end to end — so this translates between the two
 * spellings and never produces a float. `1.234,56`, `1234,56`, `1234.56` and
 * `1234` all mean the same amount.
 */

/**
 * The live mask: every keystroke is read as CENTS and re-formatted, the way a
 * banking app behaves. Typing 1, 2, 3, 4, 5, 6 walks 0,01 → 0,12 → 1,23 →
 * 12,34 → 123,45 → 1.234,56, so the field is never in a state the API would
 * refuse and the separators never have to be typed.
 */
export function maskMoney(raw: string): string {
  const negative = raw.trim().startsWith('-');
  // Strip leading zeros only while three digits survive, so "0" can still be
  // typed and reads as 0,00 rather than clearing the field.
  const digits = raw.replace(/\D/g, '').slice(0, 15).replace(/^0+(?=\d{3})/, '');

  // Nothing typed yet — leave it empty so the field can be cleared.
  if (digits === '') return negative ? '-' : '';

  const padded = digits.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${whole},${padded.slice(-2)}`;
}

/**
 * The decimal separator is whichever mark sits last, and only when it looks
 * like one: `1.234` is a thousand in pt-BR, `1.23` is one and a bit.
 */
function parts(raw: string): { whole: string; fraction: string; negative: boolean } | null {
  const negative = raw.trim().startsWith('-');
  const text = raw.replace(/[^\d.,]/g, '');
  if (text === '') return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const cut = Math.max(lastComma, lastDot);

  // A dot is only a decimal point when it is the single dot with 1–2 digits
  // after it; otherwise every dot is a thousands mark.
  const dotIsDecimal =
    lastComma === -1 &&
    lastDot !== -1 &&
    text.indexOf('.') === lastDot &&
    text.length - lastDot - 1 <= 2 &&
    text.length - lastDot - 1 > 0;

  if (cut === -1 || (cut === lastDot && !dotIsDecimal)) {
    return { whole: text.replace(/[.,]/g, ''), fraction: '', negative };
  }

  return {
    whole: text.slice(0, cut).replace(/[.,]/g, ''),
    fraction: text.slice(cut + 1).replace(/[.,]/g, ''),
    negative,
  };
}

/** `"1.234,5"` → `"1234.50"`. Returns `''` when there is no amount to send. */
export function toApiMoney(raw: string): string {
  const p = parts(raw);
  if (!p) return '';
  const whole = p.whole === '' ? '0' : p.whole;
  const fraction = `${p.fraction}00`.slice(0, 2);
  const value = `${p.negative ? '-' : ''}${whole}.${fraction}`;
  return value === '-0.00' ? '0.00' : value;
}

/** `"1234,5"` → `"1.234,50"`, for showing the field once it loses focus. */
export function displayMoney(raw: string): string {
  const api = toApiMoney(raw);
  if (api === '') return '';
  const [whole = '0', fraction = '00'] = api.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${api.startsWith('-') ? '-' : ''}${grouped},${fraction}`;
}
