// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there can know which
// handlers the code registers — these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MANIFEST_ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { WIDGETS } from '../src/capabilities/widget.js';
import { ACCOUNT_FIELD_KEY, DEFAULT_CONFIG, REFRESH_TOKEN_KEY } from '../src/config.js';
import { COMMANDS, SCENE_TRIGGER_KEYS } from '../src/fleet.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

function isAtLeast(range, required) {
  const match = range.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  const version = match.slice(1).map(Number);
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(MANIFEST_ACTIONS).sort());
});

test('every scene action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widget has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const key of Object.keys(WIDGETS)) {
    assert.equal(typeof WIDGETS[key].get, 'function');
  }
});

test('every scene trigger fired is declared, and every declared one is fired', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('the command filter of command_failed lists every command the code reports', () => {
  const trigger = manifest.scene_triggers.find((entry) => entry.key === 'command_failed');
  const options = trigger.fields.find((field) => field.key === 'command').options;
  assert.deepEqual(options.map((option) => option.value).sort(), [...COMMANDS].sort());
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0', () => {
  assert.ok(isAtLeast(manifest.gladys_version, [5, 1, 0]), manifest.gladys_version);
});

test('categories: 1 to 3, which requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(manifest.gladys_version, [4, 86, 0]));
});

test('the integration is cloud only: the transports field says so', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('config_schema defaults match DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
});

test('the account is linked by an account_link field, and the token is stored off-schema', () => {
  const account = manifest.config_schema.find((field) => field.key === ACCOUNT_FIELD_KEY);
  assert.equal(account?.type, 'account_link');
  assert.ok(!keysOf(manifest.config_schema).includes(REFRESH_TOKEN_KEY));
  const spin = manifest.config_schema.find((field) => field.key === 'spin');
  assert.equal(spin.type, 'secret', 'the S-PIN is never sent back to the browser');
});

test('section fields are purely presentational', () => {
  for (const section of allFields.filter((field) => field.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`), manifest.docker_image);
  assert.ok(manifest.docker_image.startsWith('ghcr.io/prohand/gladys-audiconnect:'));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `${language}: ${text.length}`);
  }
});

test('every text of the manifest is written in English, French, German and Spanish', () => {
  const texts = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (['label', 'description', 'placeholder'].includes(key)) {
          texts.push([`${path}.${key}`, value]);
        } else {
          walk(value, `${path}.${key}`);
        }
      }
    }
  };
  walk(manifest, 'manifest');
  assert.ok(texts.length > 50);
  for (const [path, value] of texts) {
    assert.equal(typeof value, 'object', `${path} must be a multi-language object`);
    assert.deepEqual(Object.keys(value).sort(), [...LANGUAGES].sort(), path);
    for (const language of LANGUAGES) {
      assert.ok(value[language].trim().length > 0, `${path}.${language}`);
    }
  }
});
