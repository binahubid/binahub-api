import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, getV2PreparationSummary, validateV2Sources } from './lib/binainsights-v2.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const parse = buffer => JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function within(root, path) {
  const position = relative(root, path);
  return position !== '..' && !position.startsWith('..' + sep) && !isAbsolute(position);
}
export function readReleaseRegistry() {
  return parse(readFileSync(resolve(ROOT, 'src/data/binainsights-release-2026-10-20.json')));
}

/** Hash the exact bytes before parsing any source JSON; never execute source Python. */
export function prepareBinaInsightsRelease(directory, registry = readReleaseRegistry()) {
  requireValue(registry.schemaVersion === 1 && registry.status === 'prepared_not_active', 'BINA_RELEASE_INVALID');
  const sourceRoot = realpathSync(directory);
  const read = path => {
    requireValue(typeof path === 'string' && path.length > 0 && !path.includes('\\')
      && !path.includes(':') && !isAbsolute(path)
      && path.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'BINA_SOURCE_PATH_INVALID');
    const actual = realpathSync(resolve(sourceRoot, path));
    requireValue(within(sourceRoot, actual), 'BINA_SOURCE_PATH_INVALID');
    const info = statSync(actual);
    requireValue(info.isFile() && info.size <= MAX_FILE_BYTES, 'BINA_SOURCE_FILE_INVALID');
    const bytes = readFileSync(actual);
    requireValue(bytes.length <= MAX_FILE_BYTES, 'BINA_SOURCE_FILE_INVALID');
    return bytes;
  };
  const manifestBytes = read(registry.manifestFile);
  requireValue(sha256(manifestBytes) === registry.manifestSha256, 'BINA_SOURCE_MANIFEST_MISMATCH');
  const manifest = parse(manifestBytes);
  requireValue(Array.isArray(manifest.files) && manifest.files.length === 15
    && Array.isArray(registry.files) && registry.files.length === 15
    && digest(manifest.files) === digest(registry.files), 'BINA_SOURCE_INVENTORY_MISMATCH');
  const seen = new Set();
  const files = new Map();
  for (const entry of manifest.files) {
    requireValue(entry && typeof entry.path === 'string' && !seen.has(entry.path.toLowerCase())
      && Number.isSafeInteger(entry.bytes) && entry.bytes > 0
      && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256), 'BINA_SOURCE_INVENTORY_INVALID');
    seen.add(entry.path.toLowerCase());
    const bytes = read(entry.path);
    requireValue(bytes.length === entry.bytes && sha256(bytes) === entry.sha256, 'BINA_SOURCE_FILE_MISMATCH');
    files.set(entry.path, bytes);
  }
  const json = name => {
    requireValue(files.has(name), 'BINA_SOURCE_REQUIRED_FILE_MISSING');
    return parse(files.get(name));
  };
  const validated = validateV2Sources(json('BinaInsights_PE_Assessment_Config_v2_Pilot_Private.json'),
    json('BinaInsights_PE_Assessment_Config_v2_Participant_Public.json'),
    json('BinaInsights_Crosswalk_v6_SS32.json'));
  const summary = getV2PreparationSummary(validated);
  requireValue(summary.instrumentId === registry.instrumentId && summary.instrumentVersion === registry.instrumentVersion
    && summary.dictionaryVersion === registry.dictionaryVersion && summary.catalogVersion === registry.catalogVersion
    && summary.sourceRulesVersion === registry.recommendationRulesVersion
    && summary.reportTemplateVersion === registry.reportTemplateVersion, 'BINA_SOURCE_VERSION_MISMATCH');
  const payload = {
    schemaVersion: 1, releaseId: registry.releaseId, status: 'prepared_not_active',
    provenance: { manifestSha256: registry.manifestSha256, files: registry.files },
    instrument: validated.instrument, catalogCrosswalk: validated.crosswalk,
  };
  return { summary: { releaseId: registry.releaseId, ...summary,
    verifiedSourceFiles: files.size, payloadSha256: digest(payload) },
  privateBundle: { payload, payloadSha256: digest(payload) }, validated };
}

/** No output is allowed inside ANY Git checkout, including sibling projects or junctions. */
export function writePrivateRelease(output, bundle) {
  requireValue(bundle?.payload?.schemaVersion === 1 && bundle.payload.status === 'prepared_not_active'
    && digest(bundle.payload) === bundle.payloadSha256, 'BINA_PRIVATE_ARTIFACT_INVALID');
  requireValue(output.endsWith('.private.json'), 'BINA_OUTPUT_PRIVATE_SUFFIX_REQUIRED');
  const target = resolve(output);
  // Parent must already exist. Resolve junctions before walking to the filesystem root.
  let parent = realpathSync(dirname(target));
  const actualTarget = resolve(parent, basename(target));
  while (true) {
    requireValue(!existsSync(resolve(parent, '.git')), 'BINA_OUTPUT_INSIDE_GIT_REPOSITORY');
    const ancestor = dirname(parent);
    if (ancestor === parent) break;
    parent = ancestor;
  }
  writeFileSync(actualTarget, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

export function runPreparationCLI(args) {
  try {
    const [source, option, output, ...extra] = args;
    requireValue(source && !source.startsWith('-') && extra.length === 0
      && ((option === undefined && output === undefined) || (option === '--output' && output)), 'BINA_USAGE_INVALID');
    const prepared = prepareBinaInsightsRelease(source);
    if (output) writePrivateRelease(output, prepared.privateBundle);
    // Allowlisted receipt only. No source paths, items, answer keys or native error messages.
    return { exitCode: 0, stdout: JSON.stringify({ ...prepared.summary,
      privateArtifactCreated: Boolean(output), databaseChanged: false, sendingActivated: false }) + '\n', stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { exitCode: 1, stdout: '', stderr: (/^BINA_[A-Z0-9_]+$/.test(message)
      ? message : 'BINA_PREPARATION_FAILED') + '\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runPreparationCLI(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
