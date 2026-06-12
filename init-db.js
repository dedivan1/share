const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const db = new sqlite3.Database('./gamehub.db');

db.serialize(() => {
  // Таблицы
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    is_banned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    image_url TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS game_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    notes TEXT,
    is_enabled INTEGER DEFAULT 1,
    locked_until DATETIME,
    locked_by_user INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    granted_at DATETIME,
    expires_at DATETIME,
    ip TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(account_id) REFERENCES game_accounts(id)
  )`);

  // Создание администратора (admin/admin123)
  const hash = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)`, ['admin', hash, 'admin']);

  // Тестовый пользователь
  const userHash = bcrypt.hashSync('user123', 10);
  db.run(`INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)`, ['user', userHash, 'user']);

  // Тестовые игры
  db.run(`INSERT OR IGNORE INTO games (name, slug, description, image_url) VALUES 
    ('Cyberpunk 2077', 'cyberpunk-2077', 'Ролевой экшен от первого лица', 'https://placehold.co/400x200?text=Cyberpunk'),
    ('Red Dead Redemption 2', 'rdr2', 'Вестерн от Rockstar', 'https://placehold.co/400x200?text=RDR2'),
    ('The Witcher 3', 'witcher-3', 'Фэнтезийная RPG', 'https://placehold.co/400x200?text=Witcher3')
  `);

  // Тестовые аккаунты
  db.run(`INSERT OR IGNORE INTO game_accounts (game_id, username, password, notes) VALUES 
    (1, 'steam_user1', 'pass123', 'Использовать офлайн-режим Steam'),
    (1, 'steam_user2', 'pass456', 'Guard код: 12345'),
    (2, 'rdr_user1', 'pass789', 'Включить Family Mode'),
    (3, 'witcher_user', 'pass321', 'Готовая сохранка')
  `);
});

db.close(() => {
  console.log('Database initialized with test data');
  console.log('Admin: admin / admin123');
  console.log('User: user / user123');
});