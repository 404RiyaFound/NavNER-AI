"""RedshiftStack — Redshift Serverless with streaming ingestion from Kinesis.

Provisions:
- VPC with isolated subnets for Redshift
- Redshift Serverless namespace and workgroup
- IAM role for Kinesis streaming ingestion into Redshift
- Amazon Managed Grafana workspace for operational dashboards
"""

from aws_cdk import (
    CfnOutput,
    RemovalPolicy,
    Stack,
    aws_ec2 as ec2,
    aws_grafana as grafana,
    aws_iam as iam,
    aws_redshiftserverless as redshift,
)
from constructs import Construct


class RedshiftStack(Stack):
    """Analytics data warehouse for NER logistics intelligence."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── 1. VPC for Redshift ────────────────────────────────────────────
        self.vpc = ec2.Vpc(
            self, "AnalyticsVpc",
            vpc_name="navner-analytics-vpc",
            max_azs=2,
            nat_gateways=0,  # Cost optimization — Redshift uses VPC endpoints
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="Isolated",
                    subnet_type=ec2.SubnetType.PRIVATE_ISOLATED,
                    cidr_mask=24,
                ),
            ],
        )

        # Security group for Redshift
        self.redshift_sg = ec2.SecurityGroup(
            self, "RedshiftSg",
            vpc=self.vpc,
            security_group_name="navner-redshift-sg",
            description="Security group for NavNER Redshift Serverless",
            allow_all_outbound=True,
        )
        self.redshift_sg.add_ingress_rule(
            ec2.Peer.ipv4(self.vpc.vpc_cidr_block),
            ec2.Port.tcp(5439),
            "Redshift access from within VPC",
        )

        # ── 2. IAM Role — Kinesis Streaming Ingestion ─────────────────────
        self.redshift_role = iam.Role(
            self, "RedshiftStreamingRole",
            assumed_by=iam.CompositePrincipal(
                iam.ServicePrincipal("redshift.amazonaws.com"),
                iam.ServicePrincipal("redshift-serverless.amazonaws.com"),
            ),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "AmazonKinesisReadOnlyAccess"
                ),
            ],
        )

        # S3 access for COPY/UNLOAD operations
        self.redshift_role.add_to_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=["s3:GetObject", "s3:ListBucket", "s3:PutObject"],
            resources=["arn:aws:s3:::navner-analytics-*"],
        ))

        # Redshift ML access
        self.redshift_role.add_to_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=[
                "sagemaker:CreateTrainingJob",
                "sagemaker:DescribeTrainingJob",
                "sagemaker:CreateModel",
                "sagemaker:InvokeEndpoint",
            ],
            resources=["*"],
        ))

        # ── 3. Redshift Serverless Namespace ──────────────────────────────
        subnet_ids = [
            subnet.subnet_id
            for subnet in self.vpc.isolated_subnets
        ]

        self.namespace = redshift.CfnNamespace(
            self, "AnalyticsNamespace",
            namespace_name="navner-analytics",
            db_name="navner_warehouse",
            admin_username="admin",
            admin_user_password="NavNER_Secure_2026!",  # Use Secrets Manager in production
            default_iam_role_arn=self.redshift_role.role_arn,
            iam_roles=[self.redshift_role.role_arn],
            log_exports=["userlog", "connectionlog"],
        )

        # ── 4. Redshift Serverless Workgroup ──────────────────────────────
        self.workgroup = redshift.CfnWorkgroup(
            self, "AnalyticsWorkgroup",
            workgroup_name="navner-analytics",
            namespace_name=self.namespace.namespace_name,
            base_capacity=8,  # 8 RPUs — minimum for serverless (cost-efficient)
            publicly_accessible=False,
            subnet_ids=subnet_ids,
            security_group_ids=[self.redshift_sg.security_group_id],
            config_parameters=[
                redshift.CfnWorkgroup.ConfigParameterProperty(
                    parameter_key="enable_case_sensitive_identifier",
                    parameter_value="true",
                ),
            ],
        )
        self.workgroup.add_dependency(self.namespace)

        # ── 5. Amazon Managed Grafana Workspace ───────────────────────────
        grafana_role = iam.Role(
            self, "GrafanaRole",
            assumed_by=iam.ServicePrincipal("grafana.amazonaws.com"),
        )

        # Grafana needs Redshift Data API access for dashboard queries
        grafana_role.add_to_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=[
                "redshift-data:ExecuteStatement",
                "redshift-data:GetStatementResult",
                "redshift-data:DescribeStatement",
                "redshift-serverless:GetCredentials",
                "redshift-serverless:GetWorkgroup",
                "redshift-serverless:GetNamespace",
            ],
            resources=["*"],
        ))

        self.grafana_workspace = grafana.CfnWorkspace(
            self, "OpsGrafana",
            name="navner-ops-dashboard",
            description="NavNER-AI Operational Intelligence Dashboard — NER Supply Chain",
            account_access_type="CURRENT_ACCOUNT",
            authentication_providers=["AWS_SSO"],
            permission_type="SERVICE_MANAGED",
            role_arn=grafana_role.role_arn,
            data_sources=["REDSHIFT"],
            grafana_version="10.4",
        )

        # ── Outputs ───────────────────────────────────────────────────────
        CfnOutput(self, "RedshiftWorkgroup", value=self.workgroup.workgroup_name)
        CfnOutput(self, "RedshiftNamespace", value=self.namespace.namespace_name)
        CfnOutput(self, "GrafanaWorkspaceId", value=self.grafana_workspace.attr_id)
        CfnOutput(
            self, "GrafanaEndpoint",
            value=self.grafana_workspace.attr_endpoint,
        )
