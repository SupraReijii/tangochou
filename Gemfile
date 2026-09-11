source "https://rubygems.org"

# Bundle edge Rails instead: gem "rails", github: "rails/rails", branch: "main"
gem "rails", "~> 8.1.3", ">= 8.1.3.1"
# Use the Puma web server [https://github.com/puma/puma]
gem "puma", ">= 5.0"

# Windows does not include zoneinfo files, so bundle the tzinfo-data gem
gem "tzinfo-data", platforms: %i[ windows jruby ]

# json 3.x changed JSON.parse's arity in a way ActiveSupport::JSON.decode
# (still on this Rails version) calls incompatibly — pin to the 2.x line.
gem "json", "~> 2.9"

# Redis is this app's only datastore: cards, users, and sessions all live here.
gem "redis", "~> 5.3"
gem "redis-session-store", "~> 0.11"
gem "bcrypt", "~> 3.1"

group :development, :test do
  # See https://guides.rubyonrails.org/debugging_rails_applications.html#debugging-with-the-debug-gem
  gem "debug", platforms: %i[ mri windows ], require: "debug/prelude"
end
