# Sketchbook workflow. `make new NAME=foo`, `make dev`, `make publish`.

PUBLISH_DIR ?= /var/lib/sketchbook
# Set PUBLISH_HOST to rsync over SSH instead of a local copy
# (e.g. PUBLISH_HOST=nixos). Empty = we're on the homelab itself.
PUBLISH_HOST ?=
# No -p, plus -O (--omit-dir-times): the publish root is root:sketchbook and we
# only own its *contents*, so preserving times and modes on the destination
# directory itself fails with "Operation not permitted" and rsync exits 23 —
# a partial-transfer code — even though all 35 files landed. Dropping both lets
# the remote umask set the modes (644/755, which is what they already were) and
# leaves the root's own attributes alone. There is no --omit-dir-perms to be
# more surgical with. Static assets have no executable bits worth preserving.
RSYNC_FLAGS := -rltvO --delete
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
