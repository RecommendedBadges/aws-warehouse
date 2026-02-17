import * as path from 'path';
import * as cdk from "aws-cdk-lib"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from "aws-cdk-lib/aws-iam"
import { Construct } from "constructs"

export class DurableFunctionStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const durableFunction = new NodejsFunction(this, "PackagingLambda", {
			entry: path.join(__dirname, '..', 'lambda', 'index.ts'),
			runtime: lambda.Runtime.NODEJS_22_X,
			handler: 'handler',
			functionName: "PackagingLambda",
			bundling: {
				minify: false,
				sourceMap: true,
			},
			durableConfig: {
				executionTimeout: cdk.Duration.hours(1),
				retentionPeriod: cdk.Duration.days(30),
			},
			environment: {
				GITHUB_API_BASE: 'https://api.github.com/repos/RecommendedBadges/RecommendedBadges',
				REPOSITORY_NAME: 'RecommendedBadges',
				REPOSITORY_URL: 'github.com/RecommendedBadges/RecommendedBadges',
				HUB_ALIAS: 'HubOrg',
				PACKAGE_CREATE_REPORT_WAIT_TIME: '5',
				PACKAGE_INSTALL_WAIT_TIME: '30',
				PACKAGE_LIMIT_WAIT_TIME: '6'
			}
		});

		const version = durableFunction.currentVersion;
		const alias = new lambda.Alias(this, "ProdAlias", {
			aliasName: "prod",
			version: version,
		});

		new lambda.FunctionUrl(this, 'FunctionUrl', {
			function: alias
		});

		new cdk.CfnOutput(this, "FunctionAliasArn", {
			value: alias.functionArn,
		});
	}
}
