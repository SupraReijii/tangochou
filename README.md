# Tangochou (単語帳)

A Ruby on Rails app for learning Japanese vocabulary with flashcards. Sign in, add your own cards — an image on one side, the Japanese word on the other — then drill them in three modes:

- **Recognition (見る)** — see the image, recall the word, reveal to check. No typing.
- **Recall (書く)** — see the image, type the Japanese word yourself before revealing (romaji auto-converts to かな live via [wanakana](https://github.com/WaniKani/WanaKana)).
- **Reverse (訳す)** — see the Japanese term first, recall its meaning.

Progress per card is tracked with a simple Leitner-style spaced-repetition schedule (again / hard / good / easy).

## Architecture

**Redis is the only datastore** — no SQL database anywhere. Users, cards, card images, and even Rails sessions all live in Redis:

- `app/models/redis_model.rb` — a small base class giving plain Ruby objects Redis-backed persistence (hash per record, id sets, auto-incrementing ids), plus `ActiveModel::Model` for validations/errors.
- `User` (`user:<id>`) — email + bcrypt password digest, with a `user:email_index` hash for login lookups.
- `Card` (`card:<id>`) — one flashcard's content and SRS state, indexed per-user in a sorted set (`user:<id>:card_ids`, scored by creation time).
- Card images are stored directly as Redis hashes (`card_image:<id>`, holding the bytes + content type) and served via `ImagesController`.
- Sessions use [`redis-session-store`](https://github.com/roidrage/redis-session-store), so login state is Redis too — no cookie-stored session data beyond the id.

The frontend (`app/views/home/index.html.erb`, `public/app.js`, `public/app.css`) is a small vanilla-JS single-page app that talks to a JSON API (`CardsController`, `ImagesController`) — no JS build step, no asset pipeline (Rails was generated with `--skip-asset-pipeline --skip-javascript`, so `public/*.css|js` are served as plain static files).

Auth (`SessionsController`, `RegistrationsController`) is server-rendered ERB with `has_secure_password`-style bcrypt hashing, done by hand since there's no ActiveRecord.

## Running it

Requires a local Redis server (`redis-server`) and Ruby 3.2+.

```
bundle install
redis-server &                 # if not already running
bin/rails server
```

Then visit `http://localhost:3000`, create an account, and start adding cards.

Redis connection defaults to `redis://localhost:6379/0`; override with `REDIS_URL`.

## Notes

- The `json` gem is pinned to `~> 2.9` in the Gemfile — `json` 3.x changed `JSON.parse`'s arity in a way that's incompatible with this Rails version's `ActiveSupport::JSON.decode`, which breaks every JSON request until pinned back.
