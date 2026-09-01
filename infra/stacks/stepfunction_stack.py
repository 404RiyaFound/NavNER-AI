"""StepFunctionStack — Serverless workflow orchestration for offline mobile sync.

Provisions:
- SQS queue for buffering offline field reports
- SQS dead-letter queue for failed processing
- Lambda function for processing queued field reports
- Step Functions state machine that orchestrates the sync workflow
"""

from aws_cdk import (
    Duration,
    RemovalPolicy,
    Stack,
    aws_iam as iam,
    aws_lambda as _lambda,
    aws_logs as logs,
    aws_sqs as sqs,
    aws_stepfunctions as sfn,
    aws_stepfunctions_tasks as tasks,
)
from constructs import Construct


class StepFunctionStack(Stack):
    """Offline-sync orchestrator for mobile field apps reconnecting to network."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── 1. SQS Dead-Letter Queue ──────────────────────────────────────
        self.dlq = sqs.Queue(
            self, "OfflineSyncDLQ",
            queue_name="navner-offline-sync-dlq",
            retention_period=Duration.days(14),
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ── 2. SQS Queue — Offline Field Reports ─────────────────────────
        self.sync_queue = sqs.Queue(
            self, "OfflineSyncQueue",
            queue_name="navner-offline-sync",
            visibility_timeout=Duration.seconds(120),
            retention_period=Duration.days(7),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=3,
                queue=self.dlq,
            ),
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ── 3. Lambda — Process Queued Field Reports ──────────────────────
        processor_role = iam.Role(
            self, "SyncProcessorRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                ),
            ],
        )

        # Allow writing to the main database (RDS/PostGIS access)
        processor_role.add_to_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement"],
            resources=["*"],
        ))

        self.report_processor = _lambda.Function(
            self, "FieldReportProcessor",
            function_name="navner-field-report-processor",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="handler.lambda_handler",
            code=_lambda.Code.from_asset("lambda/field_report_processor"),
            timeout=Duration.seconds(30),
            memory_size=256,
            role=processor_role,
            environment={
                "DATABASE_URL": "postgresql://navner:navner_secret@navner-db.cluster.ap-south-1.rds.amazonaws.com:5432/navner_ai",
                "SYNC_QUEUE_URL": self.sync_queue.queue_url,
            },
            log_retention=logs.RetentionDays.TWO_WEEKS,
        )

        self.sync_queue.grant_consume_messages(self.report_processor)

        # ── 4. Step Functions State Machine — Offline Sync Workflow ───────

        # Step 1: Validate batch payload
        validate_step = sfn.Pass(
            self, "ValidateBatch",
            comment="Validate incoming batch of offline field reports",
            result=sfn.Result.from_object({
                "status": "VALIDATED",
                "message": "Batch payload structure verified",
            }),
            result_path="$.validation",
        )

        # Step 2: Process each report via Lambda
        process_step = tasks.LambdaInvoke(
            self, "ProcessReports",
            lambda_function=self.report_processor,
            payload=sfn.TaskInput.from_json_path_at("$"),
            result_path="$.processing_result",
            retry_on_service_exceptions=True,
        )
        process_step.add_retry(
            max_attempts=2,
            interval=Duration.seconds(5),
            backoff_rate=2.0,
        )

        # Step 3: Check result and route
        success_state = sfn.Succeed(
            self, "SyncComplete",
            comment="All offline reports successfully synchronized",
        )

        failure_state = sfn.Fail(
            self, "SyncFailed",
            cause="Report processing failed after retries",
            error="PROCESSING_ERROR",
        )

        # Step 4: Send to DLQ on persistent failure
        send_to_dlq = tasks.SqsSendMessage(
            self, "SendToDLQ",
            queue=self.dlq,
            message_body=sfn.TaskInput.from_json_path_at("$"),
            comment="Move failed batch to dead-letter queue for manual review",
        )
        send_to_dlq.next(failure_state)

        # Choice: branch based on processing result
        check_result = sfn.Choice(self, "CheckResult")
        check_result.when(
            sfn.Condition.string_equals(
                "$.processing_result.Payload.status", "SUCCESS"
            ),
            success_state,
        )
        check_result.otherwise(send_to_dlq)

        # Chain the workflow
        definition = validate_step.next(process_step).next(check_result)

        self.state_machine = sfn.StateMachine(
            self, "OfflineSyncStateMachine",
            state_machine_name="navner-offline-sync",
            definition_body=sfn.DefinitionBody.from_chainable(definition),
            timeout=Duration.minutes(5),
            tracing_enabled=True,
            logs=sfn.LogOptions(
                destination=logs.LogGroup(
                    self, "SyncStateMachineLogs",
                    log_group_name="/aws/stepfunctions/navner-offline-sync",
                    retention=logs.RetentionDays.TWO_WEEKS,
                    removal_policy=RemovalPolicy.DESTROY,
                ),
                level=sfn.LogLevel.ALL,
            ),
        )
