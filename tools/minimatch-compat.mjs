import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);

// Lint-process-only bridge. The patched v11 engine remains the sole matcher;
// no node_modules files or install/build hooks are changed.
const resolved = require.resolve('minimatch');
const engine = require(resolved);
if (typeof engine !== 'function') {
  const callable = Object.assign(
    (path, pattern, options) => engine.minimatch(path, pattern, options),
    engine,
  );
  callable.makeRe = (pattern, options) => {
    const matcher = new engine.Minimatch(pattern, options);
    return {test: value => matcher.match(value)};
  };
  require.cache[resolved].exports = callable;
}
