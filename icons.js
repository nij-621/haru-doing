/* 하루두잉 아이콘 시스템 — Lucide 라인 아이콘 (icons-data.js의 SVG 사용)
   taskIcons registry: id / label / category */
'use strict';

const TASK_ICONS = [
  { id: 'none', label: 'None', category: 'general' },
  { id: 'note', label: 'Note', category: 'general' },
  { id: 'work', label: 'Work', category: 'general' },
  { id: 'meeting', label: 'Meeting', category: 'general' },
  { id: 'calendar', label: 'Calendar', category: 'general' },
  { id: 'deadline', label: 'Deadline', category: 'general' },
  { id: 'important', label: 'Important', category: 'general' },
  { id: 'study', label: 'Study', category: 'study' },
  { id: 'book', label: 'Book', category: 'study' },
  { id: 'reading', label: 'Reading', category: 'study' },
  { id: 'writing', label: 'Writing', category: 'study' },
  { id: 'run', label: 'Run', category: 'health' },
  { id: 'exercise', label: 'Exercise', category: 'health' },
  { id: 'walk', label: 'Walk', category: 'health' },
  { id: 'gym', label: 'Gym', category: 'health' },
  { id: 'yoga', label: 'Yoga', category: 'health' },
  { id: 'medicine', label: 'Medicine', category: 'health' },
  { id: 'hospital', label: 'Hospital', category: 'health' },
  { id: 'health', label: 'Health', category: 'health' },
  { id: 'alarm', label: 'Alarm', category: 'routine' },
  { id: 'wakeup', label: 'Wake up', category: 'routine' },
  { id: 'sleep', label: 'Sleep', category: 'routine' },
  { id: 'nap', label: 'Nap', category: 'routine' },
  { id: 'shower', label: 'Shower', category: 'routine' },
  { id: 'meal', label: 'Meal', category: 'food' },
  { id: 'breakfast', label: 'Breakfast', category: 'food' },
  { id: 'lunch', label: 'Lunch', category: 'food' },
  { id: 'dinner', label: 'Dinner', category: 'food' },
  { id: 'coffee', label: 'Coffee', category: 'food' },
  { id: 'water', label: 'Water', category: 'food' },
  { id: 'clean', label: 'Clean', category: 'home' },
  { id: 'laundry', label: 'Laundry', category: 'home' },
  { id: 'trash', label: 'Trash', category: 'home' },
  { id: 'home', label: 'Home', category: 'home' },
  { id: 'family', label: 'Family', category: 'home' },
  { id: 'friend', label: 'Friend', category: 'home' },
  { id: 'shopping', label: 'Shopping', category: 'errands' },
  { id: 'groceries', label: 'Groceries', category: 'errands' },
  { id: 'money', label: 'Money', category: 'errands' },
  { id: 'bank', label: 'Bank', category: 'errands' },
  { id: 'payment', label: 'Payment', category: 'errands' },
  { id: 'laptop', label: 'Laptop', category: 'tech' },
  { id: 'phone', label: 'Phone', category: 'tech' },
  { id: 'email', label: 'Email', category: 'tech' },
  { id: 'call', label: 'Call', category: 'tech' },
  { id: 'car', label: 'Car', category: 'transport' },
  { id: 'bus', label: 'Bus', category: 'transport' },
  { id: 'subway', label: 'Subway', category: 'transport' },
  { id: 'train', label: 'Train', category: 'transport' },
  { id: 'plane', label: 'Plane', category: 'transport' },
  { id: 'travel', label: 'Travel', category: 'transport' },
  { id: 'luggage', label: 'Luggage', category: 'transport' },
  { id: 'map', label: 'Map', category: 'transport' },
  { id: 'art', label: 'Art', category: 'fun' },
  { id: 'music', label: 'Music', category: 'fun' },
  { id: 'movie', label: 'Movie', category: 'fun' },
  { id: 'game', label: 'Game', category: 'fun' },
];

const ICON_CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'study', label: 'Study' },
  { id: 'health', label: 'Health' },
  { id: 'routine', label: 'Routine' },
  { id: 'food', label: 'Food' },
  { id: 'home', label: 'Home' },
  { id: 'errands', label: 'Errands' },
  { id: 'tech', label: 'Tech' },
  { id: 'transport', label: 'Transport' },
  { id: 'fun', label: 'Fun' },
];

/* 예전 이모지 데이터 → 아이콘 id 매핑 (기존 저장 데이터 렌더링용) */
const EMOJI_TO_ICON = {
  '💼': 'work', '💊': 'medicine', '📝': 'note', '📚': 'study', '🏃': 'run',
  '🍚': 'meal', '🧹': 'clean', '🛒': 'shopping', '💻': 'laptop', '☕': 'coffee',
  '🎨': 'art', '😴': 'sleep',
  '🦷': 'hospital', '📄': 'note', '📥': 'note', '🏠': 'home', '📅': 'calendar', '⚙️': 'note',
};

const TASK_ICON_IDS = new Set(TASK_ICONS.map(i => i.id));

/* t.emoji 값(아이콘 id 또는 예전 이모지) → 아이콘 id 또는 null */
function resolveIcon(val) {
  if (!val) return null;
  if (val !== 'none' && TASK_ICON_IDS.has(val)) return val;
  if (EMOJI_TO_ICON[val]) return EMOJI_TO_ICON[val];
  return null; // unknown → none
}

/* 라인 아이콘 SVG 문자열 */
function iconSvg(id, size) {
  const inner = window.ICON_SVGS[id];
  if (!inner) return '';
  size = size || 22;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}

/* IconBadge: 부드러운 배경 위 라인 아이콘 (기본: 회색 / 선택: 코랄) */
function IconBadge(id, opts) {
  opts = opts || {};
  const span = document.createElement('span');
  span.className = 'icon-badge' + (opts.selected ? ' selected' : '') + (opts.plain ? ' plain' : '');
  span.innerHTML = iconSvg(id, opts.size || 20);
  return span;
}
