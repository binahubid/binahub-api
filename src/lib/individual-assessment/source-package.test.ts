import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digest, projectV2SourceParticipant } from '../../../scripts/lib/binainsights-v2.mjs';
import { prepareBinaInsightsRelease, readReleaseRegistry, runPreparationCLI,
  writePrivateRelease } from '../../../scripts/prepare-binainsights-release.mjs';
import { makeSyntheticV2Sources } from './v2-source-fixture';

const folders: string[] = [];
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function temporary() {
  const root = mkdtempSync(join(tmpdir(), 'binainsights-release-test-'));
  folders.push(root);
  return root;
}
afterEach(() => {
  for (const root of folders.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = temporary(), pack = join(root, 'pack');
  mkdirSync(pack);
  const { source, crosswalk } = makeSyntheticV2Sources();
  const replacements: Record<string, unknown> = {
    'BinaInsights_PE_Assessment_Config_v2_Pilot_Private.json': source,
    'BinaInsights_PE_Assessment_Config_v2_Participant_Public.json': projectV2SourceParticipant(source),
    'BinaInsights_Crosswalk_v6_SS32.json': crosswalk,
  };
  const registry = structuredClone(readReleaseRegistry());
  registry.files = registry.files.map((file: { path: string }) => {
    const bytes = Buffer.from(Object.hasOwn(replacements, file.path)
      ? JSON.stringify(replacements[file.path]) : 'Invented source file for testing only.');
    const target = join(pack, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return { path: file.path, bytes: bytes.length, sha256: hash(bytes) };
  });
  const manifestPath = join(pack, registry.manifestFile);
  const updateManifest = () => {
    const content = JSON.stringify({ date: '2026-10-20', status: 'pilot_only', files: registry.files });
    writeFileSync(manifestPath, content);
    registry.manifestSha256 = hash(content);
  };
  updateManifest();
  return { root, pack, source, registry, updateManifest, manifestPath };
}

describe('immutable source release preparation', () => {
  it('verifies all source files and emits a deterministic safe receipt without writing anything', () => {
    const f = fixture(), before = readdirSync(f.pack, { recursive: true });
    const first = prepareBinaInsightsRelease(f.pack, f.registry);
    const second = prepareBinaInsightsRelease(f.pack, f.registry);
    expect(first.summary).toEqual(second.summary);
    expect(first.summary).toMatchObject({ verifiedSourceFiles: 15, totalItems: 37,
      freeItems: 18, additionalItems: 19, catalogSolutions: 32, catalogLinks: 173, status: 'prepared_not_active' });
    expect(first.privateBundle.payloadSha256).toBe(digest(first.privateBundle.payload));
    expect(readdirSync(f.pack, { recursive: true })).toEqual(before);
    expect(JSON.stringify(first.summary)).not.toMatch(/Invented|Synthetic|scoring_key|rationales|option_scores|"scenario":|"prompt":|[A-Z]:\\/);
    expect(first.privateBundle.payload.instrument.sjt_items).toHaveLength(13);
  });

  it('rejects a changed file, including a private source with unchanged file size', () => {
    const f = fixture();
    const target = join(f.pack, f.registry.files[0].path);
    const data = readFileSync(target);
    data[0] = data[0] === 32 ? 33 : 32;
    writeFileSync(target, data);
    expect(() => prepareBinaInsightsRelease(f.pack, f.registry)).toThrow('BINA_SOURCE_FILE_MISMATCH');
  });

  it('pins the manifest too, rather than trusting a rewritten manifest alongside changed sources', () => {
    const f = fixture();
    const oldRegistry = structuredClone(f.registry);
    f.registry.files[0].sha256 = '0'.repeat(64);
    f.updateManifest();
    expect(() => prepareBinaInsightsRelease(f.pack, oldRegistry)).toThrow('BINA_SOURCE_MANIFEST_MISMATCH');
  });

  it('rejects version drift and a manifest with an extra or missing entry', () => {
    const f = fixture();
    f.registry.instrumentVersion = 'other';
    expect(() => prepareBinaInsightsRelease(f.pack, f.registry)).toThrow('BINA_SOURCE_VERSION_MISMATCH');
    f.registry.instrumentVersion = '2.0-pilot';
    f.registry.files.pop();
    f.updateManifest();
    expect(() => prepareBinaInsightsRelease(f.pack, f.registry)).toThrow('BINA_SOURCE_INVENTORY_MISMATCH');
  });

  it.each(['../outside.json', '/absolute.json', 'C:/outside.json', 'bad\\path.json', './source.json', 'nested//source.json'])(
    'rejects unsafe manifest paths (%s)', path => {
      const f = fixture();
      f.registry.files[0].path = path;
      f.updateManifest();
      expect(() => prepareBinaInsightsRelease(f.pack, f.registry)).toThrow('BINA_SOURCE_PATH_INVALID');
    });

  it('rejects duplicate paths on case-insensitive filesystems', () => {
    const f = fixture();
    f.registry.files[1].path = f.registry.files[0].path.toUpperCase();
    f.updateManifest();
    expect(() => prepareBinaInsightsRelease(f.pack, f.registry)).toThrow('BINA_SOURCE_INVENTORY_INVALID');
  });

  it('does not follow a source junction outside the verified package', () => {
    const f = fixture(), outside = join(f.root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'item.json'), 'private sentinel');
    symlinkSync(outside, join(f.pack, 'redirect'), 'junction');
    f.registry.files[0] = { path: 'redirect/item.json', bytes: 16, sha256: hash('private sentinel') };
    f.updateManifest();
    expect(() => prepareBinaInsightsRelease(f.pack, f.registry)).toThrow('BINA_SOURCE_PATH_INVALID');
  });
});

describe('private artifact output boundaries', () => {
  it('writes only to an explicit private filename, with no overwrite', () => {
    const f = fixture(), prepared = prepareBinaInsightsRelease(f.pack, f.registry);
    const target = join(f.root, 'release.private.json');
    expect(() => writePrivateRelease(join(f.root, 'release.json'), prepared.privateBundle))
      .toThrow('BINA_OUTPUT_PRIVATE_SUFFIX_REQUIRED');
    writePrivateRelease(target, prepared.privateBundle);
    const before = readFileSync(target, 'utf8');
    expect(JSON.parse(before)).toEqual(prepared.privateBundle);
    expect(() => writePrivateRelease(target, prepared.privateBundle)).toThrow();
    expect(readFileSync(target, 'utf8')).toBe(before);
    expect(() => writePrivateRelease(join(f.root, 'invalid.private.json'), { ...prepared.privateBundle,
      payloadSha256: '0'.repeat(64) })).toThrow('BINA_PRIVATE_ARTIFACT_INVALID');
  });

  it.each(['directory', 'file'])('rejects any Git checkout including a sibling or worktree (%s marker)', marker => {
    const f = fixture(), prepared = prepareBinaInsightsRelease(f.pack, f.registry);
    const checkout = join(f.root, 'sibling-repository'), outputDir = join(checkout, 'ignored', 'private');
    mkdirSync(outputDir, { recursive: true });
    if (marker === 'directory') mkdirSync(join(checkout, '.git'));
    else writeFileSync(join(checkout, '.git'), 'gitdir: elsewhere');
    const target = join(outputDir, 'release.private.json');
    expect(() => writePrivateRelease(target, prepared.privateBundle)).toThrow('BINA_OUTPUT_INSIDE_GIT_REPOSITORY');
    expect(existsSync(target)).toBe(false);
  });

  it('resolves an output junction before applying the Git boundary', () => {
    const f = fixture(), prepared = prepareBinaInsightsRelease(f.pack, f.registry);
    const checkout = join(f.root, 'git-repo'), outputDir = join(checkout, 'private');
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(join(checkout, '.git'));
    symlinkSync(outputDir, join(f.root, 'misleading-output'), 'junction');
    expect(() => writePrivateRelease(join(f.root, 'misleading-output', 'release.private.json'), prepared.privateBundle))
      .toThrow('BINA_OUTPUT_INSIDE_GIT_REPOSITORY');
  });

  it('redacts native IO and JSON diagnostics and has no force or activation flag', () => {
    const secretPath = join(temporary(), 'sensitive-name-that-must-not-appear');
    expect(runPreparationCLI([secretPath])).toEqual({ exitCode: 1, stdout: '', stderr: 'BINA_PREPARATION_FAILED\n' });
    for (const args of [[], ['--force'], ['source', '--force'], ['source', '--activate'],
      ['source', '--output'], ['source', '--output', 'out.private.json', 'extra']]) {
      expect(runPreparationCLI(args)).toEqual({ exitCode: 1, stdout: '', stderr: 'BINA_USAGE_INVALID\n' });
    }
  });
});
