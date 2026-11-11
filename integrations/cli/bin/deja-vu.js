#!/usr/bin/env node
// Déjà-vu CI universal entry CLI — single binary, zero dependencies.
import { run } from '../lib/cli.js';

process.exitCode = await run(process.argv.slice(2));