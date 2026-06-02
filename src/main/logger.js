/**
 * Aadhaar Photo Printer - Structured Logger
 *
 * Writes timestamped log entries to userData/logs/app.log
 * without adding external dependencies. Mirrors to console.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Logger {
  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.logFile = path.join(this.logDir, 'app.log');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  _write(level, message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    try {
      fs.appendFileSync(this.logFile, line);
    } catch (e) {
      console.error('Logger failed:', e.message);
    }
    // Also mirror to console
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`[${level.toUpperCase()}] ${message}`);
  }

  info(msg) { this._write('info', msg); }
  warn(msg) { this._write('warn', msg); }
  error(msg) { this._write('error', msg); }
}

module.exports = { Logger };
