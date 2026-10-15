PORT ?= 8000

.PHONY: serve test

serve: ## Serve the app at http://localhost:$(PORT)
	python3 tools/serve.py $(PORT)

test: ## Run the physics test suite (Node >= 20, no dependencies)
	node --test tests/*.test.mjs
