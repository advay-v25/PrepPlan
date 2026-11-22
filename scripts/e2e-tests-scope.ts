/** Own-account replacement for the retired reset-based harness. Pass an explicit disposable target and app URL. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

for (const script of ["task-execution-http-test.cjs","learning-log-http-test.cjs"]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' })
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
}
