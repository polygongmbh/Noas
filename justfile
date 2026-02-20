# Noas - Just Commands

# Default recipe (shows available commands)
default:
    @just --list

# Install dependencies
install:
    npm install

# Start full stack (db + app)
up:
    docker compose up -d

# Rebuild and restart app (db + app)
restart:
    docker compose up -d --build noas

# Start PostgreSQL database
db-start:
    docker compose up -d postgres
    @echo "Waiting for database to be ready..."
    @sleep 3

# Stop PostgreSQL database
db-stop:
    docker compose down

# Restart database (clean slate)
db-restart:
    docker compose down -v
    docker compose up -d postgres
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

# Run tests inside the Docker container (rebuilds image first)
test-docker: restart
    docker exec -e NODE_ENV=test noas node --test src/auth.test.js src/db/users.test.js src/routes.test.js

# Run all tests (unit + integration)
test-all:
    npm test

# Run tests in watch mode
test-watch:
    npm run test:watch

# Health check
health:
    @curl -s http://localhost:3007/health | jq || curl http://localhost:3007/health

# Demo: Register a user
demo-register username="demo_user" password="securepass123":
    @echo "Registering user: {{username}}"
    @bash -lc 'curl -s -X POST http://localhost:3007/register -H "Content-Type: application/json" -d '"'"'{"username":"{{username}}","password":"{{password}}","publicKey":"abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234","encryptedPrivateKey":"ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p"}'"'"' | (command -v jq >/dev/null && jq || cat)'; echo ""

# Demo: Sign in
demo-signin username="demo_user" password="securepass123":
    @echo "Signing in: {{username}}"
    @bash -lc 'curl -s -X POST http://localhost:3007/signin -H "Content-Type: application/json" -d '"'"'{"username":"{{username}}","password":"{{password}}"}'"'"' | (command -v jq >/dev/null && jq || cat)'; echo ""

# Demo: NIP-05 verification
demo-nip05 username="demo_user":
    @echo "NIP-05 lookup: {{username}}"
    @bash -lc 'curl -s "http://localhost:3007/.well-known/nostr.json?name={{username}}" | (command -v jq >/dev/null && jq || cat)'; echo ""

# Run full demo flow
demo: demo-register demo-signin demo-nip05
    @echo "✅ Demo complete!"

# Demo: Upload profile picture
demo-picture username="demo_user" password="securepass123":
    @echo "Uploading profile picture for: {{username}}"
    @bash -lc 'curl -s -X POST http://localhost:3007/picture -H "Content-Type: application/json" -d '"'"'{"username":"{{username}}","password":"{{password}}","contentType":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2S+0sAAAAASUVORK5CYII="}'"'"' | (command -v jq >/dev/null && jq || cat)'; echo ""
    @echo ""
    @echo "Fetch image:"
    @curl -s -o /tmp/noas_demo_pic.bin http://localhost:3007/picture/abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234
    @echo "Saved to /tmp/noas_demo_pic.bin (size: $(wc -c < /tmp/noas_demo_pic.bin) bytes)"

# Demo: Full profile picture flow (register + upload + fetch)
demo-picture-full username="demo_user" password="securepass123":
    @just demo-register "{{username}}" "{{password}}"
    @just demo-picture "{{username}}" "{{password}}"

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
    @curl -s http://localhost:3007/health > /dev/null && echo "✅ Server is running" || echo "❌ Server is not running"

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
