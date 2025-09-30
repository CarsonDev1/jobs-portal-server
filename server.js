import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

import pool from './config/database.js';

// Validate required environment variables early
function validateEnv() {
  const requiredVars = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'JWT_SECRET'
  ];

  const missing = requiredVars.filter((key) => !process.env[key] || String(process.env[key]).length === 0);
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }
}

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// Middleware
// Configure CORS via env variable CORS_ORIGIN
// - If CORS_ORIGIN is '*', allow all origins
// - If it's a comma-separated list, allow those origins
// - If omitted, allow all by default (development friendly)
const corsOrigin = process.env.CORS_ORIGIN;
let corsOptions = {};
if (!corsOrigin || corsOrigin === '*') {
  corsOptions = { origin: true };
} else {
  const allowedOrigins = corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  corsOptions = { origin: allowedOrigins };
}
app.use(cors(corsOptions));

// Add headers to allow mixed content
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json());

// Database initialization (create tables and default admin if missing)
async function initDatabase() {
  // Create admins table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create jobs table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      company VARCHAR(150) NOT NULL,
      location VARCHAR(100) NOT NULL,
      salary_min INTEGER,
      salary_max INTEGER,
      salary_currency VARCHAR(10) DEFAULT 'VND',
      job_type VARCHAR(50) DEFAULT 'Full-time',
      description TEXT NOT NULL,
      requirements TEXT,
      benefits TEXT,
      contact_email VARCHAR(100) NOT NULL,
      contact_phone VARCHAR(20),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default admin if not exists (password: admin123)
  await pool.query(
    `INSERT INTO admins (username, password, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO NOTHING`,
    [
      'admin',
      '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
      'admin@jobportal.com'
    ]
  );
}

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// ============= AUTH ROUTES =============
// Admin login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username và password là bắt buộc' });
    }

    const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Tài khoản không tồn tại' });
    }

    const admin = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, admin.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Mật khẩu không đúng' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Đăng nhập thành công',
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ message: 'Token hợp lệ', user: req.user });
});

