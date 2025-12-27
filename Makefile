.PHONY: install dev build lint lint-fix format type-check test clean clear package check

install:
	npm install

dev:
	npm run dev

build:
	npm run build

lint:
	npm run lint

lint-fix:
	npm run lint -- --fix

format:
	npm run format

type-check:
	npm run type-check || npm exec tsc --noEmit

test:
	npm run test

clean:
	rm -rf dist node_modules .vite

clear: clean

package: build
	sudo docker build -t kuack-agent .

check: format lint type-check test
