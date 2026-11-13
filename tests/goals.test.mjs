import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayedGoal, goalContent, goalTranslations } from '../ui/goals.mjs';

test('goal translations round-trip with multiline descriptions and fall back to the available language', () => {
  const en = { title: 'Reach new readers', description: 'First line\n\nSecond line' };
  const tr = { title: 'Yeni okurlara ulaş', description: 'Türkçe açıklama' };
  const goal = goalContent(en, tr);
  assert.equal(goal.title, en.title);
  assert.deepEqual(goalTranslations(goal, 'tr'), { en, tr });
  assert.deepEqual(displayedGoal(goal, 'en'), en);
  assert.deepEqual(displayedGoal(goal, 'tr'), tr);
  assert.deepEqual(displayedGoal(goalContent(en, { title: '', description: '' }), 'tr'), en);
});

test('legacy goals retain their full description when editing numbers only', () => {
  const goal = { title: 'Eski hedef', context: 'a'.repeat(2000) };
  const { en, tr } = goalTranslations(goal, 'tr');
  assert.deepEqual(goalContent(en, tr, goal), goal);
  assert.deepEqual(displayedGoal(goal, 'en'), { title: goal.title, description: goal.context });
  assert.throws(() => goalContent({ title: 'English', description: '' }, tr, goal), /goal-description-length/);
});
