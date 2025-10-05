import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
	host: process.env.DB_HOST,
	port: parseInt(process.env.DB_PORT || '5432', 10),
	database: process.env.DB_NAME,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
	console.log('Database pool connected');
});

pool.on('error', (err) => {
	console.error('Unexpected error on idle database client', err);
});

export default pool;
