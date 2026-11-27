#!/bin/sh
# Local development only. Runs once, when the MySQL data volume is first created.
#  - creates the test database
#  - gives the migration account full rights on it
#  - creates the runtime account used by the API, limited to reading and writing rows
set -eu

# These values are interpolated into SQL below, so accept only simple identifiers.
for value in "$MYSQL_DATABASE" "$MYSQL_USER" "$DB_TEST_NAME" "$DB_USER" "$DB_PASSWORD"; do
  case "$value" in
    '' | *[!A-Za-z0-9_]*)
      echo "init: database names, users and passwords may only contain letters, digits and underscores" >&2
      exit 1
      ;;
  esac
done

# Underscore is a wildcard in GRANT database patterns; escape it so grants match one database only.
escape() { printf '%s' "$1" | sed 's/_/\\_/g'; }
main_db=$(escape "$MYSQL_DATABASE")
test_db=$(escape "$DB_TEST_NAME")

mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_TEST_NAME\` CHARACTER SET utf8mb4;
GRANT ALL PRIVILEGES ON \`$test_db\`.* TO '$MYSQL_USER'@'%';
CREATE USER '$DB_USER'@'%' IDENTIFIED BY '$DB_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$main_db\`.* TO '$DB_USER'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$test_db\`.* TO '$DB_USER'@'%';
SQL
