import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contributionGroups } from '../ui/core.mjs';
import { displayedTask, taskContent, taskTranslations, TASK_DESCRIPTION_CHARS } from '../ui/tasks.mjs';

const en = { title: 'Reach new readers', description: 'First line\n\nSecond line' };
const tr = { title: 'Yeni okurlara ulaş', description: 'Türkçe açıklama' };
const empty = { title: '', description: '' };

test('tasks display the selected language, with fallback for older and single-language tasks', () => {
  const task = taskContent(en, tr);
  assert.deepEqual(taskTranslations(task, 'tr'), { en, tr });
  assert.deepEqual(displayedTask(task, 'en'), en);
  assert.deepEqual(displayedTask(task, 'tr'), tr);
  assert.deepEqual(displayedTask(taskContent(en, empty), 'tr'), en);
  assert.deepEqual(displayedTask({ title: tr.title, description: tr.description }, 'en'), tr);
  assert.deepEqual(taskTranslations({ title: tr.title, description: tr.description }, 'tr'), { en: empty, tr });
});

test('task text follows the existing network character limit', () => {
  const description = '🌍'.repeat(TASK_DESCRIPTION_CHARS);
  assert.equal(taskContent({ ...en, description }, empty).description, description);
  assert.throws(() => taskContent({ ...en, description }, tr), /description-length/);
  assert.throws(() => taskContent({ ...en, title: 'a'.repeat(201) }, tr), /title-length/);
});

test('task translation edits localize existing contribution titles without splitting the campaign', () => {
  const snapshot = {
    members: [{ hash: 'member', data: { member_id: 'owner' } }],
    events: [
      { hash: 'old', data: { body: { type: 'task', id: 'same', title: en.title, description: en.description } } },
      { hash: 'claim', data: { membership: 'member', body: { type: 'claim', task: 'old', actions: ['done'] } } },
      { hash: 'new', data: { body: { type: 'task', id: 'same', ...taskContent(en, tr) } } },
    ],
  };
  const [group] = contributionGroups(snapshot, 'tr');
  assert.equal(group.title, tr.title);
  assert.equal(group.taskId, 'same');
  assert.deepEqual(group.references, ['claim']);
  assert.equal(contributionGroups(snapshot, 'tr').length, 1);
});
