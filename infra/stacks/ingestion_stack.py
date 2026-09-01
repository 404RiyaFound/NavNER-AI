"""IngestionStack — Kinesis telemetry stream, Lambda processor, SNS critical alerts.

Provisions:
- Amazon Kinesis Data Stream for incoming vehicle GPS telemetry
- Lambda function that consumes the Kinesis stream and pushes data to Redshift
- SNS topic (CriticalAlertsTopic) for immediate SMS/Email dispatch
- REST API Gateway for receiving field reports and IoT pings
"""

from aws_cdk import (
    Duration,
    RemovalPolicy,
    Stack,
    aws_apigateway as apigw,
    aws_iam as iam,
    aws_kinesis as kinesis,
    aws_lambda as _lambda,
    aws_lambda_event_sources as event_sources,
    aws_logs as logs,
    aws_sns as sns,
    aws_sns_subscriptions as subs,
)
from constructs import Construct


class IngestionStack(Stack):
    """Real-time telemetry ingestion pipeline for NER fleet GPS data."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── 1. Kinesis Data Stream ─────────────────────────────────────────
        self.gps_stream = kinesis.Stream(
            self, "GpsTelemetryStream",
            stream_name="navner-gps-stream",
            shard_count=2,  # 2 MB/s write, 4 MB/s read — sufficient for NER fleet
            retention_period=Duration.hours(24),
        )

        # ── 2. SNS Topic — Critical Alerts ─────────────────────────────────
        self.critical_alerts_topic = sns.Topic(
            self, "CriticalAlertsTopic",
            topic_name="navner-critical-alerts",
            display_name="NavNER-AI Critical Alerts — NER Supply Chain",
        )

        # Add an email subscription (placeholder — configure during deployment)
        # self.critical_alerts_topic.add_subscription(
        #     subs.EmailSubscription("ops-team@navner.example.com")
        # )

        # ── 3. Lambda — Kinesis Stream Processor ──────────────────────────
        processor_role = iam.Role(
            self, "KinesisProcessorRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                ),
            ],
        )

        # Grant Redshift Data API access for the Lambda
        processor_role.add_to_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=[
                "redshift-data:ExecuteStatement",
                "redshift-data:GetStatementResult",
                "redshift-data:DescribeStatement",
                "redshift-serverless:GetCredentials",
            ],
            resources=["*"],
        ))

        # Grant SNS publish for critical alerts
        self.critical_alerts_topic.grant_publish(processor_role)

        self.stream_processor = _lambda.Function(
            self, "TelemetryProcessor",
            function_name="navner-telemetry-processor",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="handler.lambda_handler",
            code=_lambda.Code.from_asset("lambda/telemetry_processor"),
            timeout=Duration.seconds(60),
            memory_size=256,
            role=processor_role,
            environment={
                "REDSHIFT_WORKGROUP": "navner-analytics",
                "REDSHIFT_DATABASE": "navner_warehouse",
                "SNS_CRITICAL_TOPIC_ARN": self.critical_alerts_topic.topic_arn,
                "ALERT_THRESHOLD_SPEED_KMH": "5",       # Stuck vehicle threshold
                "ALERT_THRESHOLD_DEVIATION_KM": "2.0",   # Off-route threshold
            },
            log_retention=logs.RetentionDays.TWO_WEEKS,
        )

        # Connect Kinesis → Lambda
        self.stream_processor.add_event_source(
            event_sources.KinesisEventSource(
                self.gps_stream,
                starting_position=_lambda.StartingPosition.LATEST,
                batch_size=100,
                max_batching_window=Duration.seconds(10),
                retry_attempts=3,
            )
        )

        # ── 4. REST API Gateway — Field Report Ingestion ──────────────────
        self.api = apigw.RestApi(
            self, "FieldReportApi",
            rest_api_name="navner-field-api",
            description="NavNER-AI REST API for field report and IoT ping ingestion",
            deploy_options=apigw.StageOptions(
                stage_name="v1",
                throttling_rate_limit=100,
                throttling_burst_limit=200,
            ),
        )

        # Kinesis proxy integration for direct telemetry ingestion
        kinesis_integration_role = iam.Role(
            self, "ApiKinesisRole",
            assumed_by=iam.ServicePrincipal("apigateway.amazonaws.com"),
        )
        self.gps_stream.grant_write(kinesis_integration_role)

        telemetry_resource = self.api.root.add_resource("telemetry")
        telemetry_resource.add_method(
            "POST",
            apigw.AwsIntegration(
                service="kinesis",
                action="PutRecord",
                integration_http_method="POST",
                options=apigw.IntegrationOptions(
                    credentials_role=kinesis_integration_role,
                    request_templates={
                        "application/json": '{"StreamName": "'
                        + self.gps_stream.stream_name
                        + '", "Data": "$util.base64Encode($input.body)",'
                        + ' "PartitionKey": "$context.requestId"}',
                    },
                    integration_responses=[
                        apigw.IntegrationResponse(status_code="200"),
                    ],
                ),
            ),
            method_responses=[
                apigw.MethodResponse(status_code="200"),
            ],
        )

        # Field reports endpoint (Lambda-backed)
        field_reports = self.api.root.add_resource("field-reports")
        field_reports.add_method(
            "POST",
            apigw.LambdaIntegration(self.stream_processor),
        )