// ============= PUBLIC ROUTES (User) =============
// Lấy tất cả jobs công khai (không cần đăng nhập)
app.get('/api/jobs', async (req, res) => {
  try {
    const { search, location, job_type } = req.query;

    const pageInt = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limitInt = Math.min(100, Math.max(1, parseInt(req.query.limit || '10', 10) || 10));
    const offset = (pageInt - 1) * limitInt;

    let query = `
      SELECT id, title, company, location, salary_min, salary_max, salary_currency, 
             job_type, description, requirements, benefits, contact_email, contact_phone, 
             created_at, updated_at
      FROM jobs 
      WHERE is_active = true
    `;
    let queryParams = [];
    let paramCount = 0;

    // Tìm kiếm theo tiêu đề hoặc công ty
    if (search) {
      paramCount++;
      query += ` AND (title ILIKE $${paramCount} OR company ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
    }

    // Lọc theo địa điểm
    if (location) {
      paramCount++;
      query += ` AND location ILIKE $${paramCount}`;
      queryParams.push(`%${location}%`);
    }

    // Lọc theo loại công việc
    if (job_type) {
      paramCount++;
      query += ` AND job_type = $${paramCount}`;
      queryParams.push(job_type);
    }

    query += ' ORDER BY created_at DESC';

    // Thêm pagination
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(limitInt);

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    const result = await pool.query(query, queryParams);

    // Đếm tổng số jobs để tính pagination
    let countQuery = 'SELECT COUNT(*) FROM jobs WHERE is_active = true';
    let countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND (title ILIKE $${countParamCount} OR company ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
    }

    if (location) {
      countParamCount++;
      countQuery += ` AND location ILIKE $${countParamCount}`;
      countParams.push(`%${location}%`);
    }

    if (job_type) {
      countParamCount++;
      countQuery += ` AND job_type = $${countParamCount}`;
      countParams.push(job_type);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalJobs = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalJobs / limitInt);

    res.json({
      jobs: result.rows,
      pagination: {
        currentPage: pageInt,
        totalPages,
        totalJobs,
        hasNext: pageInt < totalPages,
        hasPrev: pageInt > 1
      }
    });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Lấy chi tiết 1 job
app.get('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM jobs WHERE id = $1 AND is_active = true',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công việc' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get job detail error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ============= ADMIN ROUTES =============
// Lấy tất cả jobs (admin) - bao gồm cả inactive
app.get('/api/admin/jobs', authenticateToken, async (req, res) => {
  try {
    const { search } = req.query;
    const pageInt = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limitInt = Math.min(100, Math.max(1, parseInt(req.query.limit || '10', 10) || 10));
    const offset = (pageInt - 1) * limitInt;

    let query = 'SELECT * FROM jobs';
    let queryParams = [];

    if (search) {
      query += ' WHERE (title ILIKE $1 OR company ILIKE $1)';
      queryParams.push(`%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    queryParams.push(limitInt, offset);

    const result = await pool.query(query, queryParams);

    // Đếm tổng số
    let countQuery = 'SELECT COUNT(*) FROM jobs';
    let countParams = [];

    if (search) {
      countQuery += ' WHERE (title ILIKE $1 OR company ILIKE $1)';
      countParams.push(`%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalJobs = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalJobs / limitInt);

    res.json({
      jobs: result.rows,
      pagination: {
        currentPage: pageInt,
        totalPages,
        totalJobs
      }
    });
  } catch (error) {
    console.error('Admin get jobs error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Tạo job mới (admin)
app.post('/api/admin/jobs', authenticateToken, async (req, res) => {
  try {
    const {
      title, company, location, salary_min, salary_max, salary_currency,
      job_type, description, requirements, benefits, contact_email, contact_phone
    } = req.body;

    // Validate required fields
    if (!title || !company || !location || !description || !contact_email) {
      return res.status(400).json({
        message: 'Tiêu đề, công ty, địa điểm, mô tả và email liên hệ là bắt buộc'
      });
    }

    // Validate salary range
    if (salary_min !== null && salary_min !== undefined && salary_max !== null && salary_max !== undefined) {
      const minNum = Number(salary_min);
      const maxNum = Number(salary_max);
      if (!Number.isNaN(minNum) && !Number.isNaN(maxNum) && minNum > maxNum) {
        return res.status(400).json({ message: 'Lương tối thiểu không được lớn hơn lương tối đa' });
      }
    }

    const result = await pool.query(`
      INSERT INTO jobs (
        title, company, location, salary_min, salary_max, salary_currency,
        job_type, description, requirements, benefits, contact_email, contact_phone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      title, company, location, salary_min || null, salary_max || null,
      salary_currency || 'VND', job_type || 'Full-time', description,
      requirements || null, benefits || null, contact_email, contact_phone || null
    ]);

    res.status(201).json({
      message: 'Tạo công việc thành công',
      job: result.rows[0]
    });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Cập nhật job (admin)
app.put('/api/admin/jobs/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, company, location, salary_min, salary_max, salary_currency,
      job_type, description, requirements, benefits, contact_email, contact_phone, is_active
    } = req.body;

    // Validate required fields
    if (!title || !company || !location || !description || !contact_email) {
      return res.status(400).json({
        message: 'Tiêu đề, công ty, địa điểm, mô tả và email liên hệ là bắt buộc'
      });
    }

    // Validate salary range
    if (salary_min !== null && salary_min !== undefined && salary_max !== null && salary_max !== undefined) {
      const minNum = Number(salary_min);
      const maxNum = Number(salary_max);
      if (!Number.isNaN(minNum) && !Number.isNaN(maxNum) && minNum > maxNum) {
        return res.status(400).json({ message: 'Lương tối thiểu không được lớn hơn lương tối đa' });
      }
    }

    const result = await pool.query(`
      UPDATE jobs SET 
        title = $1, company = $2, location = $3, salary_min = $4, salary_max = $5,
        salary_currency = $6, job_type = $7, description = $8, requirements = $9,
        benefits = $10, contact_email = $11, contact_phone = $12, is_active = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `, [
      title, company, location, salary_min || null, salary_max || null,
      salary_currency || 'VND', job_type || 'Full-time', description,
      requirements || null, benefits || null, contact_email, contact_phone || null,
      is_active !== undefined ? is_active : true, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công việc' });
    }

    res.json({
      message: 'Cập nhật công việc thành công',
      job: result.rows[0]
    });
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Lấy chi tiết job (admin)
app.get('/api/admin/jobs/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công việc' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get job detail error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Xóa job (admin)
app.delete('/api/admin/jobs/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM jobs WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công việc' });
    }

    res.json({ message: 'Xóa công việc thành công' });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Toggle active status (admin)
app.patch('/api/admin/jobs/:id/toggle', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE jobs SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $1 RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công việc' });
    }

    res.json({
      message: `${result.rows[0].is_active ? 'Kích hoạt' : 'Vô hiệu hóa'} công việc thành công`,
      job: result.rows[0]
    });
  } catch (error) {
    console.error('Toggle job status error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ============= STATS ROUTES (Admin) =============
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    const totalJobs = await pool.query('SELECT COUNT(*) FROM jobs');
    const activeJobs = await pool.query('SELECT COUNT(*) FROM jobs WHERE is_active = true');
    const inactiveJobs = await pool.query('SELECT COUNT(*) FROM jobs WHERE is_active = false');

    // Jobs by type
    const jobsByType = await pool.query(`
      SELECT job_type, COUNT(*) as count 
      FROM jobs 
      WHERE is_active = true 
      GROUP BY job_type
    `);

    // Recent jobs
    const recentJobs = await pool.query(`
      SELECT id, title, company, created_at 
      FROM jobs 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    res.json({
      totalJobs: parseInt(totalJobs.rows[0].count),
      activeJobs: parseInt(activeJobs.rows[0].count),
      inactiveJobs: parseInt(inactiveJobs.rows[0].count),
      jobsByType: jobsByType.rows,
      recentJobs: recentJobs.rows
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

// Verify database connection before starting the server
(async () => {
  try {
    validateEnv();
    await pool.query('SELECT 1');
    console.log('Database connection successful');
    await initDatabase();
    console.log('Database initialized');

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
})();

export default app;