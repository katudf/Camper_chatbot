// Firestore認証・集計・グラフ描画
// Firebase SDKの読み込みはエディタと同じ方式でOK

// Firebase Config（エディタと同じものを使う）
const firebaseConfig = {
  apiKey: "AIzaSyBy78-xFFOm1WozcEDYdU72sRjS_8Q5xF8",
  authDomain: "camper-chatbot-logs.firebaseapp.com",
  projectId: "camper-chatbot-logs",
  storageBucket: "camper-chatbot-logs.firebasestorage.app",
  messagingSenderId: "448817696051",
  appId: "1:448817696051:web:ed8edc31eac61dbb4c8246"
};

let db, auth;

window.addEventListener('DOMContentLoaded', () => {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();

    const loginContainer = document.getElementById('login-container');
    const dashboardContent = document.getElementById('dashboard-content');
    const loginButton = document.getElementById('login-button');
    const loginErrorP = document.getElementById('login-error');
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');

    auth.onAuthStateChanged(user => {
        if (user) {
            loginContainer.style.display = 'none';
            dashboardContent.style.display = 'block';
            loadAndRenderDashboard();
        } else {
            loginContainer.style.display = 'block';
            dashboardContent.style.display = 'none';
        }
    });

    loginButton.addEventListener('click', () => {
        loginErrorP.textContent = '';
        const email = loginEmailInput.value;
        const password = loginPasswordInput.value;
        if (!email || !password) {
            loginErrorP.textContent = 'メールアドレスとパスワードを入力してください。';
            return;
        }
        auth.signInWithEmailAndPassword(email, password)
            .catch(error => {
                loginErrorP.textContent = `ログインに失敗しました: ${error.code}`;
            });
    });
});

async function loadAndRenderDashboard() {
    // conversationsコレクション全件取得
    const snapshot = await db.collection('conversations').orderBy('timestamp', 'desc').limit(2000).get();
    const logs = snapshot.docs.map(doc => doc.data());
    renderFaqRanking(logs);
    renderHourlyChart(logs);
    renderDailyChart(logs);
    renderUnansweredList(logs);
}

function renderFaqRanking(logs) {
    // 質問文の出現回数ランキング
    const freq = {};
    logs.forEach(log => {
        const q = (log.question || '').trim();
        if (q) freq[q] = (freq[q] || 0) + 1;
    });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(x => x[0]);
    const data = sorted.map(x => x[1]);
    const ctx = document.getElementById('faqChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: '質問回数', data, backgroundColor: '#4e73df' }]
        },
        options: {
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true } }
        }
    });
}

function renderHourlyChart(logs) {
    // 時間帯別（0-23時）
    const hours = Array(24).fill(0);
    logs.forEach(log => {
        if (log.timestamp && log.timestamp.toDate) {
            const d = log.timestamp.toDate();
            hours[d.getHours()]++;
        } else if (log.timestamp && log.timestamp._seconds) {
            const d = new Date(log.timestamp._seconds * 1000);
            hours[d.getHours()]++;
        }
    });
    const ctx = document.getElementById('hourlyChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours.map((_, i) => `${i}時`),
            datasets: [{ label: '利用数', data: hours, backgroundColor: '#1cc88a', borderColor: '#1cc88a', fill: false }]
        },
        options: { plugins: { legend: { display: false } } }
    });
}

function renderDailyChart(logs) {
    // 日別
    const dayMap = {};
    logs.forEach(log => {
        let d;
        if (log.timestamp && log.timestamp.toDate) {
            d = log.timestamp.toDate();
        } else if (log.timestamp && log.timestamp._seconds) {
            d = new Date(log.timestamp._seconds * 1000);
        }
        if (d) {
            const key = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
            dayMap[key] = (dayMap[key] || 0) + 1;
        }
    });
    const sorted = Object.entries(dayMap).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    const labels = sorted.map(x => x[0]);
    const data = sorted.map(x => x[1]);
    const ctx = document.getElementById('dailyChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: '利用数', data, backgroundColor: '#36b9cc' }]
        },
        options: { plugins: { legend: { display: false } } }
    });
}

function renderUnansweredList(logs) {
    // AIがうまく答えられなかった質問（例: "わかりません" "お答えできません" などを含む回答）
    const ngWords = ['わかりません', 'お答えできません', '不明', '対応できません', '分かりません', 'できません'];
    const list = document.getElementById('unansweredList');
    const unanswered = logs.filter(log => {
        const a = (log.answer || '').trim();
        return ngWords.some(w => a.includes(w));
    });
    const freq = {};
    unanswered.forEach(log => {
        const q = (log.question || '').trim();
        if (q) freq[q] = (freq[q] || 0) + 1;
    });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    list.innerHTML = sorted.length ? sorted.map(x => `<li>${x[0]} <span style='color:#888'>(×${x[1]})</span></li>`).join('') : '<li>該当なし</li>';
}
