# Noas - Just Commands
noas_base_url := env_var_or_default("NOAS_BASE_URL", "http://localhost:3000")

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
    npm run db:migrate

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

# Run unit tests excluding problematic ones
test-stable:
    NODE_ENV=test node --test src/auth.test.js src/db/nip46.test.js src/nip46.test.js src/nip46-demo.test.js

# Run unit tests including NIP-46
test-nip46:
    NODE_ENV=test node --test src/nip46-demo.test.js

# Run unit tests for NIP-46 components only  
test-nip46-only:
    NODE_ENV=test node --test src/db/nip46.test.js src/nip46.test.js

# Run NIP-46 integration tests (requires server running)
test-nip46-integration:
    ./test-nip46.sh

# Run integration tests (requires server running)
test-integration:
    ./test-api.sh

# Run tests inside the Docker container (rebuilds image first)
test-docker: restart
    docker exec -e NODE_ENV=test noas node --test src/auth.test.js src/db/users.test.js src/routes.test.js

# Run all NIP-46 tests (unit + integration)
test-all-nip46:
    @echo "=== NIP-46 Unit Tests ==="
    @just test-nip46-only
    @echo "\n=== NIP-46 Demo Test ==="
    @just test-nip46
    @echo "\n=== NIP-46 Integration Tests ==="
    @just test-nip46-integration
    @echo "\n✅ All NIP-46 tests complete!"

# Run all tests (unit + integration + NIP-46) 
test-all:
    @echo "=== Stable Tests ==="
    @just test-stable
    @echo "\n=== Integration Tests ==="
    @./test-api.sh
    @echo "\n=== NIP-46 Integration Tests ==="
    @./test-nip46.sh
    @echo "\n✅ All tests complete!"

# Run tests in watch mode
test-watch:
    npm run test:watch

# Health check
health:
    @curl -s "{{noas_base_url}}/health" | jq || curl "{{noas_base_url}}/health"

# Demo: Register a user
demo-register username="demo_user" password="securepass123":
    @echo "Registering user: {{username}}"
    @bash -lc 'curl -s -X POST "{{noas_base_url}}/register" -H "Content-Type: application/json" -d '"'"'{"username":"{{username}}","password":"{{password}}","public_key":"abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234","private_key_encrypted":"ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p"}'"'"' | (command -v jq >/dev/null && jq || cat)'; echo ""

# Demo: Sign in
demo-signin username="demo_user" password="securepass123":
    @echo "Signing in: {{username}}"
    @bash -lc 'curl -s -X POST "{{noas_base_url}}/signin" -H "Content-Type: application/json" -d '"'"'{"username":"{{username}}","password":"{{password}}"}'"'"' | (command -v jq >/dev/null && jq || cat)'; echo ""

# Demo: NIP-05 verification
demo-nip05 username="demo_user":
    @echo "NIP-05 lookup: {{username}}"
    @bash -lc 'curl -s "{{noas_base_url}}/.well-known/nostr.json?name={{username}}" | (command -v jq >/dev/null && jq || cat)'; echo ""

# Demo: NIP-46 signer info
demo-nip46-info:
    @echo "NIP-46 Signer Information:"
    @bash -lc 'curl -s "{{noas_base_url}}/nip46/info" | (command -v jq >/dev/null && jq || cat)'; echo ""

# Demo: NIP-46 connection token generation
demo-nip46-connect username="demo_user":
    @echo "Generating NIP-46 connection token for: {{username}}"
    @bash -lc 'curl -s "{{noas_base_url}}/nip46/connect/{{username}}" | (command -v jq >/dev/null && jq || cat)'; echo ""

# Demo: Full NIP-46 flow (register user + get connection token + info)
demo-nip46 username="demo_user" password="securepass123":
    @echo "=== NIP-46 Remote Signer Demo ==="
    @just demo-register "{{username}}" "{{password}}"
    @echo ""
    @just demo-nip46-info
    @echo ""
    @just demo-nip46-connect "{{username}}"
    @echo ""
    @echo "✅ NIP-46 demo complete! Use the bunker:// URL in your NIP-46 compatible client."

# Run full demo flow (including NIP-46)
demo: demo-register demo-signin demo-nip05 (demo-nip46 "demo_user" "securepass123")
    @echo "✅ All demos complete!"

# Demo: Upload profile picture
demo-picture username="demo_user" password="securepass123":
    @echo "Uploading profile picture for: {{username}}"
    @bash -lc 'curl -s -X POST "{{noas_base_url}}/picture" -H "Content-Type: application/json" -d '"'"'{"username":"{{username}}","password":"{{password}}","content_type":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2S+0sAAAAASUVORK5CYII="}'"'"' | (command -v jq >/dev/null && jq || cat)'; echo ""
    @echo ""
    @echo "Fetch image:"
    @curl -s -o /tmp/noas_demo_pic.bin "{{noas_base_url}}/picture/abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234"
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
    @echo "\n=== NIP-46 Demo Test ==="
    @NODE_ENV=test node --test src/nip46-demo.test.js
    @echo "\n=== Integration Tests ==="
    @./test-api.sh
    @echo "\n=== NIP-46 Integration Tests ==="
    @./test-nip46.sh
    @echo "\n✅ All tests passed!"

# Presentation: NIP-46 specific demo
present-nip46:
    @echo "=== NIP-46 Remote Signer Demo ==="
    @just demo-nip46
    @echo "\n=== NIP-46 Tests ==="
    @just test-nip46
    @echo "\n✅ NIP-46 presentation complete!"

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
    @curl -s "{{noas_base_url}}/health" > /dev/null && echo "✅ Server is running" || echo "❌ Server is not running"

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
