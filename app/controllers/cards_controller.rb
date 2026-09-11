class CardsController < ApplicationController
  before_action :require_login
  before_action :set_owned_card, only: [:update, :destroy, :grade]

  def index
    render json: Card.for_user(current_user.id)
  end

  def create
    card = Card.new(card_params.merge(user_id: current_user.id))
    if card.save
      render json: card, status: :created
    else
      render json: { errors: card.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    if @card.update(card_params)
      render json: @card
    else
      render json: { errors: @card.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @card.destroy
    head :no_content
  end

  def grade
    grade = params[:grade].to_s
    unless Card::GRADES.include?(grade)
      return render json: { error: "grade must be one of #{Card::GRADES.join(', ')}" }, status: :unprocessable_entity
    end
    @card.apply_grade!(grade)
    render json: @card
  end

  private

  def set_owned_card
    @card = Card.find(params[:id])
    head :not_found unless @card && @card.user_id == current_user.id
  end

  def card_params
    params.permit(:japanese, :reading, :meaning, :tags, :image_id).to_h.symbolize_keys
  end
end
