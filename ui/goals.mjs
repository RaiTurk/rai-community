import { encodeLocalizedDescription, hasLocalizedText, localizedText, selectLocalizedText } from './localized-text.mjs';

const bytes = value => new TextEncoder().encode(value).length;

export function goalTranslations(goal, legacyLanguage) {
  return localizedText(goal?.title, goal?.context, legacyLanguage);
}

export function displayedGoal(goal, language) {
  return selectLocalizedText(goalTranslations(goal, language), language);
}

export function goalContent(en, tr, previous) {
  const title = en.title || tr.title;
  if (!title) throw Error('goal-title-required');
  if ([en.title, tr.title].some(text => bytes(text) > 200)) throw Error('goal-title-length');
  if (previous && !hasLocalizedText(previous.context)) {
    for (const [original, alternate] of [[en, tr], [tr, en]]) {
      if (!alternate.title && !alternate.description && original.title === previous.title && original.description === previous.context)
        return { title, context: original.description };
    }
  }
  let context;
  try { context = encodeLocalizedDescription(en, tr); }
  catch { throw Error('goal-description-length'); }
  if (bytes(context) > 2000) throw Error('goal-description-length');
  return { title, context };
}
