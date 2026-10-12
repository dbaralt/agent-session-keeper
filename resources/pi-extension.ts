/**
 * Agent Session Keeper pi extension.
 *
 * Installed by the extension into `~/.pi/agent/extensions/`. It reports session
 * start and activity to the shared spool so capture is exact even without shell
 * integration (tmux, ssh). It never prints to the terminal.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function spoolFile(): string {
  const base = process.env.AGENT_SESSIONS_STORAGE_DIR || join(homedir(), ".agent-sessions");
  const date = new Date().toISOString().slice(0, 10);
  return join(base, "spool", `events-${date}.jsonl`);
}

function ancestorPids(): number[] {
  const pids: number[] = [];
  let pid = process.ppid;
  for (let depth = 0; depth < 8 && pid && pid > 1; depth += 1) {
    pids.push(pid);
    try {
      const output = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      pid = Number.parseInt(output.trim(), 10);
      if (!Number.isFinite(pid)) break;
    } catch {
      break;
    }
  }
  return pids;
}

function report(
  event: string,
  ctx: { cwd: string; sessionManager: { getSessionId(): string; getSessionFile(): string | undefined } },
): void {
  try {
    const line = JSON.stringify({
      agent: "pi",
      event,
      session_id: ctx.sessionManager.getSessionId(),
      transcript_path: ctx.sessionManager.getSessionFile(),
      cwd: ctx.cwd,
      ts: new Date().toISOString(),
      terminalId: process.env.AGENT_SESSIONS_TERMINAL_ID || undefined,
      ancestorPids: ancestorPids(),
    });
    mkdirSync(join(spoolFile(), ".."), { recursive: true });
    appendFileSync(spoolFile(), `${line}\n`);
  } catch {
    // Never disturb the session.
  }
}

export default function agentSessionKeeper(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    report("SessionStart", ctx);
  });
  pi.on("agent_start", async (_event, ctx) => {
    report("UserPromptSubmit", ctx);
  });
  pi.on("agent_end", async (_event, ctx) => {
    report("Stop", ctx);
  });
}
