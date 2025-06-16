const db = require('./src/db');

console.log('Testing database connection...');

db.query('SELECT 1 as test')
  .then(result => {
    console.log('✅ Database connected successfully:', result);
    console.log('Testing migrations table...');
    return db.query('SELECT COUNT(*) as count FROM migrations');
  })
  .then(result => {
    console.log('✅ Migrations table accessible:', result);
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Database error:', err);
    process.exit(1);
  }); 