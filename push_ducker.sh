#!/usr/bin/env bash

push() {
  local short_sha
  local image

  short_sha=$(git rev-parse --short HEAD)
  image="hoopla/pdf-renderer:$short_sha"

  echo "Pushing image '$image'..."
  echo ""

  docker push "$image"
}

push
