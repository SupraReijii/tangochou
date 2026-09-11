class ImagesController < ApplicationController
  before_action :require_login

  MAX_BYTES = 8.megabytes
  ALLOWED_TYPES = %w[image/jpeg image/png image/webp image/gif].freeze

  # Card images are stored directly in Redis, keyed by an unguessable id —
  # no filesystem, no S3, same "Redis is the only datastore" rule as
  # everything else. POST returns the id/url a card can then reference.
  def create
    file = params[:image]
    unless file.respond_to?(:read)
      return render json: { error: "No image file provided." }, status: :unprocessable_entity
    end

    content_type = file.content_type.to_s
    unless ALLOWED_TYPES.include?(content_type)
      return render json: { error: "Unsupported image type." }, status: :unprocessable_entity
    end

    bytes = file.read
    if bytes.bytesize > MAX_BYTES
      return render json: { error: "Image is too large (max 8MB)." }, status: :unprocessable_entity
    end

    id = SecureRandom.hex(16)
    REDIS.hset("card_image:#{id}", "data", bytes, "content_type", content_type)
    render json: { id: id, url: "/images/#{id}" }, status: :created
  end

  def show
    data, content_type = REDIS.hmget("card_image:#{params[:id]}", "data", "content_type")
    return head :not_found if data.nil?
    send_data data, type: content_type.presence || "image/jpeg", disposition: "inline"
  end
end
