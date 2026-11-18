import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROW = /^\|\s*([a-z][a-z0-9-]*)\s*\|\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*\|\s*$/;

export function parseModels(text) {
  const table = new Map();
  for (const line of text.split('\n')) {
    const m = ROW.exec(line);
    if (m) table.set(m[1], m[2]);
  }
  return table;
}

// 読めなければ推測せず失敗する。レビュアーのモデルを黙って作業者と同じにしないためである。
export function modelFor(root, role) {
  const path = join(root, 'knowledge', 'config', 'models.md');
  let table;
  try {
    table = parseModels(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} を読めない: ${e.message}`);
  }
  const model = table.get(role);
  if (!model) throw new Error(`${path} に「| ${role} | <モデル名> |」の行がない`);
  return model;
}
