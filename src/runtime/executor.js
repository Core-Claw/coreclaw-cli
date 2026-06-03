import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';

export function commandForProject(project, options = {}) {
  if (options.command) {
    return splitCommand(options.command);
  }

  if (project.language === 'python') {
    const [command, args] = splitCommandLine(options.python ?? 'python', '--python');
    return [command, [...args, 'main.py']];
  }

  if (project.language === 'node') {
    const [command, args] = splitCommandLine(options.node ?? 'node', '--node');
    return [command, [...args, 'main.js']];
  }

  if (project.language === 'go') {
    const rootExePath = platformExe(path.join(project.projectDir, 'main'));
    if (fs.existsSync(rootExePath)) {
      return [rootExePath, []];
    }
    const exePath = platformExe(path.join(project.projectDir, '.coreclaw', 'bin', 'worker'));
    if (fs.existsSync(exePath)) {
      return [exePath, []];
    }
    const [command, args] = splitCommandLine(options.go ?? 'go', '--go');
    return [command, [...args, 'run', '.']];
  }

  throw new CliError(`Unsupported language: ${project.language}`);
}

export function installCommandForProject(project, options = {}) {
  if (project.language === 'python') {
    const [command, args] = splitCommandLine(options.python ?? 'python', '--python');
    return [command, [...args, '-m', 'pip', 'install', '-r', 'requirements.txt']];
  }

  if (project.language === 'node') {
    if (fs.existsSync(path.join(project.projectDir, 'package-lock.json'))) {
      return platformShellCommand('npm', ['ci', '--omit=dev']);
    }
    return platformShellCommand('npm', ['install', '--omit=dev']);
  }

  if (project.language === 'go') {
    const [command, args] = splitCommandLine(options.go ?? 'go', '--go');
    return [command, [...args, 'mod', 'download']];
  }

  return null;
}

export async function runProcess({ command, args, cwd, env, store, label = command, timeoutMs = 0, idleTimeoutMs = 0 }) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let timeoutTimer = null;
    let idleTimer = null;
    let forceSettleTimer = null;
    let timedOut = false;
    let idleTimedOut = false;

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const clearTimers = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      if (forceSettleTimer) {
        clearTimeout(forceSettleTimer);
      }
    };

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      resolve(result);
    };

    const killForTimeout = (reason) => {
      if (settled || timedOut) {
        return;
      }
      timedOut = true;
      idleTimedOut = reason.startsWith('idle timeout');
      store?.recordLog('ERROR', `Worker killed after ${reason}.`, 'coreclaw-cli');
      try {
        child.kill('SIGKILL');
      } catch {
        // Fall through to process-tree kill below.
      }
      killProcessTree(child.pid);
      forceSettleTimer = setTimeout(() => {
        settle({ exitCode: null, signal: 'SIGKILL', timedOut, idleTimedOut });
      }, 5000);
      forceSettleTimer.unref?.();
    };

    const resetIdleTimer = () => {
      if (!idleTimeoutMs) {
        return;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => killForTimeout(`idle timeout ${idleTimeoutMs}ms`), idleTimeoutMs);
    };

    if (timeoutMs) {
      timeoutTimer = setTimeout(() => killForTimeout(`timeout ${timeoutMs}ms`), timeoutMs);
    }
    resetIdleTimer();

    child.stdout.on('data', (chunk) => {
      resetIdleTimer();
      const text = chunk.toString();
      process.stdout.write(text);
      for (const line of splitLines(text)) {
        store?.recordLog('STDOUT', line, label);
      }
    });

    child.stderr.on('data', (chunk) => {
      resetIdleTimer();
      const text = chunk.toString();
      process.stderr.write(text);
      for (const line of splitLines(text)) {
        store?.recordLog('STDERR', line, label);
      }
    });

    child.on('error', (error) => {
      clearTimers();
      reject(error);
    });
    child.on('close', (exitCode, signal) => {
      settle({ exitCode, signal, timedOut, idleTimedOut });
    });
  });
}

function splitCommand(command) {
  const parts = splitCommandParts(command);
  if (parts.length === 0) {
    throw new CliError('--command cannot be empty.');
  }
  return [parts[0], parts.slice(1)];
}

export function splitCommandLine(command, optionName) {
  const parts = splitCommandParts(command);
  if (parts.length === 0) {
    throw new CliError(`${optionName} cannot be empty.`);
  }
  return [parts[0], parts.slice(1)];
}

function splitCommandParts(command) {
  return String(command ?? '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}

function splitLines(text) {
  return text.split(/\r?\n/).filter(Boolean);
}

function platformExe(filePath) {
  return process.platform === 'win32' ? `${filePath}.exe` : filePath;
}

function killProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => {});
    killer.unref();
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }

  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }, 2000).unref();
}

function platformShellCommand(command, args) {
  if (process.platform !== 'win32') {
    return [command, args];
  }
  return [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command, ...args]];
}
