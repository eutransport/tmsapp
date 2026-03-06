"""
Server monitoring module.
Collects system metrics (CPU, RAM, disk, I/O) and Docker container info.
Stores historical data in Redis for time-series graphs.
"""
import json
import time
import os
import socket
import struct
import threading
import logging
from datetime import datetime, timedelta

import psutil
from django.core.cache import cache
from django.conf import settings

logger = logging.getLogger(__name__)

# Check if running inside Docker with host /proc mounted
HOST_PROC = '/host/proc' if os.path.exists('/host/proc/stat') else '/proc'
HOST_SYS = '/host/sys' if os.path.exists('/host/sys') else '/sys'

# Redis key for metrics time-series
METRICS_KEY = 'monitoring:metrics'
COLLECT_INTERVAL = 60  # seconds


def get_cpu_percent():
    """Get host CPU usage percentage."""
    try:
        # Read from host /proc/stat
        with open(f'{HOST_PROC}/stat', 'r') as f:
            line = f.readline()
        
        parts = line.split()
        # cpu user nice system idle iowait irq softirq steal
        idle = int(parts[4]) + int(parts[5])  # idle + iowait
        total = sum(int(p) for p in parts[1:])
        
        # Get previous values from cache
        prev = cache.get('monitoring:prev_cpu')
        cache.set('monitoring:prev_cpu', {'idle': idle, 'total': total}, timeout=300)
        
        if prev:
            idle_diff = idle - prev['idle']
            total_diff = total - prev['total']
            if total_diff > 0:
                return round((1.0 - idle_diff / total_diff) * 100, 1)
        
        # Fallback: use psutil (may show container CPU in Docker)
        return psutil.cpu_percent(interval=0.5)
    except Exception as e:
        logger.warning(f"Failed to read host CPU: {e}")
        return psutil.cpu_percent(interval=0.5)


def get_memory_info():
    """Get host memory information."""
    try:
        with open(f'{HOST_PROC}/meminfo', 'r') as f:
            lines = f.readlines()
        
        mem = {}
        for line in lines:
            parts = line.split()
            key = parts[0].rstrip(':')
            value = int(parts[1]) * 1024  # Convert KB to bytes
            mem[key] = value
        
        total = mem.get('MemTotal', 0)
        available = mem.get('MemAvailable', 0)
        used = total - available
        
        return {
            'total': total,
            'available': available,
            'used': used,
            'percent': round((used / total) * 100, 1) if total > 0 else 0,
        }
    except Exception as e:
        logger.warning(f"Failed to read host memory: {e}")
        vm = psutil.virtual_memory()
        return {
            'total': vm.total,
            'available': vm.available,
            'used': vm.used,
            'percent': vm.percent,
        }


def get_disk_info():
    """Get disk usage information."""
    try:
        # Try host root filesystem
        if os.path.exists('/host/proc/mounts'):
            # Find root mount from host
            disk = psutil.disk_usage('/')
        else:
            disk = psutil.disk_usage('/')
        
        return {
            'total': disk.total,
            'used': disk.used,
            'free': disk.free,
            'percent': disk.percent,
        }
    except Exception as e:
        logger.warning(f"Failed to read disk info: {e}")
        return {'total': 0, 'used': 0, 'free': 0, 'percent': 0}


def get_disk_io():
    """Get disk I/O counters."""
    try:
        io = psutil.disk_io_counters()
        if io:
            return {
                'read_bytes': io.read_bytes,
                'write_bytes': io.write_bytes,
                'read_count': io.read_count,
                'write_count': io.write_count,
            }
    except Exception as e:
        logger.warning(f"Failed to read disk I/O: {e}")
    return {'read_bytes': 0, 'write_bytes': 0, 'read_count': 0, 'write_count': 0}


def get_network_io():
    """Get network I/O counters."""
    try:
        net = psutil.net_io_counters()
        if net:
            return {
                'bytes_sent': net.bytes_sent,
                'bytes_recv': net.bytes_recv,
            }
    except Exception as e:
        logger.warning(f"Failed to read network I/O: {e}")
    return {'bytes_sent': 0, 'bytes_recv': 0}


