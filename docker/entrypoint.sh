#!/bin/sh
set -eu

if [ "${RUN_DATABASE_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying Local-Delivery database migrations..."
  ./node_modules/.bin/prisma migrate deploy --schema=./prisma/schema.prisma
fi

exec "$@"
