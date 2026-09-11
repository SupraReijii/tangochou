class RegistrationsController < ApplicationController
  def new
    @user = User.new
  end

  def create
    @user = User.new(email: params[:email], password: params[:password])
    if @user.save
      reset_session
      session[:user_id] = @user.id
      redirect_to root_path, notice: "Account created."
    else
      render :new, status: :unprocessable_entity
    end
  end
end
