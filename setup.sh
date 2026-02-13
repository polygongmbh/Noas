#!/bin/bash

# Noas Quick Start Script

echo "Noas Quick Start"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cp .env.example .env
    echo "⚠️ Please edit .env with your database credentials"
    echo ""
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

echo ""
echo "🗄️  Setting up database..."
echo "Make sure PostgreSQL is running and your DATABASE_URL in .env is correct"
echo ""
read -p "Press enter to continue with database setup..."

npm run db:setup

echo ""
echo "🧪 Running tests..."
npm test

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the server:"
echo "  npm run dev    # Development mode with auto-reload"
echo "  npm start      # Production mode"
echo ""
echo "NIP-05 verification will be available at:"
echo "  https://yourdomain.com/.well-known/nostr.json?name=username"
