'use strict';
// Electron's documented prebuilt-binary layout; no runtime npm or Node install.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
async function main() {
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const root = path.resolve(__dirname, '..');
  process.chdir(root);
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build on Linux x86_64.');
  const pkg = require('../package.json');
  const lock = require('../package-lock.json');
  const electron = path.join(root, 'node_modules/electron/dist');
  if (!fs.existsSync(path.join(electron, 'version'))) throw new Error('Electron runtime missing; run npm run setup:electron.');
  if (fs.readFileSync(path.join(electron, 'version'), 'utf8').trim() !== pkg.devDependencies.electron) throw new Error('Electron runtime version mismatch; run npm ci.');
  const elf = fs.readFileSync(path.join(electron, 'electron'));
  if (elf.readUInt32BE(0) !== 0x7f454c46 || elf[4] !== 2 || elf.readUInt16LE(18) !== 62) throw new Error('Electron must be a Linux amd64 ELF.');
  const version = pkg.version.replace('-', '~');
  if (!/^\d+\.\d+\.\d+~[a-z0-9.]+$/.test(version)) throw new Error('Expected prerelease version.');
  const epoch = process.env.SOURCE_DATE_EPOCH || execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(epoch)) throw new Error('Invalid SOURCE_DATE_EPOCH.');
  const stage = path.join(root, 'dist/deb-root');
  fs.rmSync(stage, { recursive: true, force: true });
  const out = path.join(root, `dist/${pkg.name}_${version}_amd64.deb`);
  function write(file, data, mode = 0o644) {
    const dest = path.join(stage, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data, { mode });
  }
  function copy(source, target) {
    fs.mkdirSync(path.dirname(path.join(stage, target)), { recursive: true });
    fs.cpSync(path.join(root, source), path.join(stage, target), { recursive: true });
  }
  const install = 'opt/inplainsight-studio';
  copy('node_modules/electron/dist', install);
  fs.renameSync(path.join(stage, install, 'electron'), path.join(stage, install, pkg.name));
  await flipFuses(path.join(stage, install, pkg.name), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
  fs.rmSync(path.join(stage, install, 'resources/default_app.asar'), { force: true });
  // Prefer the user-namespace sandbox; never ship a setuid-root helper.
  fs.chmodSync(path.join(stage, install, 'chrome-sandbox'), 0o755);
  const appDir = `${install}/resources/app`;
  write(`${appDir}/package.json`, JSON.stringify({ name: pkg.name, productName: 'InPlainSight Studio', version: pkg.version, main: pkg.main, description: pkg.description }, null, 2) + '\n');
  copy('src', `${appDir}/src`);
  copy('packaging/linux/inplainsight-studio.svg', `${appDir}/assets/icon.svg`);
  // The lockfile is the runtime dependency allowlist, including transitive deps.
  for (const [location, metadata] of Object.entries(lock.packages)) {
    if (!location || metadata.dev) continue;
    if (!/^node_modules\/[a-zA-Z0-9@/_.-]+$/.test(location) || location.includes('..')) throw new Error('Unsafe dependency path.');
    const installed = JSON.parse(fs.readFileSync(path.join(root, location, 'package.json')));
    if (installed.version !== metadata.version) throw new Error(`Dependency version mismatch: ${location}`);
    copy(location, `${appDir}/${location}`);
  }
  copy('packaging/linux/inplainsight-studio.desktop', 'usr/share/applications/inplainsight-studio.desktop');
  copy('packaging/linux/inplainsight-studio.svg', 'usr/share/icons/hicolor/scalable/apps/inplainsight-studio.svg');
  copy('packaging/linux/inplainsight-studio.apparmor', 'etc/apparmor.d/inplainsight-studio');
  copy('README.md', 'usr/share/doc/inplainsight-studio/README.md');
  copy('docs/INSTALL-UBUNTU.md', 'usr/share/doc/inplainsight-studio/INSTALL-UBUNTU.md');
  write('usr/share/doc/inplainsight-studio/copyright', 'InPlainSight Studio: no project license has been selected; no additional license grant is implied.\nThird-party licenses are retained alongside Electron and each bundled npm dependency.\nSource: https://github.com/VinnyMo/inplainsight-studio\n');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  write(`${appDir}/build-info.json`, JSON.stringify({ revision, dirty, electron: pkg.devDependencies.electron, sourceDateEpoch: epoch }, null, 2) + '\n');
  function installedBytes(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
      const file = path.join(dir, entry.name);
      return sum + (entry.isDirectory() ? 4096 + installedBytes(file) : fs.statSync(file).size);
    }, 0);
  }
  const size = Math.ceil(installedBytes(stage) / 1024);
  write('DEBIAN/control', `Package: ${pkg.name}\nVersion: ${version}\nArchitecture: amd64\nMaintainer: InPlainSight Studio\nSection: utils\nPriority: optional\nInstalled-Size: ${size}\nHomepage: https://github.com/VinnyMo/inplainsight-studio\nDepends: apparmor (>= 4.0), libasound2t64, libatk-bridge2.0-0t64, libatk1.0-0t64, libatspi2.0-0t64, libc6 (>= 2.38), libcairo2, libcups2t64, libdbus-1-3, libexpat1, libgbm1, libgcc-s1, libglib2.0-0t64, libgtk-3-0t64, libnspr4, libnss3, libpango-1.0-0, libudev1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2\nDescription: Experimental offline encrypted PNG desktop application\n Create and recover encrypted PNG containers locally. Not security-audited.\n Keep backups of original files. Ubuntu 24.04+ amd64 test build.\n`);
  for (const script of ['postinst', 'prerm']) {
    copy(`packaging/linux/${script}`, `DEBIAN/${script}`);
    fs.chmodSync(path.join(stage, 'DEBIAN', script), 0o755);
  }
  // Normalize permissions and timestamps; archive ownership is root:root.
  function normalize(dir) {
    fs.chmodSync(dir, 0o755);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${file}`);
      if (entry.isDirectory()) { normalize(file); fs.chmodSync(file, 0o755); }
      else fs.chmodSync(file, stat.mode & 0o111 ? 0o755 : 0o644);
      fs.utimesSync(file, Number(epoch), Number(epoch));
    }
    fs.utimesSync(dir, Number(epoch), Number(epoch));
  }
  normalize(stage);
  execFileSync('dpkg-deb', ['--root-owner-group', '--uniform-compression', '-Zxz', '-z6', '--threads-max=1', '--build', stage, out], { stdio: 'inherit', env: { ...process.env, SOURCE_DATE_EPOCH: epoch } });
  const hash = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  fs.writeFileSync(`${out}.sha256`, `${hash}  ${path.basename(out)}\n`);
  console.log(`${out}\nSHA256 ${hash}\n${fs.statSync(out).size} bytes`);

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
