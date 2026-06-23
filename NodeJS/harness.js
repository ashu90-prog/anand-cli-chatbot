#!/usr/bin/env node
import { fork, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mainPath = path.join(__dirname, 'main.js');

// Spawn main.js with an IPC channel and fully inherited standard streams
const child = fork(mainPath, [], {
  env: { ...process.env, ANAND_HARNESS: 'true' },
  stdio: ['inherit', 'inherit', 'inherit', 'ipc']
});

// Guard against zombie child processes when parent exits
process.on('exit', () => {
  if (child.connected) {
    child.kill();
  }
});

// Handle capability requests from main.js via Node.js IPC
child.on('message', async (req) => {
  if (req && req.action) {
    try {
      const res = await executeRequest(req);
      child.send(res);
    } catch (e) {
      child.send({
        id: req.id,
        status: 'error',
        error: e.message
      });
    }
  }
});

function executeRequest(req) {
  return new Promise((resolve) => {
    if (req.action === 'run_command') {
      exec(req.command, (error, stdout, stderr) => {
        if (error) {
          resolve({
            id: req.id,
            status: 'error',
            error: error.message
          });
        } else {
          resolve({
            id: req.id,
            status: 'success',
            output: stdout + stderr
          });
        }
      });
    } else if (req.action === 'read_file') {
      fs.readFile(req.path, 'utf8', (err, data) => {
        if (err) {
          resolve({
            id: req.id,
            status: 'error',
            error: err.message
          });
        } else {
          resolve({
            id: req.id,
            status: 'success',
            output: data
          });
        }
      });
    } else if (req.action === 'write_file') {
      const parentDir = path.dirname(req.path);
      fs.mkdir(parentDir, { recursive: true }, (err) => {
        if (err) {
          resolve({
            id: req.id,
            status: 'error',
            error: err.message
          });
        } else {
          fs.writeFile(req.path, req.content, 'utf8', (err) => {
            if (err) {
              resolve({
                id: req.id,
                status: 'error',
                error: err.message
              });
            } else {
              resolve({
                id: req.id,
                status: 'success',
                output: 'File written successfully'
              });
            }
          });
        }
      });
    }
  });
}

child.on('close', (code) => {
  process.exit(code || 0);
});
