document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    // ★ 修正：残り回数の数値を表示する要素のIDを変更
    const shortcutButtonsContainer = document.getElementById('shortcutButtons'); // ★ 追加
    const remainingQuotaValueElement = document.getElementById('remainingQuotaValue');
    let lastUserMessageForAI = "";

    // ★ 追加：ローディングアニメーション用のグローバル変数
    let loadingIntervalId = null; // setIntervalのIDを保持
    let loadingDots = 0;          // ドットの数を管理

    // ★ よくある質問のショートカット定義
    const shortcuts = [
        { label: "料金は？", question: "レンタル料金について教えてください" },
        { label: "予約方法は？", question: "予約方法を教えてください" },
        { label: "車両の種類は？", question: "どんな車両がありますか？" },
        { label: "ペットOK？", question: "ペットは同伴できますか？" }
    ];

    // ★ ショートカットボタンを生成する関数
    function createShortcutButtons() {
        if (!shortcutButtonsContainer) return;
        shortcutButtonsContainer.innerHTML = ''; // 既存のボタンをクリア
        shortcuts.forEach(shortcut => {
            const button = document.createElement('button');
            button.classList.add('shortcut-button');
            button.textContent = shortcut.label;
            button.addEventListener('click', () => {
                // ユーザーメッセージとして表示し、AIに質問を送信
                addMessageToChat(shortcut.question, 'user'); // ユーザーが質問したかのように表示
                lastUserMessageForAI = shortcut.question; // AIに詳しく聞く用に保持
                sendMessage(shortcut.question, false); // AIに送信 (forceAIはfalseでFAQ検索を試みる)
                shortcutButtonsContainer.style.display = 'none'; // ボタンを一度隠す
            });
            shortcutButtonsContainer.appendChild(button);
        });
    }

    async function fetchAndUpdateQuota() {
        try {
            const response = await fetch('/api/quota_status');
            if (!response.ok) {
                console.error('[SCRIPT.JS] 残り回数の取得に失敗:', response.status);
                // ★ 修正：表示要素とテキストを変更
                if (remainingQuotaValueElement) remainingQuotaValueElement.textContent = '取得エラー';
                return;
            }
            const data = await response.json();
            // ★ 修正：数値のみを表示
            if (remainingQuotaValueElement) {
                remainingQuotaValueElement.textContent = data.remaining;
            }
        } catch (error) {
            console.error('[SCRIPT.JS] 残り回数の取得中にエラー:', error);
            // ★ 修正：表示要素とテキストを変更
            if (remainingQuotaValueElement) remainingQuotaValueElement.textContent = '表示エラー';
        }
    }

    // ★ ページ読み込み時
    fetchAndUpdateQuota();
    createShortcutButtons(); // ★ ショートカットボタンを生成
    userInput.disabled = false; // ★ 入力欄を有効化 (fetchAndUpdateQuotaの後など、API準備ができ次第)

    // ★ 送信ボタンの状態を更新する関数
    function updateSendButtonState() {
        if (userInput.value.trim() === '') {
            sendButton.disabled = true;
        } else {
            sendButton.disabled = false;
        }
    }

    // ★ 入力欄の入力イベントで送信ボタンの状態を更新
    userInput.addEventListener('input', updateSendButtonState);
    updateSendButtonState(); // 初期状態を設定

    sendButton.addEventListener('click', () => {
        sendMessage();
        shortcutButtonsContainer.style.display = 'none'; // メッセージ送信後もボタンを隠す
    });
    userInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter' && !sendButton.disabled) { // ★ disabledでないときのみ
            sendMessage();
            shortcutButtonsContainer.style.display = 'none'; // メッセージ送信後もボタンを隠す
        }
    });

    async function sendMessage(messageOverride = null, isForcedAI = false) {
        const messageText = messageOverride || userInput.value.trim();
        if (messageText === '') return;

        if (!messageOverride) { // 通常の送信時（ボタンクリックやEnter）のみユーザーメッセージとして表示
            addMessageToChat(messageText, 'user');
            lastUserMessageForAI = messageText;
        }
        userInput.value = '';
        updateSendButtonState(); // ★ 入力欄クリア後にボタン状態を更新
        userInput.focus();

        const loadingMessageBaseText = 'キャン太が考えています'; // 少し親しみやすく変更
        const loadingMessageElement = addMessageToChat(loadingMessageBaseText + '.', 'bot', true);
        loadingDots = 1;
        if (loadingIntervalId) clearInterval(loadingIntervalId);
        loadingIntervalId = setInterval(() => {
            loadingDots = (loadingDots % 3) + 1;
            let dotsString = '';
            for (let i = 0; i < loadingDots; i++) {
                dotsString += '.';
            }
            if (loadingMessageElement && loadingMessageElement.isConnected) {
                 const pElement = loadingMessageElement.querySelector('p');
                 if (pElement) pElement.textContent = loadingMessageBaseText + dotsString;
            } else {
                if (loadingIntervalId) clearInterval(loadingIntervalId);
                loadingIntervalId = null;
            }
        }, 700);

        try {
            let forceAIForRequest = isForcedAI; // ボタン経由の強制フラグを優先
            if (!forceAIForRequest) { // ボタン経由で強制されていない場合のみキーワードチェック
                const keywordsForAI = ['詳しく', '詳細', 'aiで', 'エーアイで', 'もっと教えて'];
                const keywordsForAI_EN = ['more', 'detail', 'ai', 'tell me more'];
                const combinedKeywords = keywordsForAI.concat(keywordsForAI_EN);
                if (combinedKeywords.some(keyword => messageText.toLowerCase().includes(keyword.toLowerCase()))) {
                    forceAIForRequest = true;
                }
            }
            
            let userId = localStorage.getItem('chatbotUserId');
            if (!userId) {
                userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                localStorage.setItem('chatbotUserId', userId);
            }

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ message: messageText, forceAI: forceAIForRequest, userId: userId }),
            });

            if (loadingIntervalId) clearInterval(loadingIntervalId);
            loadingIntervalId = null;
            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);

            fetchAndUpdateQuota(); // ★ メッセージ送受信後にも呼び出す
            const data = await response.json();

            if (!response.ok) {
                // ★ エラーメッセージの親切化
                let friendlyErrorMessage = '申し訳ありません、AIとの通信中にエラーが発生しました。';
                if (data && data.error) {
                    if (response.status === 429) { // API上限の場合
                        friendlyErrorMessage = data.reply || data.error; // サーバーからのメッセージを優先
                    } else {
                        friendlyErrorMessage += ` (エラーコード: ${response.status}) 詳細: ${data.error}`;
                    }
                } else if (response.statusText) {
                     friendlyErrorMessage += ` (${response.statusText})`;
                }
                addMessageToChat(friendlyErrorMessage, 'bot');
                console.error('サーバーエラー:', response.status, data);
                return;
            }

            const botMessageElement = addMessageToChat(data.reply, 'bot');

            if (data.source === 'faq' && botMessageElement && !isForcedAI) { // ★ isForcedAIがfalseの場合のみボタン表示
                const askAIButton = document.createElement('button');
                // ... (「AIにもっと詳しく聞く」ボタンのロジックは前回と同じ) ...
                askAIButton.classList.add('ask-ai-button');
                askAIButton.textContent = 'AIにもっと詳しく聞く';
                askAIButton.addEventListener('click', () => {
                    sendMessage(lastUserMessageForAI, true); // lastUserMessageForAI を使う
                    askAIButton.remove();
                });
                const pElement = botMessageElement.querySelector('p');
                if (pElement && pElement.parentNode === botMessageElement) {
                     botMessageElement.appendChild(askAIButton);
                } else {
                    botMessageElement.appendChild(askAIButton);
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

        } catch (error) {
            // ★ エラーメッセージの親切化
            if (loadingIntervalId) clearInterval(loadingIntervalId);
            loadingIntervalId = null;
            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);

            fetchAndUpdateQuota(); // ★ エラー時も呼び出す
            console.error('通信エラー:', error);
            addMessageToChat('申し訳ありません、通信エラーが発生しました。ネットワーク接続を確認して再度お試しください。', 'bot');
        }
    }

    function addMessageToChat(text, sender, isLoading = false) { /* ... (変更なし) ... */
        const messageId = isLoading ? `loading-${Date.now()}` : null;
        const messageElement = document.createElement('div');
        if (isLoading && messageId) {
            messageElement.id = messageId;
        }
        messageElement.classList.add('message');
        messageElement.classList.add(sender === 'user' ? 'user-message' : 'bot-message');
        if (isLoading) {
            messageElement.classList.add('loading-message');
        }

        const pElement = document.createElement('p');
        pElement.textContent = text;
        messageElement.appendChild(pElement);

        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return messageElement;
    }

    function removeMessageFromChat(messageId) { /* ... (変更なし) ... */
        if (messageId) {
            const messageToRemove = document.getElementById(messageId);
            if (messageToRemove) {
                messageToRemove.remove();
            }
        }
    }
});
