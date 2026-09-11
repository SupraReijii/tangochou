Rails.application.config.session_store :redis_session_store,
  key: "_tangochou_session",
  redis: {
    expire_after: 30.days,
    key_prefix: "tangochou:session:",
    url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0")
  }
