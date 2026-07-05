# Sketchbook workflow. `make new NAME=foo`, `make dev`, `make publish`.

PUBLISH_DIR ?= /var/lib/sketchbook
# Set PUBLISH_HOST to rsync over SSH instead of a local copy
# (e.g. PUBLISH_HOST=nixos). Empty = we're on the homelab itself.
PUBLISH_HOST ?=
RSYNC_FLAGS := -rlptv --delete
ifdef DRY
RSYNC_FLAGS += --dry-run
endif

.PHONY: new dev build publish

new:
ifndef NAME
	$(error usage: make new NAME=my-sketch)
endif
	cp -r sketches/_template "sketches/$(shell date +%Y-%m)-$(NAME)"
	@echo "created sketches/$(shell date +%Y-%m)-$(NAME) — edit meta.json first"

dev:
	npm run dev

build:
	npm run build

publish: build
ifeq ($(PUBLISH_HOST),)
	rsync $(RSYNC_FLAGS) dist/ $(PUBLISH_DIR)/
else
	rsync $(RSYNC_FLAGS) dist/ $(PUBLISH_HOST):$(PUBLISH_DIR)/
endif
