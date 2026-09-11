Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  root "home#index"

  get  "signup", to: "registrations#new",  as: :signup
  post "signup", to: "registrations#create"
  get  "login",  to: "sessions#new",       as: :login
  post "login",  to: "sessions#create"
  delete "logout", to: "sessions#destroy", as: :logout

  resources :cards, only: [:index, :create, :update, :destroy] do
    member { post :grade }
  end

  resources :images, only: [:create, :show]
end
