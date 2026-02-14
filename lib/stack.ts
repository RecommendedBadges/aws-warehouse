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
      timeout: cdk.Duration.minutes(15),
      functionName: "PackagingLambda",
      bundling: {
        minify: false,
        sourceMap: true,
      },
      durableConfig: {
        executionTimeout: cdk.Duration.hours(1),
        retentionPeriod: cdk.Duration.days(30),
      },
    });

    const version = durableFunction.currentVersion
    const alias = new lambda.Alias(this, "ProdAlias", {
      aliasName: "prod",
      version: version,
    });

    new cdk.CfnOutput(this, "FunctionAliasArn", {
      value: alias.functionArn,
    });
  }
}
