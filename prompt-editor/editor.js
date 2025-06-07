document.addEventListener('DOMContentLoaded', () => {

    // Firebase Configuration
    // この部分はあなたのFirebaseプロジェクトの設定情報に書き換えてください。
    const firebaseConfig = {
      apiKey: "AIzaSyBy78-xFFOm1WozcEDYdU72sRjS_8Q5xF8",
      authDomain: "camper-chatbot-logs.firebaseapp.com",
      projectId: "camper-chatbot-logs",
      storageBucket: "camper-chatbot-logs.firebasestorage.app",
      messagingSenderId: "448817696051",
      appId: "1:448817696051:web:ed8edc31eac61dbb4c8246"
    };
    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    // DOM Elements
    const loginContainer = document.getElementById('login-container');
    const editorContainer = document.getElementById('editor-container');
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const saveButton = document.getElementById('save-button');
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');
    const userEmailSpan = document.getElementById('user-email');
    const loginErrorP = document.getElementById('login-error');
    const saveStatusP = document.getElementById('save-status');
    const promptForm = document.getElementById('prompt-form');
    // ★★★★★ エクスポート機能関連のDOM要素を取得 ★★★★★
    const exportButton = document.getElementById('export-button');
    const exportStatusP = document.getElementById('export-status');
    // ★★★★★ 取得ここまで ★★★★★

    // バージョン履歴エリアのDOM取得
    const versionHistoryContainer = document.getElementById('version-history-container');
    const versionHistoryList = document.getElementById('version-history-list');

    // 各ドキュメントとHTML要素のIDのマッピングを更新
    const docFieldIds = {
        bot_personality: ['roleDescription', 'communicationPrinciples'],
        bot_control: ['inappropriateQuestionResponse', 'negativePrompt'],
        company_info: ['companyName', 'location', 'phone', 'businessHours', 'holidays', 'appealPoints', 'campaignInfo'],
        qna: ['qnaContent'],
        links: ['link_instagram', 'link_line', 'link_zil', 'link_crea', 'link_news', 'link_pricing', 'link_booking', 'link_checkoutFlow', 'link_checkinFlow', 'link_accidentResponse', 'link_terms', 'link_privacy'],
        vehicle_zil: ['vehicle_zil_features'],
        vehicle_crea: ['vehicle_crea_features'],
        vehicle_common: ['commonEquipment', 'otherEquipment'],
        pricing: ['pricing_notes', 'longTermDiscounts', 'cancellationPolicy', 'paymentMethods'],
        procedures: ['checkoutFlow', 'checkinFlow', 'usageManners', 'prohibitedItems', 'accidentResponse'],
        policies: ['termsContent', 'privacyPolicyContent'],
        preparation: ['essentialItems', 'convenientItems'],
        recommendations: ['overnightSpots']
    };


    // --- Authentication Logic (変更なし) ---
    auth.onAuthStateChanged(user => {
        if (user) {
            loginContainer.style.display = 'none';
            editorContainer.style.display = 'block';
            userEmailSpan.textContent = `ログイン中: ${user.email}`;
            loadPromptData();
            versionHistoryContainer.style.display = 'block';
            loadVersionHistory();
        } else {
            loginContainer.style.display = 'block';
            editorContainer.style.display = 'none';
            userEmailSpan.textContent = '';
            versionHistoryContainer.style.display = 'none';
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
                console.error("Login failed:", error);
            });
    });

    logoutButton.addEventListener('click', () => {
        auth.signOut();
    });

    // --- Firestore Data Handling Logic (変更なし) ---
    async function loadPromptData() {
        console.log("Loading prompt data from active prompt version (via API)...");
        try {
            // 新APIでアクティブバージョンとデータを取得
            const res = await fetch('/api/get_active_prompt_version');
            if (!res.ok) throw new Error('アクティブバージョンの取得に失敗しました');
            const data = await res.json();
            const promptData = data.promptData;
            if (!promptData) throw new Error('promptData が見つかりません');

            // 各フォームフィールドに値をセット
            for (const [docId, fieldIds] of Object.entries(docFieldIds)) {
                const docData = promptData[docId] || {};
                fieldIds.forEach(fieldId => {
                    const element = document.getElementById(fieldId);
                    if (element && docData[fieldId] !== undefined) {
                        element.value = docData[fieldId];
                    } else if (element) {
                        element.value = '';
                    }
                });
            }
            // アクティブバージョン表示
            const versionInfoDiv = document.getElementById('active-version-info');
            if (versionInfoDiv && data.version) {
                versionInfoDiv.textContent = `現在のアクティブバージョン: v${data.version}（${data.editor || '不明'}）`;
            }
            console.log("Prompt data loaded from active version.");
        } catch (error) {
            console.error("Error loading prompt data: ", error);
            alert("データの読み込み中にエラーが発生しました。コンソールを確認してください。");
        }
    }

    promptForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        saveStatusP.textContent = '保存中...';
        saveStatusP.className = 'status-message';
        saveButton.disabled = true;

        try {
            // すべてのフォーム値を集約
            const promptData = {};
            for (const [docId, fieldIds] of Object.entries(docFieldIds)) {
                promptData[docId] = {};
                fieldIds.forEach(fieldId => {
                    const element = document.getElementById(fieldId);
                    if (element) {
                        promptData[docId][fieldId] = element.value;
                    }
                });
            }
            // API経由で保存
            const res = await fetch('/api/save_prompt_version', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ promptData, editor: auth.currentUser ? auth.currentUser.email : 'unknown' })
            });
            if (!res.ok) throw new Error('サーバー保存に失敗しました');
            saveStatusP.textContent = '正常に保存されました！';
            saveStatusP.classList.add('success');
            loadVersionHistory(); // 保存後に履歴を更新
        } catch (error) {
            console.error("Error saving data: ", error);
            saveStatusP.textContent = '保存に失敗しました。コンソールを確認してください。';
            saveStatusP.classList.add('error');
        }

        saveButton.disabled = false;
        setTimeout(() => {
            saveStatusP.textContent = '';
            saveStatusP.className = 'status-message';
        }, 4000);
    });

    // ★★★★★ エクスポートボタンのクリックイベントを追加 ★★★★★
    exportButton.addEventListener('click', async () => {
        exportStatusP.textContent = 'エクスポート準備中...';
        exportStatusP.className = 'status-message';
        exportButton.disabled = true;

        try {
            const response = await fetch('/api/export_conversations');

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`サーバーエラー: ${response.status} - ${errorText}`);
            }

            // ファイルをBlobとして取得
            const blob = await response.blob();
            // ダウンロード用のリンクを生成
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            // ヘッダーからファイル名を取得、失敗したらデフォルト名
            const disposition = response.headers.get('content-disposition');
            let filename = 'conversation_history.csv';
            if (disposition && disposition.indexOf('attachment') !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                    filename = matches[1].replace(/['"]/g, '');
                }
            }
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            
            exportStatusP.textContent = 'エクスポートが完了しました。';
            exportStatusP.classList.add('success');

        } catch (error) {
            console.error("Error exporting data:", error);
            exportStatusP.textContent = `エクスポートに失敗しました: ${error.message}`;
            exportStatusP.classList.add('error');
        }

        exportButton.disabled = false;
        setTimeout(() => {
            exportStatusP.textContent = '';
            exportStatusP.className = 'status-message';
        }, 5000);
    });
    // ★★★★★ イベント追加ここまで ★★★★★

    // バージョン履歴を取得して表示
    async function loadVersionHistory() {
        versionHistoryList.innerHTML = '読み込み中...';
        try {
            const res = await fetch('/api/prompt_versions');
            if (!res.ok) throw new Error('バージョン履歴の取得に失敗しました');
            const data = await res.json();
            if (!data.versions || data.versions.length === 0) {
                versionHistoryList.innerHTML = '<p>バージョン履歴がありません。</p>';
                return;
            }
            versionHistoryList.innerHTML = '';
            data.versions.forEach(v => {
                const createdAt = v.createdAt && v.createdAt._seconds ?
                    new Date(v.createdAt._seconds * 1000).toLocaleString('ja-JP') : 'N/A';
                const item = document.createElement('div');
                item.className = 'version-history-item';
                item.innerHTML = `
                    <b>v${v.version}</b>（${createdAt}） 編集者: ${v.editor || '不明'}
                    <button data-version-id="${v.id}" class="restore-version-btn">このバージョンを復元</button>
                `;
                versionHistoryList.appendChild(item);
            });
            // 復元ボタンのイベント
            document.querySelectorAll('.restore-version-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const versionId = btn.getAttribute('data-version-id');
                    if (!confirm('このバージョンをアクティブにしますか？')) return;
                    btn.disabled = true;
                    btn.textContent = '復元中...';
                    try {
                        const res = await fetch('/api/activate_prompt_version', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ versionId })
                        });
                        if (!res.ok) throw new Error('復元に失敗しました');
                        alert('バージョンを復元し、アクティブ化しました。\nページを再読み込みしてください。');
                    } catch (err) {
                        alert('復元エラー: ' + err.message);
                    }
                    btn.disabled = false;
                    btn.textContent = 'このバージョンを復元';
                });
            });
        } catch (err) {
            versionHistoryList.innerHTML = `<span style="color:red;">${err.message}</span>`;
        }
    }

});
