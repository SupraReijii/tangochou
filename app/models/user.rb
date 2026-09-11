# A registered user. Stored at "user:<id>"; a separate hash
# "user:email_index" maps normalized email => id so login and signup can
# look a user up without scanning every record.
class User < RedisModel
  attr_accessor :email, :password_digest, :created_at, :password

  validates :email, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :password, length: { minimum: 8 }, if: -> { new_record? || @password.present? }
  validate :email_must_be_unique

  class << self
    def email_index_key
      "user:email_index"
    end

    def normalize_email(email)
      email.to_s.strip.downcase
    end

    def find_by_email(email)
      id = redis.hget(email_index_key, normalize_email(email))
      id && find(id)
    end

    def authenticate(email, password)
      user = find_by_email(email)
      user && user.authenticate(password) ? user : nil
    end

    def from_redis(data)
      new(
        id: data["id"],
        email: data["email"],
        password_digest: data["password_digest"],
        created_at: data["created_at"]
      )
    end
  end

  def authenticate(plaintext_password)
    return false if password_digest.blank?
    BCrypt::Password.new(password_digest) == plaintext_password
  rescue BCrypt::Errors::InvalidHash
    false
  end

  private

  def email_must_be_unique
    return if email.blank?
    existing_id = self.class.redis.hget(self.class.email_index_key, self.class.normalize_email(email))
    errors.add(:email, "is already taken") if existing_id && existing_id != id
  end

  def write_to_redis(was_new)
    self.password_digest = BCrypt::Password.create(@password) if @password.present?
    self.created_at ||= Time.current.iso8601
    super
    self.class.redis.hset(self.class.email_index_key, self.class.normalize_email(email), id) if was_new
  end

  def to_redis_hash
    { "id" => id, "email" => email, "password_digest" => password_digest, "created_at" => created_at }
  end
end
