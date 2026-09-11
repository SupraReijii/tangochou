class ApplicationController < ActionController::Base
  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  private

  def current_user
    @current_user ||= User.find(session[:user_id]) if session[:user_id]
  end
  helper_method :current_user

  def logged_in?
    current_user.present?
  end
  helper_method :logged_in?

  def require_login
    return if logged_in?
    respond_to do |format|
      format.html { redirect_to login_path, alert: "Please sign in first." }
      format.json { render json: { error: "unauthorized" }, status: :unauthorized }
      format.any { head :unauthorized }
    end
  end
end
