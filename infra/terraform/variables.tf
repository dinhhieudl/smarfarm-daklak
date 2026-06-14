# ============================================================
# Variables
# ============================================================

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "agritech"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be development, staging, or production."
  }
}

variable "aws_region" {
  description = "AWS region (Singapore — closest to Vietnam)"
  type        = string
  default     = "ap-southeast-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "app_instance_type" {
  description = "EC2 instance type for application servers"
  type        = string
  default     = "t3.medium"  # 2 vCPU, 4GB RAM — good for Docker workloads
}

variable "app_instance_count" {
  description = "Number of application instances"
  type        = number
  default     = 1
}

variable "ssh_key_name" {
  description = "Name of the SSH key pair for EC2"
  type        = string
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "agritech"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "agritech_admin"
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}

variable "alert_email" {
  description = "Email for CloudWatch alerts"
  type        = string
}
