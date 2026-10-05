export interface SelectorSet {
  role?: string;
  name?: string;
  id?: string;
  fieldName?: string;
  ariaLabel?: string;
  css?: string;
  text?: string;
  xpath?: string;
  inputType?: string;
}

export function selectorList(selectors: SelectorSet | undefined, fallbackText?: string) {
  const set = selectors || {};
  const attempts: Array<{ kind: string; value: string }> = [];
  if (set.role && (set.name || set.ariaLabel || fallbackText)) attempts.push({ kind: 'role', value: `${set.role}|${set.name || set.ariaLabel || fallbackText}` });
  if (set.id) attempts.push({ kind: 'id', value: set.id });
  if (set.fieldName) attempts.push({ kind: 'name', value: set.fieldName });
  if (set.ariaLabel) attempts.push({ kind: 'aria', value: set.ariaLabel });
  if (set.css) attempts.push({ kind: 'css', value: set.css });
  if (set.text || fallbackText) attempts.push({ kind: 'text', value: set.text || fallbackText || '' });
  if (set.xpath) attempts.push({ kind: 'xpath', value: set.xpath });
  return attempts.filter((item) => item.value);
}
