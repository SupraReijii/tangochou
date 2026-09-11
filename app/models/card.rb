# One flashcard: an image, a Japanese term, its reading and meaning, plus
# this user's spaced-repetition progress on it. Stored at "card:<id>"; a
# per-user sorted set "user:<id>:card_ids" (scored by creation time) lets
# CardsController list one user's deck without scanning every card.
class Card < RedisModel
  INTERVAL_DAYS = [0, 1, 2, 4, 7, 14, 30].freeze
  GRADES = %w[again hard good easy].freeze
  MASTERED_BOX = 5

  attr_accessor :user_id, :japanese, :reading, :meaning, :tags, :image_id,
                :created_at, :next_review_at
  attr_writer :box, :total_reviews, :correct_reviews

  validates :user_id, :japanese, :meaning, presence: true

  def box
    @box || 0
  end

  def total_reviews
    @total_reviews || 0
  end

  def correct_reviews
    @correct_reviews || 0
  end

  class << self
    def user_cards_key(user_id)
      "user:#{user_id}:card_ids"
    end

    # Newest first, matching how the deck view lists cards.
    def for_user(user_id)
      redis.zrevrange(user_cards_key(user_id), 0, -1).map { |id| find(id) }.compact
    end

    def next_box(box, grade)
      case grade
      when "again" then 0
      when "hard" then [box - 1, 0].max
      when "easy" then [box + 2, INTERVAL_DAYS.size - 1].min
      else [box + 1, INTERVAL_DAYS.size - 1].min # "good"
      end
    end

    def from_redis(data)
      new(
        id: data["id"], user_id: data["user_id"], japanese: data["japanese"],
        reading: data["reading"], meaning: data["meaning"], tags: data["tags"],
        image_id: data["image_id"].presence,
        box: data["box"].to_i, total_reviews: data["total_reviews"].to_i,
        correct_reviews: data["correct_reviews"].to_i,
        created_at: data["created_at"], next_review_at: data["next_review_at"]
      )
    end
  end

  def due?(at = Time.current)
    Time.iso8601(next_review_at.presence || created_at) <= at
  rescue ArgumentError, TypeError
    true
  end

  def mastered?
    box >= MASTERED_BOX
  end

  # Applies a self-graded review outcome, advancing (or resetting) the
  # Leitner box and scheduling the next review, then persists.
  def apply_grade!(grade)
    self.box = self.class.next_box(box, grade)
    self.next_review_at = (Time.current + INTERVAL_DAYS[box].days).iso8601
    self.total_reviews += 1
    self.correct_reviews += 1 unless grade == "again"
    save
  end

  def destroy
    self.class.redis.multi do |tx|
      tx.zrem(self.class.user_cards_key(user_id), id)
      tx.del("card_image:#{image_id}") if image_id.present?
    end
    super
  end

  def as_json(*)
    {
      id: id, japanese: japanese, reading: reading, meaning: meaning, tags: tags,
      image_id: image_id, image_url: image_id.present? ? "/images/#{image_id}" : nil,
      box: box, total_reviews: total_reviews, correct_reviews: correct_reviews,
      created_at: created_at, next_review_at: next_review_at,
      due: due?, mastered: mastered?
    }
  end

  private

  def write_to_redis(was_new)
    self.created_at ||= Time.current.iso8601
    self.next_review_at ||= created_at
    super
    return unless was_new
    self.class.redis.zadd(self.class.user_cards_key(user_id), Time.iso8601(created_at).to_f, id)
  end

  def to_redis_hash
    {
      "id" => id, "user_id" => user_id, "japanese" => japanese,
      "reading" => reading.to_s, "meaning" => meaning, "tags" => tags.to_s,
      "image_id" => image_id.to_s, "box" => box.to_s,
      "total_reviews" => total_reviews.to_s, "correct_reviews" => correct_reviews.to_s,
      "created_at" => created_at, "next_review_at" => next_review_at
    }
  end
end
