/** Throwaway local Postgres cluster for installation / restore rehearsals. Recorded handle: <dir>/postmaster.pid. Loopback only, trust auth, random-free fixed port per call. */
const { spawnSync } = require('node:child_process'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const BIN = ['/opt/homebrew/opt/postgresql@18/bin', '/opt/homebrew/opt/postgresql@15/bin', '/opt/homebrew/bin'].find(d => fs.existsSync(path.join(d, 'initdb')))
const run = (cmd, args, o = {}) => { const r = spawnSync(path.join(BIN, cmd), args, { encoding: 'utf8', ...o }); if (r.status !== 0 && !o.allowFail) throw Error(`${cmd} failed: ${(r.stderr || r.stdout || '').slice(0, 400)}`); return r }
function start(dir, port) {
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) run('initdb', ['-D', dir, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'])
  run('pg_ctl', ['-D', dir, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dir}`, '-l', path.join(dir, 'server.log'), '-w', 'start'])
}
const stop = dir => run('pg_ctl', ['-D', dir, '-m', 'fast', '-w', 'stop'], { allowFail: true })
module.exports = { BIN, run, start, stop, tmp: () => fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-pg-')) }
