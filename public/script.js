const API_BASE = '';
let currentUser = null;

function showModal(content) {
    const modal = document.getElementById('modal');
    document.getElementById('modal-body').innerHTML = content;
    modal.style.display = 'flex';
    document.querySelector('.close').onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}

async function apiFetch(url, options = {}) {
    const res = await fetch(API_BASE + url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers }
    });
    if (res.status === 401 && window.location.pathname !== '/login') {
        // не авторизован
    }
    return res;
}

async function checkAuth() {
    try {
        const res = await apiFetch('/api/auth/me');
        if (res.ok) {
            currentUser = await res.json();
        } else {
            currentUser = null;
        }
    } catch(e) { currentUser = null; }
    renderAuthButtons();
    if (currentUser) {
        loadGames();
        checkActiveAccount(); // новая проверка активного аккаунта
        if (currentUser.role === 'admin') loadAdminPanel();
    } else {
        document.getElementById('games-container').innerHTML = '<p>Пожалуйста, войдите или зарегистрируйтесь.</p>';
        document.getElementById('admin-panel').style.display = 'none';
        document.getElementById('active-account-banner')?.remove(); // убираем баннер
    }
}

// Новая функция: проверка активного аккаунта и отображение баннера
async function checkActiveAccount() {
    const res = await apiFetch('/api/account/active');
    if (!res.ok) return;
    const data = await res.json();
    const existingBanner = document.getElementById('active-account-banner');
    if (data.active) {
        if (!existingBanner) {
            const banner = document.createElement('div');
            banner.id = 'active-account-banner';
            banner.className = 'active-account-banner';
            banner.innerHTML = `
                <div class="banner-content">
                    <strong>🎮 Активный аккаунт:</strong> ${escapeHtml(data.game_name)} — 
                    <span class="account-creds">${escapeHtml(data.username)} / ${escapeHtml(data.password)}</span>
                    <span class="expires">⏱ до ${new Date(data.expires_at).toLocaleTimeString()}</span>
                    <button id="release-account-btn" class="btn-danger">🔓 Освободить сейчас</button>
                </div>
            `;
            const gamesContainer = document.getElementById('games-container');
            gamesContainer.parentNode.insertBefore(banner, gamesContainer);
            document.getElementById('release-account-btn').onclick = releaseAccount;
        } else {
            // обновим данные в баннере (например, время)
            const banner = existingBanner;
            banner.innerHTML = `
                <div class="banner-content">
                    <strong>🎮 Активный аккаунт:</strong> ${escapeHtml(data.game_name)} — 
                    <span class="account-creds">${escapeHtml(data.username)} / ${escapeHtml(data.password)}</span>
                    <span class="expires">⏱ до ${new Date(data.expires_at).toLocaleTimeString()}</span>
                    <button id="release-account-btn" class="btn-danger">🔓 Освободить сейчас</button>
                </div>
            `;
            document.getElementById('release-account-btn').onclick = releaseAccount;
        }
    } else {
        if (existingBanner) existingBanner.remove();
    }
}

async function releaseAccount() {
    const res = await apiFetch('/api/account/release', { method: 'POST' });
    if (res.ok) {
        alert('Аккаунт освобождён. Теперь можно запросить другой доступ.');
        await checkActiveAccount(); // скрыть баннер
        loadGames(); // обновить список игр (счётчики свободных)
        // если модалка открыта с данными аккаунта, закрыть её
        const modal = document.getElementById('modal');
        if (modal.style.display === 'flex') modal.style.display = 'none';
    } else {
        const err = await res.json();
        alert(err.error || 'Ошибка при освобождении');
    }
}

function renderAuthButtons() {
    const container = document.getElementById('auth-buttons');
    if (!currentUser) {
        container.innerHTML = `
            <button id="login-btn">Вход</button>
            <button id="register-btn">Регистрация</button>
        `;
        document.getElementById('login-btn')?.addEventListener('click', showLoginModal);
        document.getElementById('register-btn')?.addEventListener('click', showRegisterModal);
    } else {
        container.innerHTML = `
            <span>Привет, ${currentUser.username}</span>
            <button id="logout-btn">Выйти</button>
        `;
        document.getElementById('logout-btn')?.addEventListener('click', async () => {
            await apiFetch('/api/auth/logout', { method: 'POST' });
            currentUser = null;
            checkAuth();
        });
    }
}

function showLoginModal() {
    showModal(`
        <h2>Вход</h2>
        <input type="text" id="login-username" placeholder="Имя пользователя"><br>
        <input type="password" id="login-password" placeholder="Пароль"><br>
        <button id="do-login">Войти</button>
    `);
    document.getElementById('do-login').onclick = async () => {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const res = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        if (res.ok) {
            document.getElementById('modal').style.display = 'none';
            checkAuth();
        } else {
            alert('Ошибка входа');
        }
    };
}

function showRegisterModal() {
    showModal(`
        <h2>Регистрация</h2>
        <input type="text" id="reg-username" placeholder="Имя"><br>
        <input type="password" id="reg-password" placeholder="Пароль"><br>
        <button id="do-reg">Зарегистрироваться</button>
    `);
    document.getElementById('do-reg').onclick = async () => {
        const username = document.getElementById('reg-username').value;
        const password = document.getElementById('reg-password').value;
        const res = await apiFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        if (res.ok) {
            alert('Регистрация успешна, теперь войдите');
            document.getElementById('modal').style.display = 'none';
        } else {
            alert('Ошибка регистрации');
        }
    };
}

