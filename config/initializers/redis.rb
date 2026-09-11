# Redis is this app's only datastore — users, cards, images and sessions
# all live here. One connection, reused across the app.
REDIS = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
