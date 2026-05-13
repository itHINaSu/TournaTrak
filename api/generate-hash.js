// One-time utility to generate a bcrypt hash for ADMIN_PASSWORD_HASH.
//
// Usage (inside the container):
//   docker compose run --rm api node generate-hash.js yourpassword
//
// Copy the output into compose.yml as ADMIN_PASSWORD_HASH.

const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node generate-hash.js <password>');
  process.exit(1);
}

bcrypt.hash(password, 12).then(hash => {
  console.log(hash);
});
