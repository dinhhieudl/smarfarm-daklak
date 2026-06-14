"""
Notification Dispatchers
Sends alerts via Webhook, SMS, Email, and Push notifications.
"""

import json
import logging
import os
import smtplib
from abc import ABC, abstractmethod
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import httpx

logger = logging.getLogger("notifications")


class Notifier(ABC):
    """Base class for notification dispatchers."""

    @abstractmethod
    def send(self, alert: dict) -> bool:
        """Send a notification. Returns True if successful."""
        ...

    def _format_alert(self, alert: dict) -> str:
        """Format alert for display."""
        severity_emoji = {
            "info": "ℹ️",
            "warning": "⚠️",
            "critical": "🚨",
        }
        emoji = severity_emoji.get(alert["severity"], "📢")
        return f"{emoji} [{alert['severity'].upper()}] {alert['message']}"


# ============================================================
# Webhook Notifier (generic HTTP POST)
# ============================================================

class WebhookNotifier(Notifier):
    """Sends alerts to a configurable webhook URL (Slack, Discord, Teams, custom)."""

    def __init__(
        self,
        webhook_url: Optional[str] = None,
        timeout: float = 10.0,
        retry_count: int = 3,
    ):
        self.webhook_url = webhook_url or os.getenv("ALERT_WEBHOOK_URL")
        self.timeout = timeout
        self.retry_count = retry_count

        if not self.webhook_url:
            logger.warning("No webhook URL configured. Webhook notifications disabled.")

    def send(self, alert: dict) -> bool:
        if not self.webhook_url:
            return False

        # Format for Slack-compatible webhooks
        payload = {
            "text": self._format_alert(alert),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": self._format_alert(alert),
                    },
                },
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*Farm:*\n{alert.get('farm_id', 'N/A')}"},
                        {"type": "mrkdwn", "text": f"*Zone:*\n{alert.get('zone_id', 'N/A')}"},
                        {"type": "mrkdwn", "text": f"*Metric:*\n{alert.get('metric', 'N/A')}"},
                        {"type": "mrkdwn", "text": f"*Value:*\n{alert.get('current_value', 'N/A')}"},
                    ],
                },
            ],
            # For Discord/Teams compatibility
            "content": self._format_alert(alert),
            "embeds": [{
                "title": f"AgriTech Alert — {alert['severity'].upper()}",
                "description": alert["message"],
                "color": {"critical": 0xFF0000, "warning": 0xFFA500, "info": 0x0000FF}.get(
                    alert["severity"], 0x808080
                ),
                "fields": [
                    {"name": "Metric", "value": str(alert.get("metric", "")), "inline": True},
                    {"name": "Value", "value": str(alert.get("current_value", "")), "inline": True},
                    {"name": "Threshold", "value": str(alert.get("threshold", "")), "inline": True},
                ],
            }],
        }

        for attempt in range(self.retry_count):
            try:
                response = httpx.post(
                    self.webhook_url,
                    json=payload,
                    timeout=self.timeout,
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code < 300:
                    logger.info("Webhook alert sent: %s", alert["rule_name"])
                    return True
                else:
                    logger.warning(
                        "Webhook returned %d (attempt %d/%d): %s",
                        response.status_code, attempt + 1, self.retry_count, response.text[:200],
                    )
            except Exception as e:
                logger.error("Webhook failed (attempt %d/%d): %s", attempt + 1, self.retry_count, e)

        return False


# ============================================================
# SMS Notifier (via Twilio or local SMS gateway)
# ============================================================

class SMSNotifier(Notifier):
    """Sends critical alerts via SMS."""

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        from_number: Optional[str] = None,
        recipients: Optional[list[str]] = None,
    ):
        self.api_url = api_url or os.getenv("SMS_API_URL")
        self.api_key = api_key or os.getenv("SMS_API_KEY")
        self.from_number = from_number or os.getenv("SMS_FROM_NUMBER")
        self.recipients = recipients or (os.getenv("SMS_RECIPIENTS", "").split(","))

    def send(self, alert: dict) -> bool:
        # Only send SMS for critical alerts
        if alert["severity"] != "critical":
            return False

        if not self.api_url or not self.recipients:
            logger.warning("SMS not configured. Skipping.")
            return False

        # Truncate message for SMS (160 chars)
        message = f"[AgriTech] {alert['message']}"[:160]

        success = True
        for recipient in self.recipients:
            recipient = recipient.strip()
            if not recipient:
                continue

            try:
                # Generic SMS API (adapt for Twilio, Vonage, etc.)
                response = httpx.post(
                    self.api_url,
                    json={
                        "to": recipient,
                        "from": self.from_number,
                        "message": message,
                    },
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    timeout=10,
                )
                if response.status_code >= 300:
                    logger.error("SMS send failed to %s: %d", recipient, response.status_code)
                    success = False
                else:
                    logger.info("SMS sent to %s: %s", recipient, alert["rule_name"])
            except Exception as e:
                logger.error("SMS error for %s: %s", recipient, e)
                success = False

        return success


