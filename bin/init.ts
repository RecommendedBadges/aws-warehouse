#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DurableFunctionStack } from '../lib/stack';

const app = new cdk.App();
new DurableFunctionStack(app, 'DurableFunctionStack', {
	env: { account: '671216071139', region: 'us-east-1' },
});
