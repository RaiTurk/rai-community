import { encodeLocalizedDescription, hasLocalizedText, localizedText, selectLocalizedText } from './localized-text.mjs';

export const TASK_DESCRIPTION_CHARS = 10_000;
const chars = text => Array.from(text).length;

export function taskTranslations(task, legacyLanguage) {
  return localizedText(task?.title, task?.description, legacyLanguage);
}

export function displayedTask(task, language) {
  return selectLocalizedText(taskTranslations(task, language), language);
}

export function taskDescription(en, tr) {
  const hasEnglish = en.title || en.description;
  const hasTurkish = tr.title || tr.description;
  const single = hasEnglish ? en.description : tr.description;
  return (hasEnglish && hasTurkish) || hasLocalizedText(single)
    ? encodeLocalizedDescription(en, tr)
    : single;
}

export function taskContent(en, tr) {
  const title = en.title || tr.title;
  if (!title) throw Error('title-required');
  if ([en.title, tr.title].some(value => chars(value) > 200)) throw Error('title-length');
  const description = taskDescription(en, tr);
  if (chars(description) > TASK_DESCRIPTION_CHARS) throw Error('description-length');
  return { title, description };
}