async function loadGames() {
    const res = await apiFetch('/api/games');
    if (!res.ok) return;
    const games = await res.json();
    const container = document.getElementById('games-container');
    container.innerHTML = '<div class="games-grid">' + games.map(game => `
        <div class="game-card">
            <div class="game-image">🎮</div>
            <div class="game-info">
                <h3>${escapeHtml(game.name)}</h3>
                <p>${escapeHtml(game.description || 'Без описания')}</p>
                <div class="game-stats">
                    <span>📊 Аккаунтов:</span>
                    <span><strong>${game.free_accounts}</strong> / ${game.total_accounts} свободно</span>
                </div>
                <button class="request-btn" data-game-id="${game.id}">🔓 Запросить доступ</button>
            </div>
        </div>
    `).join('') + '</div>';
    // Обработчики кнопок запроса
    document.querySelectorAll('.request-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const gameId = btn.dataset.gameId;
            const res = await apiFetch(`/api/games/${gameId}/request`, { method: 'POST' });
            if (res.status === 429) alert('У вас уже есть активный аккаунт!');
            else if (res.status === 404) alert('Нет свободных аккаунтов');
            else if (res.ok) {
                const data = await res.json();
                showModal(`
                    <h2>🎉 Доступ получен!</h2>
                    <div class="account-details">
                        <strong>Логин:</strong> ${escapeHtml(data.username)}<br>
                        <strong>Пароль:</strong> ${escapeHtml(data.password)}<br>
                        ${data.notes ? `<strong>Примечания:</strong> ${escapeHtml(data.notes)}<br>` : ''}
                        <strong>⏱ Действителен до:</strong> ${new Date(data.expires_at).toLocaleString()}
                    </div>
                    <button id="release-from-modal" class="btn-danger" style="margin-top: 16px; width: 100%;">Освободить аккаунт досрочно</button>
                    <small style="display: block; margin-top: 12px;">После нажатия кнопки вы сможете сразу запросить другой аккаунт.</small>
                `);
                // Обработчик кнопки освобождения внутри модального окна
                setTimeout(() => {
                    const releaseBtn = document.getElementById('release-from-modal');
                    if (releaseBtn) releaseBtn.onclick = async () => {
                        await releaseAccount();
                        const modal = document.getElementById('modal');
                        if (modal) modal.style.display = 'none';
                        checkActiveAccount();
                        loadGames();
                    };
                }, 100);
                await checkActiveAccount(); // обновить баннер (если его ещё нет, появится)
                loadGames(); // обновить счётчики
            } else {
                alert('Ошибка запроса');
            }
        });
    });
}

async function loadAdminPanel() {
    if (currentUser?.role !== 'admin') return;
    const container = document.getElementById('admin-panel');
    container.style.display = 'block';
    container.innerHTML = `
        <h2>🛠 Админ-панель</h2>
        <div class="admin-form">
            <h3>➕ Новая игра</h3>
            <input id="game-name" placeholder="Название"><input id="game-slug" placeholder="slug (уникальный)">
            <textarea id="game-desc" placeholder="Описание"></textarea>
            <button id="create-game" class="btn-primary">Создать</button>
        </div>
        <div class="admin-form">
            <h3>➕ Добавить аккаунт</h3>
            <select id="acc-game-id"></select><input id="acc-username" placeholder="Логин"><input id="acc-password" placeholder="Пароль">
            <textarea id="acc-notes" placeholder="Примечания"></textarea>
            <button id="create-account" class="btn-primary">Добавить</button>
        </div>
        <div class="admin-form">
            <h3>📋 Логи выдачи</h3>
            <div id="logs-table" style="overflow-x:auto;"></div>
        </div>
    `;
    const gamesRes = await apiFetch('/api/games');
    const games = await gamesRes.json();
    const select = document.getElementById('acc-game-id');
    select.innerHTML = games.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');

    document.getElementById('create-game').onclick = async () => {
        const name = document.getElementById('game-name').value;
        const slug = document.getElementById('game-slug').value;
        const description = document.getElementById('game-desc').value;
        await apiFetch('/api/admin/games', { method: 'POST', body: JSON.stringify({ name, slug, description }) });
        alert('Игра создана');
        loadGames();
        loadAdminPanel();
    };
    document.getElementById('create-account').onclick = async () => {
        const game_id = document.getElementById('acc-game-id').value;
        const username = document.getElementById('acc-username').value;
        const password = document.getElementById('acc-password').value;
        const notes = document.getElementById('acc-notes').value;
        await apiFetch('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ game_id, username, password, notes }) });
        alert('Аккаунт добавлен');
        loadGames();
        loadAdminPanel();
    };
    const logsRes = await apiFetch('/api/admin/logs');
    if (logsRes.ok) {
        const logs = await logsRes.json();
        document.getElementById('logs-table').innerHTML = `
            <table class="admin-table">
                <thead><tr><th>Игра</th><th>Аккаунт</th><th>Пользователь</th><th>Выдан</th><th>Истекает</th></tr></thead>
                <tbody>
                ${logs.map(l => `<tr><td>${escapeHtml(l.game_name)}</td><td>${escapeHtml(l.account_username)}</td><td>${escapeHtml(l.user_name)}</td><td>${new Date(l.granted_at).toLocaleString()}</td><td>${new Date(l.expires_at).toLocaleString()}</td></tr>`).join('')}
                </tbody>
            </table>
        `;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

checkAuth();