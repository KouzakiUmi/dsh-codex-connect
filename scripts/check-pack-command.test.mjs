import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

// Exercise check-pack's actual spawn call without running npm or a shell.
const originalSpawn = childProcess.spawnSync
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const sentinel = new Error('pack invocation observed')
try {
  for (const platform of ['linux', 'win32']) {
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    childProcess.spawnSync = (command, args, options) => {
      assert.equal(command, platform === 'win32'
        ? process.env.ComSpec ?? process.env.COMSPEC ?? process.env.comspec ?? 'cmd.exe'
        : 'npm')
      if (platform === 'win32') {
        assert.deepEqual(args.slice(0, 3), ['/d', '/s', '/c'])
        assert.match(args[3], /npm\.cmd/u)
        assert.equal(options.windowsVerbatimArguments, true)
      } else {
        assert.deepEqual(args, ['pack', '--dry-run', '--json', '--ignore-scripts'])
      }
      assert.equal(options.shell, undefined)
      throw sentinel
    }
    syncBuiltinESMExports()
    await assert.rejects(import(`./check-pack.mjs?platform=${platform}`), error => error === sentinel)
    process.stdout.write(`ok - real pack spawn resolves ${platform} command\n`)
  }
} finally {
  Object.defineProperty(process, 'platform', platformDescriptor)
  childProcess.spawnSync = originalSpawn
  syncBuiltinESMExports()
}
