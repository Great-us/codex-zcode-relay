'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { ProtocolClient } = require('../protocol.cjs');

function fakeWorker(onMessage = () => {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => { child.killed = true; return true; };
  let input = '';
  child.stdin = new Writable({ write(chunk, _, done) {
    input += chunk.toString();
    let index;
    while ((index = input.indexOf('\n')) !== -1) {
      const message = JSON.parse(input.slice(0, index));
      assert.equal(Object.hasOwn(message, 'jsonrpc'), false, 'native outbound wire must not include jsonrpc');
      input = input.slice(index + 1);
      onMessage(message, child);
    }
    done();
  } });
  child.send = message => child.stdout.write(JSON.stringify(message) + '\n');
  return child;
}
function setup(onMessage) {
  const child = fakeWorker(onMessage);
  let options;
  const client = new ProtocolClient({ command: 'fake', args: ['worker'], env: { SAMPLE: '1' }, cwd: 'workspace',
    processFactory(command, args, opts) { options = { command, args, ...opts }; return child; }
  });
  return { client, child, options };
}

test('requests correlate IDs and parse fragmented lines; spawn is hidden', async t => {
  const { client, child, options } = setup((message, worker) => {
    const line = JSON.stringify({ id: message.id, result: { method: message.method } }) + '\n';
    worker.stdout.write(line.slice(0, 8)); worker.stdout.write(line.slice(8));
  });
  t.after(() => client.close());
  assert.equal(options.windowsHide, true);
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  child.stdout.write('unknown startup output\n{"secret":"never forwarded"}\n');
  assert.deepEqual(await client.request('session/create', {}), { method: 'session/create' });
  assert.equal(client.pending.size, 0);
});

test('completion notification can arrive before send response without loss', async t => {
  const { client } = setup((message, worker) => {
    worker.send({ method: 'session/event', params: { event: { type: 'turn.completed', sessionId: 's' } } });
    setImmediate(() => worker.send({ id: message.id, result: { accepted: true } }));
  });
  t.after(() => client.close());
  const order = [];
  client.on('notification', message => assert.equal(message.method, 'session/event'));
  client.on('event', event => order.push(event.type));
  await client.request('session/send', {}); order.push('reply');
  assert.deepEqual(order, ['turn.completed', 'reply']);
});

test('runtime preferences reply is bounded and unknown host requests are rejected', async t => {
  const replies = [];
  const { client, child } = setup(message => replies.push(message));
  t.after(() => client.close());
  const observed = [];
  client.on('hostRequest', message => observed.push(message.method));
  child.send({ id: 'p', method: 'session/requestRuntimePreferences' });
  child.send({ id: 'u', method: 'permission/request', params: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(replies[0].result, { nativeSearchEnhancementsEnabled: false, memoryEnabled: false,
    askUserQuestionAutoResolutionEnabled: false, modelContextBudgetStrategy: 'preflight-v1' });
  assert.equal(replies[1].error.code, -32601);
  assert.deepEqual(observed, ['permission/request']);
});

test('timeout rejects just its request and permits later replies', async t => {
  const { client, child } = setup();
  t.after(() => client.close());
  await assert.rejects(client.request('session/send', {}, { timeoutMs: 10 }), /timed out/);
  assert.equal(client.pending.size, 0);
  const request = client.request('session/read', {});
  child.send({ id: 2, result: 'ok' });
  assert.equal(await request, 'ok');
});

test('exit rejects all pending, emits closed once and redacts stderr', async () => {
  const { client, child } = setup();
  const failures = [client.request('a', {}), client.request('b', {})].map(promise => assert.rejects(promise, /Worker exited/));
  let closed = 0, diagnostic;
  client.on('closed', error => { closed++; diagnostic = error.message; });
  child.stderr.write('Authorization: Bearer HIGHLY_SECRET\napi_key=PRIVATE\nstartup unavailable\n');
  child.exitCode = 1; child.emit('exit', 1, null); child.emit('close', 1, null);
  await Promise.all(failures);
  assert.equal(closed, 1);
  assert.doesNotMatch(diagnostic, /HIGHLY_SECRET|PRIVATE/);
  assert.match(diagnostic, /startup unavailable/);
  await assert.rejects(client.request('c', {}), /Worker exited/);
});

test('broken pipe rejects pending and closes only its owned worker', async () => {
  const { client, child } = setup();
  const request = assert.rejects(client.request('a', {}), /Worker input failed/);
  const closed = once(client, 'closed');
  child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  await request; await closed;
  assert.equal(child.killed, true);
});

test('explicit close clears pending and is idempotent', async () => {
  const { client, child } = setup();
  let closes = 0; client.on('closed', () => closes++);
  const request = assert.rejects(client.request('a', {}), /client closed/);
  client.close(); client.close();
  await request;
  assert.equal(closes, 1); assert.equal(child.killed, true); assert.equal(client.pending.size, 0);
});

test('spawn errors are surfaced without an unhandled error event', async () => {
  const client = new ProtocolClient({ processFactory() { throw new Error('ENOENT'); } });
  const closed = once(client, 'closed');
  await assert.rejects(client.request('a', {}), /ENOENT/);
  await closed;
});

test('split credential stderr never leaks an incomplete sensitive line', async () => {
  const { client, child } = setup();
  let diagnostic;
  client.on('closed', error => { diagnostic = error.message; });
  child.stderr.write('Author'); child.stderr.write('ization: Bearer ');
  child.stderr.write('CHUNKED_SECRET\n');
  child.stderr.write('token=TAIL_SECRET');
  child.exitCode = 2; child.emit('exit', 2, null);
  assert.doesNotMatch(diagnostic, /CHUNKED_SECRET|TAIL_SECRET/);
});

test('real local child speaks NDJSON and emits direct event before response', async t => {
  const script = `
    const readline = require('node:readline');
    const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
    readline.createInterface({input:process.stdin}).on('line', line => {
      const m = JSON.parse(line);
      if (Object.hasOwn(m, 'jsonrpc')) {
        process.stderr.write('Invalid native wire: jsonrpc field present');
        process.exit(2);
      }
      process.stdout.write('non protocol startup text\\n');
      send({method:'session/event',params:{eventId:'e',sessionId:'s',seq:1,
        timestamp:1,type:'turn.completed',payload:{resultType:'success',response:'done'}}});
      send({id:m.id,result:{accepted:true}});
    });`;
  const client = new ProtocolClient({ command: process.execPath, args: ['-e', script] });
  t.after(() => client.close());
  const completion = once(client, 'event');
  assert.deepEqual(await client.request('session/send', {}, {timeoutMs: 5000}), {accepted:true});
  const [event] = await completion;
  assert.equal(event.type, 'turn.completed');
  assert.equal(event.payload.resultType, 'success');
});

test('native LOGIN_REQUIRED startup diagnostic is retained', async () => {
  const { client, child } = setup();
  let diagnostic;
  client.on('closed', error => { diagnostic = error.message; });
  child.stderr.write('ZCODE_LOGIN_REQUIRED: Run native-runner.cjs login once. Desktop login is separate.\n');
  child.exitCode = 1; child.emit('exit', 1, null);
  assert.match(diagnostic, /ZCODE_LOGIN_REQUIRED: Run native-runner\.cjs login once/);
});
