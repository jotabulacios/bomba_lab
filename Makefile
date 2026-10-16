PORT ?= 8000

.PHONY: serve test site

serve: ## Serve the app at http://localhost:$(PORT)
	python3 tools/serve.py $(PORT)

test: ## Run the physics test suite (Node >= 20, no dependencies)
	node --test tests/*.test.mjs

site: ## Build the versioned Pages site into _site/ (what the Pages workflow deploys)
	python3 tools/build_site.py --out _site
