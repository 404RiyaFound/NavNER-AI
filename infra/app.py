#!/usr/bin/env python3
"""NavNER-AI — AWS CDK Application Entry Point.

Deploys a near real-time logistics analytics pipeline for the NER region.

CLI Commands
------------
    cdk synth                          # Synthesize all stacks
    cdk deploy IngestionStack          # Deploy the telemetry ingestion pipeline
    cdk deploy RedshiftStack           # Deploy the analytics data warehouse
    cdk deploy StepFunctionStack       # Deploy the offline-sync orchestrator
    cdk deploy --all                   # Deploy everything
    cdk destroy --all                  # Tear down all resources
"""

import aws_cdk as cdk

from stacks.ingestion_stack import IngestionStack
from stacks.redshift_stack import RedshiftStack
from stacks.stepfunction_stack import StepFunctionStack

app = cdk.App()

env = cdk.Environment(
    account=app.node.try_get_context("account") or None,
    region=app.node.try_get_context("region") or "ap-south-1",
)

# ── Stack 1: Streaming Ingestion Pipeline ──────────────────────────────────
ingestion = IngestionStack(
    app, "IngestionStack",
    env=env,
    description="NavNER-AI — Kinesis telemetry stream, Lambda processor, SNS critical alerts",
)

# ── Stack 2: Redshift Analytics Warehouse ──────────────────────────────────
redshift = RedshiftStack(
    app, "RedshiftStack",
    env=env,
    description="NavNER-AI — Redshift Serverless with streaming ingestion from Kinesis",
)

# ── Stack 3: Step Functions Offline Sync ───────────────────────────────────
stepfn = StepFunctionStack(
    app, "StepFunctionStack",
    env=env,
    description="NavNER-AI — Step Functions orchestrator for offline mobile sync",
)

app.synth()
