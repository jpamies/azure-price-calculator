PY ?= python3
PIPELINE = PYTHONPATH=pipeline/src $(PY) -m azcalc_pipeline
SAMPLE_REGIONS = westeurope,israelcentral,southcentralus,eastus
SAMPLE_SERVICES = Virtual Machines,Storage,Backup,Azure Site Recovery,Virtual Machines Licenses

.PHONY: help install data-sample data-real dev build test test-pipeline test-web icons vm-skus

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

install: ## Install web dependencies
	cd web && npm ci

data-sample: ## Synthetic sample snapshot (no network) -> web/public/data
	$(PIPELINE) build --fixture --out web/public/data

data-real: ## Latest exporter release, reduced to 4 regions / 5 services -> web/public/data
	$(PIPELINE) build --out web/public/data --min-rows 0 \
		--regions "$(SAMPLE_REGIONS)" --services "$(SAMPLE_SERVICES)"

dev: ## Run the SPA locally (needs data-sample or data-real first)
	cd web && npm run dev

build: ## Type-check and build the SPA into web/dist
	cd web && npm run build

test: test-pipeline test-web ## Run all tests

test-pipeline: ## Pipeline tests (stdlib unittest; CI uses pytest)
	cd pipeline && $(PY) -m unittest discover -s tests

test-web: ## Web unit tests (node --test)
	cd web && npm test

icons: ## Download the official Azure Architecture Icons used by the app
	$(PY) scripts/sync_icons.py

vm-skus: ## Refresh VM specs (vCPU/RAM) with the Azure CLI (needs az login)
	bash scripts/export-vm-skus.sh
