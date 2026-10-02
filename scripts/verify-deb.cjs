'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
async function main() {
  const { getCurrentFuseWire, FuseV1Options, FuseState } = await import('@electron/fuses');
  const root = path.resolve(__dirname, '..');
  const pkg = require('../package.json');
  const archive = path.join(root, `dist/${pkg.name}_${pkg.version.replace('-', '~')}_amd64.deb`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ips-deb-check-'));
  try {
    execFileSync('dpkg-deb', ['-x', archive, tmp]);
    execFileSync('dpkg-deb', ['-e', archive, path.join(tmp, 'DEBIAN')]);
    const read = (file) => fs.readFileSync(path.join(tmp, file), 'utf8');
    const control = read('DEBIAN/control');
    assert.match(control, /^Architecture: amd64$/m);
    assert.match(control, /^Depends: apparmor \(>= 4.0\),/m);
    assert.match(control, /^Version: 0\.1\.0~experimental\.1$/m);
    const install = 'opt/inplainsight-studio';
    const app = `${install}/resources/app`;
    const fuses = await getCurrentFuseWire(path.join(tmp, install, pkg.name));
    for (const fuse of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments]) assert.equal(fuses[fuse], FuseState.DISABLE);
    assert.equal(JSON.parse(read(`${app}/package.json`)).version, pkg.version);
    assert.equal(read(`${install}/version`).trim(), pkg.devDependencies.electron);
    assert.match(read(`${app}/src/main.cjs`), /sandbox: true/);
    assert.ok(fs.existsSync(path.join(tmp, install, 'LICENSES.chromium.html')));
    for (const dep of ['libsodium-sumo', 'libsodium-wrappers-sumo', 'pngjs']) {
      assert.ok(fs.existsSync(path.join(tmp, app, 'node_modules', dep, 'LICENSE')));
    }
    assert.ok(!fs.existsSync(path.join(tmp, install, 'resources/default_app.asar')));
    assert.ok(!fs.existsSync(path.join(tmp, app, 'node_modules/electron')));
    const desktop = read('usr/share/applications/inplainsight-studio.desktop');
    assert.match(desktop, /^Exec=\/opt\/inplainsight-studio\/inplainsight-studio$/m);
    assert.match(desktop, /^Icon=inplainsight-studio$/m);
    assert.ok(fs.existsSync(path.join(tmp, 'usr/share/icons/hicolor/scalable/apps/inplainsight-studio.svg')));
    const profile = read('etc/apparmor.d/inplainsight-studio');
    assert.match(profile, /profile inplainsight-studio \/opt\/inplainsight-studio\/inplainsight-studio flags=\(unconfined\)/);
    assert.match(profile, /\n  userns,\n/);
    assert.ok(!profile.includes('*'));
    for (const script of ['postinst', 'prerm']) {
      execFileSync('sh', ['-n', path.join(tmp, 'DEBIAN', script)]);
      assert.doesNotMatch(read(`DEBIAN/${script}`), /sysctl|chmod|no-sandbox|systemctl/);
    }
    function inspect(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        const stat = fs.lstatSync(file);
        assert.equal(stat.mode & 0o6000, 0, `No setuid/setgid: ${file}`);
        assert.equal(stat.mode & 0o022, 0, `No group/world writes: ${file}`);
        if (entry.isDirectory()) inspect(file);
      }
    }
    inspect(tmp);
    // Exercise the shipped production modules from the extracted artifact.
    fs.cpSync(path.join(root, 'test'), path.join(tmp, app, 'test'), { recursive: true });
    execFileSync(process.execPath, ['--test', ...fs.readdirSync(path.join(tmp, app, 'test')).filter(x => x.endsWith('.test.cjs')).map(x => path.join(tmp, app, 'test', x))], { cwd: path.join(tmp, app), stdio: 'inherit', env: { ...process.env, IPS_PACKAGING_FIXTURES: path.join(tmp, 'DEBIAN') } });
    execFileSync(process.execPath, ['-e', `const c=require(${JSON.stringify(path.join(tmp, app, 'src/core.cjs'))}); if(!c.MAX_FILE_BYTES)process.exit(1);`]);
    console.log('PASS: Debian metadata, payload, runtime/dependency licenses, menu/icon, exact-path AppArmor profile, script syntax, safe permissions, bundled module loading, and tests against the extracted app.');
    console.log('Native package installation, AppArmor loading and GUI launch are not exercised by this check.');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
