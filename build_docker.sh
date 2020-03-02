#!/usr/bin/env bash

build() {
  local short_sha
  local image

  short_sha=$(git rev-parse --short HEAD)
  image="hoopla/pdf-renderer:$short_sha"

  echo "Building image '$image'..."
  echo ""

  docker build -t "$image" .
}

build
