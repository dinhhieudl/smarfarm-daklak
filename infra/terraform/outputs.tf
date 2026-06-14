# ============================================================
# Outputs
# ============================================================

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "app_instance_ips" {
  description = "Private IPs of application instances"
  value       = aws_instance.app[*].private_ip
}

output "alb_dns_name" {
  description = "ALB DNS name for API access"
  value       = aws_lb.main.dns_name
}

output "database_endpoint" {
  description = "RDS cluster endpoint"
  value       = aws_rds_cluster.main.endpoint
  sensitive   = true
}

output "database_reader_endpoint" {
  description = "RDS cluster reader endpoint"
  value       = aws_rds_cluster.main.reader_endpoint
  sensitive   = true
}

output "s3_bucket_name" {
  description = "S3 bucket for data archive"
  value       = aws_s3_bucket.data_archive.id
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.app.name
}

output "sns_alert_topic_arn" {
  description = "SNS topic ARN for alerts"
  value       = aws_sns_topic.alerts.arn
}
