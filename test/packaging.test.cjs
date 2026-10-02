'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
// Mock only the system boundary; never load a kernel profile or install a package.
test('package scripts load exact profile, recover aborted changes, and fail closed', { skip: process.platform !== 'linux' }, () => {
  const root = path.resolve(__dirname, '..');
  // Artifact verification copies the fixtures beside tests, outside the payload.
  const fixtures = process.env.IPS_PACKAGING_FIXTURES || path.join(root, 'packaging/linux');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ips-scripts-'));
  try {
    const enabled = path.join(tmp, 'enabled');
    const profiles = path.join(tmp, 'profiles');
    const log = path.join(tmp, 'calls');
    const parser = path.join(tmp, 'parser');
    fs.writeFileSync(parser, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$IPS_LOG"\nexit "${IPS_EXIT:-0}"\n', { mode: 0o755 });
    fs.writeFileSync(enabled, 'Y\n');
    fs.writeFileSync(profiles, 'inplainsight-studio (unconfined)\n');
    function run(script, action, code = 0) {
      fs.writeFileSync(log, '');
      const text = fs.readFileSync(path.join(fixtures, script), 'utf8')
        .replaceAll('/sys/module/apparmor/parameters/enabled', enabled)
        .replaceAll('/sys/kernel/security/apparmor/profiles', profiles)
        .replaceAll('/sbin/apparmor_parser', parser);
      const scriptPath = path.join(tmp, script);
      fs.writeFileSync(scriptPath, text);
      const result = spawnSync('sh', [scriptPath, action], { env: { ...process.env, IPS_LOG: log, IPS_EXIT: String(code) } });
      return { status: result.status, calls: fs.readFileSync(log, 'utf8') };
    }
    for (const action of ['configure', 'abort-upgrade', 'abort-remove', 'abort-deconfigure']) {
      assert.deepEqual(run('postinst', action), { status: 0, calls: '--replace /etc/apparmor.d/inplainsight-studio\n' });
    }
    assert.equal(run('postinst', 'configure', 17).status, 17);
    for (const action of ['remove', 'deconfigure']) assert.deepEqual(run('prerm', action), { status: 0, calls: '--remove /etc/apparmor.d/inplainsight-studio\n' });
    assert.equal(run('prerm', 'remove', 19).status, 19);
    assert.deepEqual(run('prerm', 'upgrade'), { status: 0, calls: '' });
    fs.writeFileSync(profiles, 'unrelated (unconfined)\n');
    assert.deepEqual(run('prerm', 'remove'), { status: 0, calls: '' });
    fs.writeFileSync(enabled, 'N\n');
    assert.deepEqual(run('postinst', 'configure'), { status: 0, calls: '' });
    assert.deepEqual(run('prerm', 'remove'), { status: 0, calls: '' });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
