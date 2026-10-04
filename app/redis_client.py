import os
from pathlib import Path
from dotenv import load_dotenv
import redis

# Load environment variables
BASE_DIR = Path(__file__).resolve().parent.parent
env_path = BASE_DIR / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

REDIS_URL = os.getenv("REDIS_URL")

if REDIS_URL:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
else:
    host = os.getenv("REDIS_HOST", "localhost")
    if host == "redis":
        import socket
        try:
            socket.gethostbyname("redis")
        except socket.gaierror:
            host = "localhost"

    redis_client = redis.Redis(
        host=host,
        port=int(os.getenv("REDIS_PORT", "6379")),
        password=os.getenv("REDIS_PASSWORD") or None,
        decode_responses=True
    )

