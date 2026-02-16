# Noas - Just Commands

# Default recipe (shows available commands)
default:
    @just --list

# Install dependencies
install:
    npm install

# Start PostgreSQL database
db-start:
    docker-compose up -d
    @echo "Waiting for database to be ready..."
    @sleep 3

# Stop PostgreSQL database
db-stop:
    docker-compose down

# Restart database (clean slate)
db-restart:
    docker-compose down -v
    docker-compose up -d
    @sleep 3

# Setup database schema
db-setup: db-start
    npm run db:setup

# Connect to database shell
db-shell:
    docker exec -it noas-db psql -U noas -d noas

# Full setup (install + db + schema)
setup: install db-setup
    @echo "✅ Setup complete! Run 'just dev' to start the server"

# Start development server
dev:
    npm run dev

# Run unit tests (recommended)
test:
    npm run test:unit

# Run integration tests (requires server running)
test-integration:
    ./test-api.sh

# Run all tests (unit + integration)
test-all:
    npm test

# Run tests in watch mode
test-watch:
    npm run test:watch

# Health check
health:
    @curl -s http://localhost:3000/health | jq || curl http://localhost:3000/health

# Demo: Register a user
demo-register username="demo_user" password="securepass123":
    @echo "Registering user: {{username}}"
    @curl -X POST http://localhost:3000/register -H "Content-Type: application/json" -d '{"username":"{{username}}","password":"{{password}}","publicKey":"abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234","encryptedPrivateKey":"ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p"}' | jq || echo ""

# Demo: Sign in
demo-signin username="demo_user" password="securepass123":
    @echo "Signing in: {{username}}"
    @curl -X POST http://localhost:3000/signin -H "Content-Type: application/json" -d '{"username":"{{username}}","password":"{{password}}"}' | jq || echo ""

# Demo: NIP-05 verification
demo-nip05 username="demo_user":
    @echo "NIP-05 lookup: {{username}}"
    @curl -s "http://localhost:3000/.well-known/nostr.json?name={{username}}" | jq || echo ""

# Run full demo flow
demo: demo-register demo-signin demo-nip05
    @echo "✅ Demo complete!"

# Show git log
log:
    git log --oneline --graph --all

# Show git status
status:
    git status

# Clean everything (database, node_modules, etc)
clean:
    docker-compose down -v
    rm -rf node_modules
    rm -f package-lock.json

# Presentation: Full setup and test
present-setup: db-restart db-setup
    @echo "\n✅ Database ready"
    @echo "Running all tests...\n"
    @npm run test:unit
    @echo "\nStarting server for integration tests..."
    @echo "Run 'just dev' in another terminal, then 'just test-integration'"

# Presentation: Run all tests (requires server already running)
present-test:
    @echo "=== Unit Tests ==="
    @npm run test:unit
    @echo "\n=== Integration Tests ==="
    @./test-api.sh
    @echo "\n✅ All tests passed!"

# Presentation: Quick health check
present-check:
    @echo "=== Health Check ==="
    @just health
    @echo "\n=== Unit Test Status ==="
    @npm run test:unit 2>&1 | tail -5
    @echo "\n=== Database Status ==="
    @docker ps | grep noas-db || echo "Database not running"

# Check if server is running
check-server:
    @curl -s http://localhost:3000/health > /dev/null && echo "✅ Server is running" || echo "❌ Server is not running"

# Push to git remote
push remote="origin" branch="master":
    git push {{remote}} {{branch}}

# Add git remote
add-remote name="origin" url="":
    git remote add {{name}} {{url}}
    git remote -v

# Commit all changes
commit message:
    git add -A
    git commit -m "{{message}}"

# Quick commit and push
save message: (commit message) (push "origin" "master")
