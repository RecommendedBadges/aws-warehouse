import * as cdk from "aws-cdk-lib"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from "constructs"

export class DurableFunctionStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const durableFunction = new DockerImageFunction(this, "DurableContainerPackagingLambda", {
			code: lambda.DockerImageCode.fromEcr(cdk.aws_ecr.Repository.fromRepositoryName(this, 'PackagingLambdaRepo', 'packaging-lambda-repo')),
			functionName: "DurableContainerPackagingLambda",
			durableConfig: {
				executionTimeout: cdk.Duration.minutes(15),
				retentionPeriod: cdk.Duration.days(30),
			},
			environment: {
				GITHUB_API_BASE: 'https://api.github.com/repos/RecommendedBadges/RecommendedBadges',
				REPOSITORY_NAME: 'RecommendedBadges',
				REPOSITORY_URL: 'github.com/RecommendedBadges/RecommendedBadges',
				HUB_ALIAS: 'HubOrg',
				HOME: '/tmp/',
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

		new cdk.CfnOutput(this, "FunctionAliasArn", {
			value: alias.functionArn,
		});
	}
}
