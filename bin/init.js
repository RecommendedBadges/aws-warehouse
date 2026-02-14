#!/usr/bin/env node
// Bootstrap for environments where `ts-node` ESM integration fails.
// It registers ts-node for CommonJS require and then loads the TypeScript entry.
import * as tsNode from 'ts-node';
import './init.ts';

tsNode.register({ transpileOnly: true });