# ============================================================
# Email Notifier
# ============================================================

class EmailNotifier(Notifier):
    """Sends alert summaries via email."""

    def __init__(
        self,
        smtp_host: Optional[str] = None,
        smtp_port: int = 587,
        smtp_user: Optional[str] = None,
        smtp_password: Optional[str] = None,
        from_addr: Optional[str] = None,
        recipients: Optional[list[str]] = None,
    ):
        self.smtp_host = smtp_host or os.getenv("SMTP_HOST")
        self.smtp_port = int(os.getenv("SMTP_PORT", str(smtp_port)))
        self.smtp_user = smtp_user or os.getenv("SMTP_USER")
        self.smtp_password = smtp_password or os.getenv("SMTP_PASSWORD")
        self.from_addr = from_addr or os.getenv("EMAIL_FROM")
        self.recipients = recipients or (os.getenv("EMAIL_RECIPIENTS", "").split(","))

    def send(self, alert: dict) -> bool:
        if not self.smtp_host or not self.recipients:
            return False

        # Only email for warning and critical
        if alert["severity"] == "info":
            return False

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[AgriTech {alert['severity'].upper()}] {alert['rule_name']}"
        msg["From"] = self.from_addr
        msg["To"] = ", ".join(self.recipients)

        # Plain text
        text_body = self._format_alert(alert)
        msg.attach(MIMEText(text_body, "plain"))

        # HTML
        color = {"critical": "#FF0000", "warning": "#FFA500", "info": "#0000FF"}.get(
            alert["severity"], "#808080"
        )
        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif;">
            <div style="border-left: 4px solid {color}; padding: 10px; margin: 10px 0;">
                <h2 style="color: {color};">AgriTech Alert — {alert['severity'].upper()}</h2>
                <p>{alert['message']}</p>
                <table style="border-collapse: collapse;">
                    <tr><td><strong>Farm:</strong></td><td>{alert.get('farm_id', 'N/A')}</td></tr>
                    <tr><td><strong>Zone:</strong></td><td>{alert.get('zone_id', 'N/A')}</td></tr>
                    <tr><td><strong>Metric:</strong></td><td>{alert.get('metric', 'N/A')}</td></tr>
                    <tr><td><strong>Current Value:</strong></td><td>{alert.get('current_value', 'N/A')}</td></tr>
                    <tr><td><strong>Threshold:</strong></td><td>{alert.get('threshold', 'N/A')}</td></tr>
                </table>
            </div>
            <p style="color: #666; font-size: 12px;">
                Timestamp: {alert.get('timestamp', 'N/A')}<br>
                Alert Rule: {alert.get('rule_name', 'N/A')}
            </p>
        </body>
        </html>
        """
        msg.attach(MIMEText(html_body, "html"))

        try:
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                if self.smtp_user:
                    server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)
            logger.info("Email alert sent: %s", alert["rule_name"])
            return True
        except Exception as e:
            logger.error("Email send failed: %s", e)
            return False


# ============================================================
# Batch Notifier (for digest mode)
# ============================================================

class DigestNotifier(Notifier):
    """
    Collects alerts and sends a periodic digest (e.g., every hour).
    Useful for non-critical alerts to avoid notification fatigue.
    """

    def __init__(self, inner_notifier: Notifier, severity_filter: set = None):
        self.inner = inner_notifier
        self.severity_filter = severity_filter or {"info", "warning"}
        self.buffer: list[dict] = []

    def send(self, alert: dict) -> bool:
        if alert["severity"] in self.severity_filter:
            self.buffer.append(alert)
            return True

        # Critical alerts pass through immediately
        return self.inner.send(alert)

    def flush(self) -> bool:
        """Send accumulated digest."""
        if not self.buffer:
            return True

        # Group by farm
        by_farm = {}
        for alert in self.buffer:
            farm = alert.get("farm_id", "unknown")
            by_farm.setdefault(farm, []).append(alert)

        digest_message = "📊 AgriTech Alert Digest\n\n"
        for farm, alerts in by_farm.items():
            digest_message += f"Farm {farm}:\n"
            for a in alerts:
                digest_message += f"  • {a['message']}\n"
            digest_message += "\n"

        digest_alert = {
            "rule_name": "digest",
            "severity": "info",
            "message": digest_message,
            "farm_id": "",
            "zone_id": "",
            "metric": "",
            "current_value": 0,
            "threshold": 0,
        }

        result = self.inner.send(digest_alert)
        self.buffer.clear()
        return result
