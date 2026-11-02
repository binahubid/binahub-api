import './minimatch-compat.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const require = createRequire(import.meta.url);
const consumers = ['eslint-plugin-react', 'eslint-plugin-import', 'eslint-plugin-jsx-a11y'];
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('every locked minimatch uses the official patched registry release', () => {
  const entries = Object.entries(lock.packages).filter(([path, pkg]) =>
    path.endsWith('/minimatch') || pkg.name === 'minimatch');
  assert(entries.length > 0);
  for (const [path, pkg] of entries) {
    assert(!pkg.link, path);
    assert(pkg.resolved.startsWith('https://registry.npmjs.org/minimatch/'), path);
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    assert(major > 11 || (major === 11 && (minor > 0 || patch >= 1)), path+': '+pkg.version);
  }
});

test('legacy lint consumers retain callable matching, constructors, helpers and defaults', () => {
  for (const name of consumers) {
    const match = createRequire(require.resolve(name))('minimatch');
    assert.equal(typeof match, 'function', name);
    assert.equal(match('src/page.tsx', '**/*.tsx'), true);
    assert.equal(match('src/page.tsx', '**/*.sql'), false);
    assert.equal(new match.Minimatch('**/*.tsx').match('src/page.tsx'), true);
    assert.equal(match.makeRe('**/*.tsx').test('src/page.tsx'), true);
    assert.deepEqual(match.match(['a.ts', 'b.js'], '*.ts'), ['a.ts']);
    assert.equal(match.defaults({nocase: true})('FOO.TS', '*.ts'), true);
  }
});

test('glob-dependent lint rules actually execute and still reject invalid fixtures', async () => {
  const {ESLint} = require('eslint');
  const lint = new ESLint({overrideConfigFile: true, overrideConfig: {
    files: ['**/*.jsx'],
    languageOptions: {ecmaVersion: 2022, sourceType: 'module', parserOptions: {ecmaFeatures: {jsx: true}}},
    plugins: {react: require('eslint-plugin-react'), import: require('eslint-plugin-import'), 'jsx-a11y': require('eslint-plugin-jsx-a11y')},
    settings: {react: {version: '19.2.4'}},
    rules: {
      'react/jsx-pascal-case': ['error', {ignore: ['my_*']}],
      'react/no-unstable-nested-components': 'error',
      'jsx-a11y/label-has-associated-control': ['error', {controlComponents: ['Input*']}],
      'import/order': ['error', {pathGroups: [{pattern: '@/**', group: 'internal'}]}],
    },
  }});
  const [valid] = await lint.lintText('import value from "@/value";\nconst View = () => <div><my_widget /><label>Nama<InputField /></label><Item renderContent={() => <span />} /></div>;\n', {filePath: 'compat-fixture.jsx'});
  assert.deepEqual(valid.messages, []);
  const [invalid] = await lint.lintText('const View = () => <label><InputField /></label>;', {filePath: 'compat-fixture.jsx'});
  assert(invalid.messages.some(message => message.ruleId === 'jsx-a11y/label-has-associated-control'));
  const boundary = new ESLint({overrideConfigFile: true, overrideConfig: {
    files: ['**/*.js'], plugins: {import: require('eslint-plugin-import')},
    rules: {'import/no-internal-modules': ['error', {forbid: ['forbidden/**']}]},
  }});
  const [blocked] = await boundary.lintText('import hidden from "forbidden/internal";', {filePath: 'boundary-fixture.js'});
  assert(blocked.messages.some(message => message.ruleId === 'import/no-internal-modules'));
});
