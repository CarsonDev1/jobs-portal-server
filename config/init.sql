-- Tạo database và tables
CREATE DATABASE job_portal;

-- Kết nối vào database job_portal và chạy các lệnh sau:

-- Bảng admin
CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bảng jobs
CREATE TABLE jobs (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    company VARCHAR(150) NOT NULL,
    location VARCHAR(100) NOT NULL,
    salary_min INTEGER,
    salary_max INTEGER,
    salary_currency VARCHAR(10) DEFAULT 'VND',
    job_type VARCHAR(50) DEFAULT 'Full-time', -- Full-time, Part-time, Contract, Internship
    description TEXT NOT NULL,
    requirements TEXT,
    benefits TEXT,
    contact_email VARCHAR(100) NOT NULL,
    contact_phone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tạo admin mặc định (password: admin123)
INSERT INTO admins (username, password, email) 
VALUES ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin@jobportal.com');