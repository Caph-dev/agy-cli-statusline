import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { confirmReplace, runEditor } from '../lib/editor.mjs';

function terminal() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = raw => { stdin.isRaw = raw; };
  const stdout = new EventEmitter();
  stdout.isTTY = true;
  stdout.columns = 80;
  stdout.rows = 24;
  return { stdin, stdout };
}

for (const surface of [runEditor, confirmReplace]) {
  test(`${surface.name} restores the terminal when its first draw fails`, async () => {
    const { stdin, stdout } = terminal();
    const frames = [];
    stdout.write = frame => {
      if (frame.startsWith('\x1b[2J')) throw new Error('draw failed');
      frames.push(frame);
    };
    const signals = process.listenerCount('SIGTERM');
    await assert.rejects(surface({ stdin, stdout }), /draw failed/);
    assert.equal(stdin.isRaw, false);
    assert.match(frames.at(-1), /\x1b\[\?25h\x1b\[\?1049l/);
    assert.equal(stdin.listenerCount('keypress'), 0);
    assert.equal(stdout.listenerCount('resize'), 0);
    assert.equal(process.listenerCount('SIGTERM'), signals);
  });
}

test('an interrupted save reports the completed write', async () => {
  const { stdin, stdout } = terminal();
  stdout.write = () => true;
  const originalExitCode = process.exitCode;
  let finishSave;
  try {
    const result = runEditor({
      stdin, stdout,
      onSave: () => new Promise(resolve => { finishSave = resolve; }),
    });
    stdin.emit('keypress', '\r', { name: 'return' });
    process.emit('SIGTERM');
    assert.equal(stdin.isRaw, true);
    finishSave();
    assert.equal((await result).saved, true);
    assert.equal(stdin.isRaw, false);
  } finally {
    process.exitCode = originalExitCode;
  }
});
