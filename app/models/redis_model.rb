# Base class for records stored as a Redis hash at "<prefix>:<id>", with
# ids tracked in a Redis set at "<prefix>:ids" and minted from an
# auto-incrementing "<prefix>:seq" counter. There is no relational
# database anywhere in this app — Redis is it.
class RedisModel
  include ActiveModel::Model

  class << self
    def redis
      REDIS
    end

    def key_prefix
      name.underscore
    end

    def ids_key
      "#{key_prefix}:ids"
    end

    def key_for(id)
      "#{key_prefix}:#{id}"
    end

    def next_id
      redis.incr("#{key_prefix}:seq").to_s
    end

    def create(attrs = {})
      record = new(attrs)
      record.save
      record
    end

    def find(id)
      return nil if id.blank?
      data = redis.hgetall(key_for(id))
      return nil if data.empty?
      from_redis(data)
    end

    def destroy(id)
      redis.srem(ids_key, id.to_s)
      redis.del(key_for(id))
    end
  end

  attr_accessor :id

  def new_record?
    id.nil?
  end

  def persisted?
    !new_record?
  end

  def to_param
    id
  end

  def save
    return false unless valid?
    was_new = new_record?
    self.id ||= self.class.next_id
    write_to_redis(was_new)
    true
  end

  def update(attrs)
    assign_attributes(attrs)
    save
  end

  def destroy
    self.class.destroy(id)
  end

  private

  # Subclasses override to add extra index writes (sets/sorted sets keyed
  # off `was_new`), calling `super` first to persist the hash itself.
  def write_to_redis(was_new)
    hash = to_redis_hash
    self.class.redis.multi do |tx|
      tx.hset(self.class.key_for(id), *hash.to_a.flatten)
      tx.sadd(self.class.ids_key, id)
    end
  end
end
