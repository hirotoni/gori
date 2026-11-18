import assert from 'node:assert/strict';
import { test } from 'node:test';
import { secretFields, secretKinds } from '../../tools/lib/secrets.mjs';

// 検査のための偽の値。check-public に当たらないよう、値は組み立てて作る。
const URL_CRED = ['postgres://user', 'pass@host/db'].join(':');
const BASIC = ['Authorization: Basic', 'dXNlcjpwYXNzd29yZA=='].join(' ');

test('URL の利用者名とパスワード、Basic 認証の形に当たる', () => {
  assert.deepEqual(secretKinds(`接続先は ${URL_CRED} だった`), ['URL の利用者名とパスワード']);
  assert.deepEqual(secretKinds(['https://alice', 's3cr3t@example.com/x'].join(':')), ['URL の利用者名とパスワード']);
  assert.deepEqual(secretKinds(BASIC), ['Basic 認証']);
});

test('秘密でない URL や語は通す', () => {
  for (const s of [
    'https://example.com/path?q=1',
    'git@example.com:owner/repo.git',
    'ssh://git@example.com/owner/repo',
    'postgres://localhost:5432/db',
    'http://user@host/path',
    'Basic な認証の説明',
    'パスワードを確かめずに完了と言った。トークンの期限を見るのが正しい。',
    'mailto:someone@example.com',
  ]) assert.deepEqual(secretKinds(s), [], s);
});

test('secretFields は当たった欄と形の名前だけを返し、値を含めない', () => {
  const hits = secretFields({ '--what': '目的', '--evidence': `出力 ${URL_CRED}`, '--finding': ['ok', BASIC] });
  assert.deepEqual(hits, ['--evidence（URL の利用者名とパスワード）', '--finding（Basic 認証）']);
  assert.doesNotMatch(hits.join(), /pass@|dXNlcjpw/);
  assert.deepEqual(secretFields({ '--why': undefined, '--quote': '' }), []);
});
