// Keep the existing network fields readable by older clients.
const english = 'English\u2063:\n';
const turkish = '\n\nTürkçe\u2063:\n';

export const hasLocalizedText = description => description.startsWith(english);

export function localizedText(title = '', description = '', legacyLanguage = 'en') {
  const split = description.indexOf(turkish, english.length);
  if (hasLocalizedText(description) && split !== -1) {
    const decode = section => {
      const newline = section.indexOf('\n');
      return { title: section.slice(0, newline), description: section.slice(newline + 1) };
    };
    const en = description.slice(english.length, split);
    const tr = description.slice(split + turkish.length);
    if (en.includes('\n') && tr.includes('\n')) return { en: decode(en), tr: decode(tr) };
  }
  const original = { title, description };
  const empty = { title: '', description: '' };
  return legacyLanguage === 'tr' ? { tr: original, en: empty } : { en: original, tr: empty };
}

export function selectLocalizedText({ en, tr }, language) {
  const [preferred, alternate] = language === 'tr' ? [tr, en] : [en, tr];
  return {
    title: preferred.title || alternate.title,
    description: preferred.description || alternate.description,
  };
}

export function encodeLocalizedDescription(en, tr) {
  if ([en.title, en.description, tr.title, tr.description].some(text => text.includes('\u2063')))
    throw Error('reserved-text');
  return english + en.title + '\n' + en.description + turkish + tr.title + '\n' + tr.description;
}
