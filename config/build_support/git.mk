GIT_HOOKS_SRC := $(wildcard $(BUILD_SUPPORT)/git_hooks/*)
GIT_HOOKS := $(patsubst $(BUILD_SUPPORT)/git_hooks/%,.git/hooks/%,$(GIT_HOOKS_SRC))

.git/hooks:
	if [ -f $@ ]; then rm -f $@ ; fi
	if [ ! -d $@ ]; then mkdir -p $@ ; fi
.PHONY: .git/hooks

.git/hooks/%: $(BUILD_SUPPORT)/git_hooks/% .git/hooks
	cp $< $@

SETUP_TARGETS += $(GIT_HOOKS)

check-uncommitted: build
	@NL="$$(printf '\nz')" NL="$${NL%z}"\
		UNCOMMITTED="$$(git status --porcelain)"; [ -z "$$UNCOMMITTED" ]\
		|| ($(log_err) "There were uncommitted files after build!$$NL$$NL$$UNCOMMITTED" && false)
