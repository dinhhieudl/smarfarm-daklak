"""
SmartFarm Edge Agent - Local Web Dashboard
Serves a simple dashboard on the local network (port 8080).
No internet needed - works entirely offline.
"""

import json
import asyncio
import threading
from datetime import datetime
from pathlib import Path

try:
    from flask import Flask, render_template, jsonify, request
    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False

import logging
logger = logging.getLogger('smartfarm-edge.web')

# Global references (set by start_web_server)
_db = None
_config = None

if HAS_FLASK:
    app = Flask(__name__,
                template_folder=str(Path(__file__).parent / 'templates'),
                static_folder=str(Path(__file__).parent / 'static'))

    @app.route('/')
    def index():
        """Main dashboard page."""
        return render_template('dashboard.html', farm_id=_config.farm_id if _config else 'unknown')

    @app.route('/api/stats')
    def api_stats():
        """Get local database statistics."""
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            stats = loop.run_until_complete(_db.get_stats())
            return jsonify(stats)
        finally:
            loop.close()

    @app.route('/api/readings')
    def api_readings():
        """Get recent readings."""
        sensor_type = request.args.get('sensor_type')
        limit = int(request.args.get('limit', 100))
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            readings = loop.run_until_complete(_db.get_recent_readings(sensor_type, limit))
            return jsonify({'data': readings, 'count': len(readings)})
        finally:
            loop.close()

    @app.route('/api/alerts')
    def api_alerts():
        """Get recent alerts."""
        limit = int(request.args.get('limit', 50))
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            alerts = loop.run_until_complete(_db.get_recent_alerts(limit))
            return jsonify({'data': alerts, 'count': len(alerts)})
        finally:
            loop.close()

    @app.route('/api/sync/trigger', methods=['POST'])
    def api_trigger_sync():
        """Trigger an immediate sync."""
        return jsonify({'status': 'queued', 'message': 'Sync triggered'})


async def start_web_server(config, db, port: int = 8080):
    """Start the local web dashboard in a background thread."""
    global _db, _config
    _db = db
    _config = config

    if not HAS_FLASK:
        logger.warning("Flask not installed. Web dashboard disabled.")
        return

    def run():
        app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    logger.info(f"Web dashboard started on http://0.0.0.0:{port}")
