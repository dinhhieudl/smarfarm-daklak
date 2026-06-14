# ============================================================
# IoT AgriTech Platform — Main Terraform Configuration
# Provider: AWS ap-southeast-1 (Singapore)
# ============================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "agritech-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "agritech-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "agritech-iot"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ============================================================
# Data Sources
# ============================================================
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# ============================================================
# VPC & Networking
# ============================================================
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${var.project_name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-igw" }
}

# Public subnet (ALB, NAT Gateway)
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 1)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${var.project_name}-public-${count.index + 1}" }
}

# Private subnets (Application, Database)
resource "aws_subnet" "private_app" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "${var.project_name}-private-app-${count.index + 1}" }
}

resource "aws_subnet" "private_db" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 20)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "${var.project_name}-private-db-${count.index + 1}" }
}

# NAT Gateway for private subnet internet access
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-nat-eip" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.project_name}-nat" }

  depends_on = [aws_internet_gateway.main]
}

# Route tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project_name}-public-rt" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = { Name = "${var.project_name}-private-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private_app" {
  count          = 2
  subnet_id      = aws_subnet.private_app[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_db" {
  count          = 2
  subnet_id      = aws_subnet.private_db[count.index].id
  route_table_id = aws_route_table.private.id
}

# ============================================================
# Security Groups
# ============================================================
resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-alb-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  ingress {
    from_port   = 8883
    to_port     = 8883
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "MQTT over TLS"
  }

  ingress {
    from_port   = 1883
    to_port     = 1883
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "MQTT (will migrate to TLS only)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle { create_before_destroy = true }
  tags = { Name = "${var.project_name}-alb-sg" }
}

resource "aws_security_group" "app" {
  name_prefix = "${var.project_name}-app-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 0
    to_port         = 0
    protocol        = "-1"
    security_groups = [aws_security_group.alb.id]
    description     = "From ALB"
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "SSH from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle { create_before_destroy = true }
  tags = { Name = "${var.project_name}-app-sg" }
}

resource "aws_security_group" "database" {
  name_prefix = "${var.project_name}-db-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
    description     = "PostgreSQL from app"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle { create_before_destroy = true }
  tags = { Name = "${var.project_name}-db-sg" }
}

# ============================================================
# EC2 — Application Server (Docker Host)
# ============================================================
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "app" {
  count                  = var.app_instance_count
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.app_instance_type
  subnet_id              = aws_subnet.private_app[count.index % 2].id
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = var.ssh_key_name

  root_block_device {
    volume_type = "gp3"
    volume_size = 50
    encrypted   = true
  }

  user_data = base64encode(templatefile("${path.module}/templates/user_data.sh", {
    project_name = var.project_name
    environment  = var.environment
  }))

  tags = { Name = "${var.project_name}-app-${count.index + 1}" }
}

# ============================================================
# RDS — PostgreSQL + TimescaleDB
# ============================================================
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet"
  subnet_ids = aws_subnet.private_db[*].id
  tags       = { Name = "${var.project_name}-db-subnet" }
}

resource "aws_rds_cluster_parameter_group" "timescaledb" {
  family = "postgres15"
  name   = "${var.project_name}-timescaledb"

  parameter {
    name  = "shared_preload_libraries"
    value = "timescaledb,pg_stat_statements"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

resource "aws_rds_cluster" "main" {
  cluster_identifier      = "${var.project_name}-db"
  engine                  = "aurora-postgresql"
  engine_version          = "15.4"
  database_name           = var.db_name
  master_username         = var.db_username
  master_password         = var.db_password
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.database.id]
  backup_retention_period = 14
  preferred_backup_window = "03:00-04:00"
  storage_encrypted       = true
  deletion_protection     = var.environment == "production"

  serverlessv2_scaling_configuration {
    min_capacity = var.environment == "production" ? 2.0 : 0.5
    max_capacity = var.environment == "production" ? 16.0 : 4.0
  }

  tags = { Name = "${var.project_name}-db-cluster" }
}

resource "aws_rds_cluster_instance" "main" {
  count              = var.environment == "production" ? 2 : 1
  identifier         = "${var.project_name}-db-${count.index}"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  performance_insights_enabled = true

  tags = { Name = "${var.project_name}-db-instance-${count.index}" }
}

# ============================================================
# S3 — Raw Data Archive
# ============================================================
resource "aws_s3_bucket" "data_archive" {
  bucket = "${var.project_name}-data-archive-${var.environment}"
  tags   = { Name = "${var.project_name}-data-archive" }
}

resource "aws_s3_bucket_versioning" "data_archive" {
  bucket = aws_s3_bucket.data_archive.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data_archive" {
  bucket = aws_s3_bucket.data_archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data_archive" {
  bucket = aws_s3_bucket.data_archive.id

  rule {
    id     = "archive-old-data"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 730  # 2 years retention
    }
  }
}

resource "aws_s3_bucket_public_access_block" "data_archive" {
  bucket                  = aws_s3_bucket.data_archive.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ============================================================
# ALB — Application Load Balancer
# ============================================================
resource "aws_lb" "main" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = { Name = "${var.project_name}-alb" }
}

resource "aws_lb_target_group" "api" {
  name     = "${var.project_name}-api-tg"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 10
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ============================================================
# CloudWatch — Logs & Alerts
# ============================================================
resource "aws_cloudwatch_log_group" "app" {
  name              = "/agritech/${var.environment}/app"
  retention_in_days = 30
  tags              = { Name = "${var.project_name}-app-logs" }
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${var.project_name}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "EC2 CPU > 80% for 15 minutes"

  dimensions = {
    InstanceId = aws_instance.app[0].id
  }
}

resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"
}

# ============================================================
# Secrets Manager
# ============================================================
resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${var.project_name}/${var.environment}/db-password"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = var.db_password
}
