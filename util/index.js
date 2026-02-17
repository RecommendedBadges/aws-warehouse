export * from './callout.js';
export * from './error.js';
export * from './github.js';
export * from './sfdx.js';

// also provide namespace-style exports so callers can import { error, github, sfdx }
import * as error from './error.js';
import * as github from './github.js';
import * as secretsManager from './secretsManager.js';
import * as sfdx from './sfdx.js';
export { error, github, secretsManager, sfdx };