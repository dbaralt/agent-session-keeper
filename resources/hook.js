#!/usr/bin/env node
'use strict';

// Agent Session Keeper hook bridge.
//
// Runs on behalf of a Claude Code hook (and, via the pi extension, for pi).
// Reads one hook JSON payload on stdin, appends a single line to the shared
// spool, prints nothing, and always exits 0 quickly so it can never block or
// alter the agent.
//
// Usage: node hook.js <agent>

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function spoolDir() {
  const base = process.env.AGENT_SESSIONS_STORAGE_DIR || path.join(os.homedir(), '.agent-sessions');
  return path.join(base, 'spool');
}

function todayFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(spoolDir(), `events-${date}.jsonl`);
}

function ancestorPids() {
  const pids = [];
  let pid = process.ppid;
  for (let depth = 0; depth < 8 && pid && pid > 1; depth += 1) {
    pids.push(pid);
    try {
      const output = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      pid = Number.parseInt(output.trim(), 10);
      if (!Number.isFinite(pid)) break;
    } catch {
      break;
    }
  }
  return pids;
}

function append(event) {
  fs.mkdirSync(spoolDir(), { recursive: true });
  fs.appendFileSync(todayFile(), `${JSON.stringify(event)}\n`);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const agent = process.argv[2] || 'unknown';
  const raw = readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const event = {
    agent,
    event: payload.hook_event_name || payload.event || 'unknown',
    source: payload.source,
    session_id: payload.session_id || payload.sessionId,
    transcript_path: payload.transcript_path,
    cwd: payload.cwd || process.cwd(),
    ts: new Date().toISOString(),
    terminalId: process.env.AGENT_SESSIONS_TERMINAL_ID || undefined,
    ancestorPids: ancestorPids(),
  };
  append(event);
}

try {
  main();
} catch {
  // Never fail, never print: a hook error must not affect the agent.
}
process.exit(0);
