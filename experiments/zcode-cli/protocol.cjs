'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

// Keep diagnostics useful without retaining credential-bearing lines.
function safeDiagnostic(value) {
  return String(value ?? '').split(/\r?\n/).map(line =>
    /authorization|bearer|token|key|secret|password|pass.?hash|credential|cookie|jwt|runtime.?headers/i.test(line)
      ? '[sensitive diagnostic omitted]' : line.slice(0, 512)
  ).slice(-8).join('\n').slice(-2048);
}

class ProtocolClient extends EventEmitter {
  constructor({ command, args = [], env, cwd, processFactory = spawn } = {}) {
    super();
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.stderrTail = '';
    this.stderrBuffer = '';
    this.discardStderrLine = false;
    this.closedError = null;
    this.discardLine = false;
    this.child = null;
    try {
      this.child = processFactory(command, args, {
        env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
      if (!this.child?.stdin || !this.child?.stdout) throw new Error('Worker has no protocol streams');
      this.child.stdout.setEncoding?.('utf8');
      this.child.stderr?.setEncoding?.('utf8');
      this.child.stdout.on('data', data => this._read(String(data)));
      this.child.stderr?.on('data', data => {
        this._readStderr(String(data));
      });
      this.child.stdin.on('error', error => this._finish(new Error(`Worker input failed: ${safeDiagnostic(error.message)}`)));
      this.child.stdout.on('error', error => this._finish(new Error(`Worker output failed: ${safeDiagnostic(error.message)}`)));
      this.child.stderr?.on('error', () => {});
      this.child.on('error', error => this._finish(new Error(`Worker failed to start: ${safeDiagnostic(error.message)}`)));
      this.child.on('exit', (code, signal) => this._finish(new Error(
        `Worker exited (code=${code ?? 'none'}, signal=${signal ?? 'none'})` +
        (this._diagnosticTail() ? `\n${this._diagnosticTail()}` : '')
      )));
      this.child.on('close', (code, signal) => this._finish(new Error(
        `Worker closed (code=${code ?? 'none'}, signal=${signal ?? 'none'})`
      )));
    } catch (error) {
      const failure = new Error(`Worker failed to start: ${safeDiagnostic(error.message)}`);
      this.closedError = failure;
      queueMicrotask(() => this.emit('closed', failure));
      this._killOwnedChild();
    }
  }

  _readStderr(chunk) {
    for (const part of chunk.split(/(?<=\n)/)) {
      if (this.discardStderrLine) {
        if (part.endsWith('\n')) this.discardStderrLine = false;
        continue;
      }
      this.stderrBuffer += part;
      if (this.stderrBuffer.length > 4096) {
        this.stderrBuffer = '';
        this.discardStderrLine = !part.endsWith('\n');
        this.stderrTail = (this.stderrTail + '[oversize diagnostic omitted]\n').slice(-2048);
        continue;
      }
      if (part.endsWith('\n')) {
        this.stderrTail = (this.stderrTail + safeDiagnostic(this.stderrBuffer) + '\n').slice(-2048);
        this.stderrBuffer = '';
      }
    }
  }

  _diagnosticTail() {
    return safeDiagnostic(this.stderrTail + this.stderrBuffer);
  }

  request(method, params, { timeoutMs = 45000 } = {}) {
    if (this.closedError) return Promise.reject(this.closedError);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('timeoutMs must be positive'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Protocol request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._write({ id, method, params });
    });
  }

  _write(message) {
    if (this.closedError) return;
    try {
      this.child.stdin.write(JSON.stringify(message) + '\n', error => {
        if (error) this._finish(new Error(`Worker input failed: ${safeDiagnostic(error.message)}`));
      });
    } catch (error) {
      this._finish(new Error(`Worker input failed: ${safeDiagnostic(error.message)}`));
    }
  }

  _read(chunk) {
    if (this.closedError) return;
    // Bound malformed/noisy stdout. Protocol lines may include large snapshots.
    const MAX_LINE = 16 * 1024 * 1024;
    for (const part of chunk.split(/(?<=\n)/)) {
      if (this.discardLine) {
        if (part.endsWith('\n')) this.discardLine = false;
        continue;
      }
      this.buffer += part;
      if (this.buffer.length > MAX_LINE) {
        this.buffer = '';
        this.discardLine = !part.endsWith('\n');
        continue;
      }
      if (!part.endsWith('\n')) continue;
      const line = this.buffer.trim();
      this.buffer = '';
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
      // Native ZCode NDJSON has no jsonrpc field; accept 2.0 peers as well.
      if (Object.hasOwn(message, 'jsonrpc') && message.jsonrpc !== '2.0') continue;
      this._message(message);
    }
  }

  _message(message) {
    if (typeof message.method === 'string') {
      if (Object.hasOwn(message, 'id')) {
        if (message.method === 'session/requestRuntimePreferences') {
          this._write({ id: message.id, result: {
            nativeSearchEnhancementsEnabled: false,
            memoryEnabled: false,
            askUserQuestionAutoResolutionEnabled: false,
            modelContextBudgetStrategy: 'preflight-v1'
          } });
        } else {
          // Observe only: listeners cannot accidentally grant a host permission.
          this._write({ id: message.id, error: {
            code: -32601, message: 'Host request is not supported by this controller'
          } });
          this.emit('hostRequest', message);
        }
      } else {
        this.emit('notification', message);
        if (message.method === 'session/event') {
          this.emit('event', message.params?.event ?? message.params);
        }
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending || (!Object.hasOwn(message, 'result') && !Object.hasOwn(message, 'error'))) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new Error(safeDiagnostic(message.error.message || 'Protocol request failed'));
      error.code = message.error.code;
      pending.reject(error);
    } else pending.resolve(message.result);
  }

  _finish(error) {
    if (this.closedError) return;
    this.closedError = error;
    this.buffer = '';
    this.stderrBuffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this._killOwnedChild();
    this.emit('closed', error);
  }

  _killOwnedChild() {
    // Only the worker returned by this client's spawn factory is ever stopped.
    try { this.child?.stdin?.end(); } catch {}
    try {
      if (this.child && this.child.exitCode == null && this.child.signalCode == null) this.child.kill();
    } catch {}
  }

  close() { this._finish(new Error('Protocol client closed')); }
}

module.exports = { ProtocolClient };