def get_system_uptime():
    """Get system uptime in seconds."""
    try:
        with open(f'{HOST_PROC}/uptime', 'r') as f:
            uptime = float(f.readline().split()[0])
        return uptime
    except Exception:
        return time.time() - psutil.boot_time()


def get_load_average():
    """Get system load average."""
    try:
        with open(f'{HOST_PROC}/loadavg', 'r') as f:
            parts = f.readline().split()
        return {
            'load_1': float(parts[0]),
            'load_5': float(parts[1]),
            'load_15': float(parts[2]),
        }
    except Exception:
        try:
            load = os.getloadavg()
            return {'load_1': load[0], 'load_5': load[1], 'load_15': load[2]}
        except (OSError, AttributeError):
            return {'load_1': 0, 'load_5': 0, 'load_15': 0}


def get_cpu_count():
    """Get CPU core count."""
    try:
        with open(f'{HOST_PROC}/cpuinfo', 'r') as f:
            content = f.read()
        return content.count('processor\t:')
    except Exception:
        return psutil.cpu_count() or 1


def get_current_stats():
    """Get all current system stats."""
    mem = get_memory_info()
    disk = get_disk_info()
    disk_io = get_disk_io()
    net_io = get_network_io()
    load = get_load_average()
    
    return {
        'timestamp': datetime.now().isoformat(),
        'cpu': {
            'percent': get_cpu_percent(),
            'cores': get_cpu_count(),
            'load': load,
        },
        'memory': mem,
        'disk': disk,
        'disk_io': disk_io,
        'network': net_io,
        'uptime': get_system_uptime(),
    }


def collect_metrics_snapshot():
    """
    Collect a metrics snapshot and store in Redis.
    Called periodically by the background collector.
    """
    try:
        from django_redis import get_redis_connection
        redis_conn = get_redis_connection("default")
    except Exception:
        logger.warning("Redis not available for metrics collection")
        return
    
    try:
        mem = get_memory_info()
        disk = get_disk_info()
        disk_io = get_disk_io()
        net_io = get_network_io()
        
        now = time.time()
        snapshot = json.dumps({
            't': round(now),
            'cpu': get_cpu_percent(),
            'ram_used': mem['used'],
            'ram_total': mem['total'],
            'ram_pct': mem['percent'],
            'disk_used': disk['used'],
            'disk_total': disk['total'],
            'disk_pct': disk['percent'],
            'dio_r': disk_io['read_bytes'],
            'dio_w': disk_io['write_bytes'],
            'net_s': net_io['bytes_sent'],
            'net_r': net_io['bytes_recv'],
        })
        
        # Store in Redis sorted set (score = timestamp)
        redis_conn.zadd(METRICS_KEY, {snapshot: now})
        
        # Clean old data (older than 31 days)
        cutoff = now - (31 * 24 * 3600)
        redis_conn.zremrangebyscore(METRICS_KEY, 0, cutoff)
        
    except Exception as e:
        logger.error(f"Failed to collect metrics: {e}")


