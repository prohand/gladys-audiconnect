// -----------------------------------------------------------------------------
// The changelog roll of the Release workflow (.github/scripts/changelog-release.mjs).
// The release commit is pushed straight to main: what it writes must keep the
// history readable and its comparison links right.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-audiconnect';

test('the first release moves Unreleased under the version and links its tag', () => {
  const text = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A thing.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const rolled = rollChangelog(text, '1.0.0', '2026-10-19');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-19\n\n### Added\n\n- A thing\./,
  );
  assert.match(rolled, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.HEAD`));
  assert.match(rolled, new RegExp(`\\[1\\.0\\.0\\]: ${REPO}/releases/tag/v1\\.0\\.0`));
});

test('a later release compares with the previous tag', () => {
  const text =
    `## [Unreleased]\n\n### Fixed\n\n- B.\n\n## [1.0.0] - 2026-10-19\n\n- A.\n\n` +
    `[Unreleased]: ${REPO}/compare/v1.0.0...HEAD\n[1.0.0]: ${REPO}/releases/tag/v1.0.0\n`;
  const rolled = rollChangelog(text, '1.0.1', '2026-10-20');
  assert.match(rolled, /## \[1\.0\.1\] - 2026-10-20\n\n### Fixed\n\n- B\./);
  assert.match(
    rolled,
    new RegExp(`\\[1\\.0\\.1\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.v1\\.0\\.1`),
  );
});

test('an empty Unreleased section still names the release', () => {
  const rolled = rollChangelog(
    `## [Unreleased]\n\n[Unreleased]: ${REPO}/commits/main\n`,
    '1.0.1',
    '2026-10-20',
  );
  assert.match(
    rolled,
    /## \[1\.0\.1\] - 2026-10-20\n\n- Maintenance release, no functional change\./,
  );
});

test('the real changelog has an Unreleased section the workflow can roll', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(text.includes('## [Unreleased]'));
  assert.match(text, /^\[Unreleased\]: /m);
  assert.notEqual(rollChangelog(text, '9.9.9', '2026-10-19'), text);
});
