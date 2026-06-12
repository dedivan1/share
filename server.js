const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'your_super_secret_key_change_me';

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Подключение к SQLite
const db = new sqlite3.Database('./gamehub.db');

// Вспомогательная функция для асинхронного запроса
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// Middleware проверки JWT
const authenticate = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await query('SELECT id, username, role, is_banned FROM users WHERE id = ?', [decoded.id]);
    if (!user.length || user[0].is_banned) throw new Error();
    req.user = user[0];
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

// ----- Аутентификация -----
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const existing = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length) return res.status(400).json({ error: 'Username exists' });
    const hash = await bcrypt.hash(password, 10);
    await run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, 'user']);
    res.json({ message: 'Registered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await query('SELECT * FROM users WHERE username = ?', [username]);
    if (!user.length || !(await bcrypt.compare(password, user[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user[0].is_banned) return res.status(403).json({ error: 'Account banned' });
    const token = jwt.sign({ id: user[0].id, username: user[0].username, role: user[0].role }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 86400000 });
    res.json({ message: 'Login success', role: user[0].role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// ----- Игры и аккаунты -----
// Получение списка игр со свободными аккаунтами
app.get('/api/games', authenticate, async (req, res) => {
  try {
    const games = await query('SELECT * FROM games WHERE is_active = 1 ORDER BY name');
    const now = Date.now();
    for (let game of games) {
      // Подсчёт свободных аккаунтов: общее количество минус заблокированные (locked_until > now)
      const accounts = await query('SELECT id, locked_until FROM game_accounts WHERE game_id = ? AND is_enabled = 1', [game.id]);
      let free = 0;
      for (let acc of accounts) {
        if (!acc.locked_until || new Date(acc.locked_until).getTime() < now) free++;
      }
      game.free_accounts = free;
      game.total_accounts = accounts.length;
    }
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Запрос доступа к игре
app.post('/api/games/:gameId/request', authenticate, async (req, res) => {
  const gameId = req.params.gameId;
  const userId = req.user.id;
  const now = new Date();
  const ttlMinutes = 30; // блокировка на 30 минут

  try {
    // 1. Проверяем, не заблокирован ли уже пользователь (есть активный аккаунт)
    const userActive = await query('SELECT id FROM game_accounts WHERE locked_by_user = ? AND locked_until > ?', [userId, now]);
    if (userActive.length) {
      return res.status(429).json({ error: 'You already have an active account. Wait until it expires.' });
    }

    // 2. Найти свободный аккаунт для этой игры (не заблокирован и is_enabled)
    const accounts = await query('SELECT * FROM game_accounts WHERE game_id = ? AND is_enabled = 1', [gameId]);
    const freeAccount = accounts.find(acc => !acc.locked_until || new Date(acc.locked_until).getTime() < now.getTime());
    if (!freeAccount) {
      return res.status(404).json({ error: 'No free accounts at the moment, try later' });
    }

    // 3. Заблокировать аккаунт
    const lockUntil = new Date(Date.now() + ttlMinutes * 60 * 1000);
    await run('UPDATE game_accounts SET locked_until = ?, locked_by_user = ? WHERE id = ?', [lockUntil.toISOString(), userId, freeAccount.id]);

    // 4. Записать лог
    await run('INSERT INTO access_logs (user_id, account_id, granted_at, expires_at) VALUES (?, ?, ?, ?)',
      [userId, freeAccount.id, now.toISOString(), lockUntil.toISOString()]);

    // 5. Вернуть данные аккаунта (в реальном проекте пароль шифровать)
    res.json({
      username: freeAccount.username,
      password: freeAccount.password,
      notes: freeAccount.notes,
      expires_at: lockUntil.toISOString()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ----- Админские функции -----
// Создать игру
app.post('/api/admin/games', authenticate, isAdmin, async (req, res) => {
  const { name, slug, description, image_url } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'Name and slug required' });
  try {
    await run('INSERT INTO games (name, slug, description, image_url) VALUES (?, ?, ?, ?)', [name, slug, description, image_url]);
    res.json({ message: 'Game created' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) res.status(400).json({ error: 'Slug already exists' });
    else res.status(500).json({ error: err.message });
  }
});

// Добавить аккаунт к игре
app.post('/api/admin/accounts', authenticate, isAdmin, async (req, res) => {
  const { game_id, username, password, notes } = req.body;
  if (!game_id || !username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    await run('INSERT INTO game_accounts (game_id, username, password, notes) VALUES (?, ?, ?, ?)', [game_id, username, password, notes]);
    res.json({ message: 'Account added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Снять блокировку принудительно
app.post('/api/admin/accounts/:id/release', authenticate, isAdmin, async (req, res) => {
  const accountId = req.params.id;
  try {
    await run('UPDATE game_accounts SET locked_until = NULL, locked_by_user = NULL WHERE id = ?', [accountId]);
    res.json({ message: 'Lock released' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Вспомогательная функция: получить активный аккаунт пользователя (если есть)
async function getUserActiveAccount(userId) {
    const now = new Date();
    const accounts = await query(`
        SELECT ga.*, g.name as game_name 
        FROM game_accounts ga
        JOIN games g ON ga.game_id = g.id
        WHERE ga.locked_by_user = ? AND ga.locked_until > ?
    `, [userId, now.toISOString()]);
    return accounts.length ? accounts[0] : null;
}

// Пользователь освобождает свой аккаунт досрочно
app.post('/api/account/release', authenticate, async (req, res) => {
    const userId = req.user.id;
    try {
        const active = await getUserActiveAccount(userId);
        if (!active) {
            return res.status(404).json({ error: 'У вас нет активного аккаунта' });
        }
        // Снимаем блокировку с аккаунта
        await run('UPDATE game_accounts SET locked_until = NULL, locked_by_user = NULL WHERE id = ?', [active.id]);
        // (Опционально) записать в лог досрочное освобождение, но для простоты не будем
        res.json({ message: 'Аккаунт освобождён. Теперь можно запросить новый доступ.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получение информации о текущем активном аккаунте пользователя (для отображения на фронте)
app.get('/api/account/active', authenticate, async (req, res) => {
    const userId = req.user.id;
    try {
        const active = await getUserActiveAccount(userId);
        if (!active) {
            return res.json({ active: false });
        }
        res.json({
            active: true,
            game_name: active.game_name,
            username: active.username,
            password: active.password,
            notes: active.notes,
            expires_at: active.locked_until
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Просмотр логов (админ)
app.get('/api/admin/logs', authenticate, isAdmin, async (req, res) => {
  try {
    const logs = await query(`
      SELECT l.*, u.username as user_name, ga.username as account_username, g.name as game_name
      FROM access_logs l
      JOIN users u ON l.user_id = u.id
      JOIN game_accounts ga ON l.account_id = ga.id
      JOIN games g ON ga.game_id = g.id
      ORDER BY l.granted_at DESC
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Фоновый процесс: раз в минуту снимаем просроченные блокировки
setInterval(async () => {
  const now = new Date();
  try {
    const result = await run('UPDATE game_accounts SET locked_until = NULL, locked_by_user = NULL WHERE locked_until < ?', [now.toISOString()]);
    if (result.changes > 0) console.log(`Released ${result.changes} expired locks`);
  } catch (err) {
    console.error('Background cleanup error:', err);
  }
}, 60000);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});