def get_metrics_history(period='1h'):
    """
    Get historical metrics from Redis.
    
    period: '1h', '12h', '1d', '1w', '1m'
    Returns list of data points, downsampled appropriately.
    """
    period_map = {
        '1h': 3600,
        '12h': 12 * 3600,
        '1d': 24 * 3600,
        '1w': 7 * 24 * 3600,
        '1m': 30 * 24 * 3600,
    }
    
    seconds = period_map.get(period, 3600)
    now = time.time()
    start = now - seconds
    
    try:
        from django_redis import get_redis_connection
        redis_conn = get_redis_connection("default")
        raw_data = redis_conn.zrangebyscore(METRICS_KEY, start, now)
    except Exception as e:
        logger.warning(f"Failed to read metrics history: {e}")
        return []
    
    if not raw_data:
        return []
    
    # Parse all data points
    points = []
    for item in raw_data:
        try:
            if isinstance(item, bytes):
                item = item.decode('utf-8')
            points.append(json.loads(item))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
    
    if not points:
        return []
    
    # Downsample based on period
    # Target: ~150 data points max
    target_points = 150
    if len(points) <= target_points:
        return points
    
    # Group into time buckets and average
    bucket_size = max(1, len(points) // target_points)
    downsampled = []
    
    for i in range(0, len(points), bucket_size):
        bucket = points[i:i + bucket_size]
        if not bucket:
            continue
        
        avg = {
            't': bucket[len(bucket) // 2]['t'],  # midpoint timestamp
            'cpu': round(sum(p.get('cpu', 0) for p in bucket) / len(bucket), 1),
            'ram_pct': round(sum(p.get('ram_pct', 0) for p in bucket) / len(bucket), 1),
            'ram_used': round(sum(p.get('ram_used', 0) for p in bucket) / len(bucket)),
            'ram_total': bucket[0].get('ram_total', 0),
            'disk_pct': round(sum(p.get('disk_pct', 0) for p in bucket) / len(bucket), 1),
            'disk_used': round(sum(p.get('disk_used', 0) for p in bucket) / len(bucket)),
            'disk_total': bucket[0].get('disk_total', 0),
            'dio_r': bucket[-1].get('dio_r', 0),
            'dio_w': bucket[-1].get('dio_w', 0),
            'net_s': bucket[-1].get('net_s', 0),
            'net_r': bucket[-1].get('net_r', 0),
        }
        downsampled.append(avg)
    
    return downsampled


# ==========================================
# Docker API Client (via Unix socket)
# ==========================================

class DockerClient:
    """
    Lightweight Docker API client using Unix socket.
    No external dependencies required.
    """
    
    def __init__(self, socket_path='/var/run/docker.sock'):
        self.socket_path = socket_path
        self._available = None
    
    @property
    def available(self):
        if self._available is None:
            self._available = os.path.exists(self.socket_path)
        return self._available
    
    def _request(self, method, path, decode_json=True):
        """Make HTTP request to Docker daemon via Unix socket."""
        if not self.available:
            return None
        
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(5)
            sock.connect(self.socket_path)
            
            request = f"{method} {path} HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\n\r\n"
            sock.sendall(request.encode())
            
            # Read response
            response = b''
            while True:
                try:
                    chunk = sock.recv(65536)
                    if not chunk:
                        break
                    response += chunk
                    # Check if we've received the full response
                    if b'\r\n0\r\n\r\n' in response or (b'\r\n\r\n' in response and b'Transfer-Encoding: chunked' not in response):
                        break
                except socket.timeout:
                    break
            
            sock.close()
            
            # Parse HTTP response
            parts = response.split(b'\r\n\r\n', 1)
            if len(parts) < 2:
                return None
            
            body = parts[1]
            
            # Handle chunked transfer encoding
            if b'Transfer-Encoding: chunked' in parts[0]:
                body = self._decode_chunked(body)
            
            if decode_json:
                return json.loads(body.decode('utf-8', errors='replace'))
            return body
            
        except Exception as e:
            logger.warning(f"Docker API request failed: {e}")
            return None
    
    def _decode_chunked(self, data):
        """Decode chunked transfer encoding."""
        result = b''
        while data:
            # Find chunk size line
            line_end = data.find(b'\r\n')
            if line_end == -1:
                break
            size_str = data[:line_end].decode('ascii', errors='replace').strip()
            if not size_str:
                data = data[line_end + 2:]
                continue
            try:
                chunk_size = int(size_str, 16)
            except ValueError:
                break
            if chunk_size == 0:
                break
            data = data[line_end + 2:]
            result += data[:chunk_size]
            data = data[chunk_size + 2:]  # skip trailing \r\n
        return result
    
    def list_containers(self):
        """List all containers (running and stopped)."""
        data = self._request('GET', '/containers/json?all=true')
        if not data:
            return []
        
        containers = []
        for c in data:
            containers.append({
                'id': c.get('Id', '')[:12],
                'name': (c.get('Names', [''])[0] or '').lstrip('/'),
                'image': c.get('Image', ''),
                'status': c.get('Status', ''),
                'state': c.get('State', ''),
                'created': c.get('Created', 0),
                'ports': c.get('Ports', []),
            })
        
        return containers
    
    def get_container_logs(self, container_id, tail=100):
        """Get container logs."""
        data = self._request(
            'GET',
            f'/containers/{container_id}/logs?stdout=1&stderr=1&tail={tail}&timestamps=1',
            decode_json=False
        )
        
        if not data:
            return []
        
        # Docker multiplexed log format: 8-byte header per frame
        # Byte 0: stream type (1=stdout, 2=stderr)
        # Bytes 4-7: frame size (big-endian uint32)
        lines = []
        pos = 0
        raw = data if isinstance(data, bytes) else data.encode()
        
        while pos < len(raw):
            if pos + 8 > len(raw):
                # Remaining data might be plain text
                remaining = raw[pos:].decode('utf-8', errors='replace').strip()
                if remaining:
                    lines.extend(remaining.split('\n'))
                break
            
            # Read header
            stream_type = raw[pos]
            frame_size = struct.unpack('>I', raw[pos + 4:pos + 8])[0]
            
            if frame_size == 0 or pos + 8 + frame_size > len(raw):
                # Might be plain text logs (no multiplexing)
                remaining = raw[pos:].decode('utf-8', errors='replace').strip()
                if remaining:
                    lines.extend(remaining.split('\n'))
                break
            
            frame = raw[pos + 8:pos + 8 + frame_size].decode('utf-8', errors='replace').rstrip('\n')
            stream = 'stderr' if stream_type == 2 else 'stdout'
            
            for line in frame.split('\n'):
                if line.strip():
                    lines.append(f"[{stream}] {line}")
            
            pos += 8 + frame_size
        
        return lines[-tail:]  # Ensure we don't return more than requested
    
    def get_container_stats(self, container_id):
        """Get container resource stats (one-shot)."""
        data = self._request('GET', f'/containers/{container_id}/stats?stream=false')
        if not data:
            return None
        
        try:
            # CPU calculation
            cpu_delta = (data.get('cpu_stats', {}).get('cpu_usage', {}).get('total_usage', 0) -
                        data.get('precpu_stats', {}).get('cpu_usage', {}).get('total_usage', 0))
            system_delta = (data.get('cpu_stats', {}).get('system_cpu_usage', 0) -
                           data.get('precpu_stats', {}).get('system_cpu_usage', 0))
            online_cpus = data.get('cpu_stats', {}).get('online_cpus', 1) or 1
            
            cpu_percent = 0.0
            if system_delta > 0 and cpu_delta > 0:
                cpu_percent = round((cpu_delta / system_delta) * online_cpus * 100, 2)
            
            # Memory
            mem_stats = data.get('memory_stats', {})
            mem_usage = mem_stats.get('usage', 0)
            mem_limit = mem_stats.get('limit', 0)
            # Subtract cache from usage for more accurate number
            cache_mem = mem_stats.get('stats', {}).get('cache', 0)
            mem_actual = mem_usage - cache_mem
            
            return {
                'cpu_percent': cpu_percent,
                'memory_usage': max(0, mem_actual),
                'memory_limit': mem_limit,
                'memory_percent': round((mem_actual / mem_limit) * 100, 2) if mem_limit > 0 else 0,
            }
        except Exception as e:
            logger.warning(f"Failed to parse container stats: {e}")
            return None


# Global Docker client instance
docker_client = DockerClient()


# ==========================================
# Background Metrics Collector
# ==========================================

class MetricsCollector:
    """
    Background thread that collects system metrics every 60 seconds
    and stores them in Redis.
    """
    _instance = None
    _lock = threading.Lock()
    
    def __init__(self):
        self._running = False
        self._thread = None
    
    @classmethod
    def instance(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance
    
    def start(self):
        if self._running:
            return
        
        self._running = True
        self._thread = threading.Thread(
            target=self._collect_loop,
            daemon=True,
            name='metrics-collector'
        )
        self._thread.start()
        logger.info("Metrics collector started (interval: %ds)", COLLECT_INTERVAL)
    
    def stop(self):
        self._running = False
    
    def _collect_loop(self):
        """Main collection loop."""
        # Initial delay to let Django fully start
        time.sleep(10)
        
        # Do an initial CPU read to warm up the delta calculation
        get_cpu_percent()
        time.sleep(1)
        
        while self._running:
            try:
                collect_metrics_snapshot()
            except Exception as e:
                logger.error(f"Metrics collection error: {e}")
            
            # Sleep in small intervals so we can stop quickly
            for _ in range(COLLECT_INTERVAL):
                if not self._running:
                    break
                time.sleep(1)
