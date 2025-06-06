document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const shortcutButtonsContainer = document.getElementById('shortcutButtons');
    const remainingQuotaValueElement = document.getElementById('remainingQuotaValue');
    let lastUserMessageForAI = "";

    // ローディングアニメーション用のグローバル変数
    let loadingIntervalId = null;
    let loadingDots = 0;

    // よくある質問のショートカット定義
    const shortcuts = [
        { label: "料金は？", question: "レンタル料金について教えてください" },
        { label: "予約方法は？", question: "予約方法を教えてください" },
        { label: "車両の種類は？", question: "どんな車両がありますか？" },
        { label: "ペットOK？", question: "ペットは同伴できますか？" }
    ];

    // ショートカットボタンを生成する関数
    function createShortcutButtons() {
        if (!shortcutButtonsContainer) return;
        shortcutButtonsContainer.innerHTML = ''; // 既存のボタンをクリア
        shortcuts.forEach(shortcut => {
            const button = document.createElement('button');
            button.classList.add('shortcut-button');
            button.textContent = shortcut.label;
            button.addEventListener('click', () => {
                // ユーザーメッセージとして表示し、AIに質問を送信
                addMessageToChat(shortcut.question, 'user');
                lastUserMessageForAI = shortcut.question;
                sendMessage(shortcut.question, false); // AIに送信
                shortcutButtonsContainer.style.display = 'none'; // ボタンを隠す
            });
            shortcutButtonsContainer.appendChild(button);
        });
    }

    // API利用状況を取得・更新する関数
    async function fetchAndUpdateQuota() {
        try {
            const response = await fetch('/api/quota_status');
            if (!response.ok) {
                console.error('[SCRIPT.JS] 残り回数の取得に失敗:', response.status);
                if (remainingQuotaValueElement) remainingQuotaValueElement.textContent = '取得エラー';
                return;
            }
            const data = await response.json();
            if (remainingQuotaValueElement) {
                remainingQuotaValueElement.textContent = data.remaining;
            }
        } catch (error) {
            console.error('[SCRIPT.JS] 残り回数の取得中にエラー:', error);
            if (remainingQuotaValueElement) remainingQuotaValueElement.textContent = '表示エラー';
        }
    }

    // ページ読み込み時の初期化処理
    fetchAndUpdateQuota();
    createShortcutButtons();
    userInput.disabled = false;
    userInput.focus();

    // 送信ボタンの状態を更新する関数
    function updateSendButtonState() {
        sendButton.disabled = userInput.value.trim() === '';
    }

    userInput.addEventListener('input', updateSendButtonState);
    updateSendButtonState();

    sendButton.addEventListener('click', () => {
        if (!sendButton.disabled) {
            handleSendMessage();
        }
    });

    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !sendButton.disabled) {
            handleSendMessage();
        }
    });

    // メッセージ送信のハンドリング
    function handleSendMessage() {
        const messageText = userInput.value.trim();
        addMessageToChat(messageText, 'user');
        lastUserMessageForAI = messageText;
        sendMessage(messageText, false);
        shortcutButtonsContainer.style.display = 'none'; // メッセージ送信後もボタンを隠す
        userInput.value = '';
        updateSendButtonState();
    }

    // サーバーにメッセージを送信するメインの関数
    async function sendMessage(messageText, isForcedAI = false) {
        if (messageText === '') return;
        userInput.focus();

        const loadingMessageBaseText = 'キャン太が考えています';
        const loadingMessageElement = addMessageToChat(loadingMessageBaseText + '.', 'bot', true);
        loadingDots = 1;
        if (loadingIntervalId) clearInterval(loadingIntervalId);
        loadingIntervalId = setInterval(() => {
            loadingDots = (loadingDots % 3) + 1;
            let dotsString = '.'.repeat(loadingDots);
            if (loadingMessageElement && loadingMessageElement.isConnected) {
                const pElement = loadingMessageElement.querySelector('p');
                if (pElement) pElement.textContent = loadingMessageBaseText + dotsString;
            } else {
                if (loadingIntervalId) clearInterval(loadingIntervalId);
                loadingIntervalId = null;
            }
        }, 700);

        try {
            let forceAIForRequest = isForcedAI;
            if (!forceAIForRequest) {
                const keywordsForAI = ['詳しく', '詳細', 'aiで', 'エーアイで', 'もっと教えて', 'more', 'detail', 'ai', 'tell me more'];
                if (keywordsForAI.some(keyword => messageText.toLowerCase().includes(keyword))) {
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageText, forceAI: forceAIForRequest, userId: userId }),
            });

            if (loadingIntervalId) clearInterval(loadingIntervalId);
            loadingIntervalId = null;
            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);

            fetchAndUpdateQuota();
            const data = await response.json();

            if (!response.ok) {
                let friendlyErrorMessage = '申し訳ありません、AIとの通信中にエラーが発生しました。';
                if (data && data.reply) { // サーバーからのカスタムエラーメッセージを優先
                    friendlyErrorMessage = data.reply;
                } else if (data && data.error) {
                    friendlyErrorMessage += ` (詳細: ${data.error})`;
                }
                addMessageToChat(friendlyErrorMessage, 'bot');
                console.error('サーバーエラー:', response.status, data);
                return;
            }

            const botMessageElement = addMessageToChat(data.reply, 'bot');

            // FAQからの応答で、かつAIに聞き直していない場合に「AIにもっと詳しく聞く」ボタンを表示
            if (data.source === 'faq' && !isForcedAI) {
                const askAIButton = document.createElement('button');
                askAIButton.classList.add('ask-ai-button');
                askAIButton.textContent = 'AIにもっと詳しく聞く';
                askAIButton.addEventListener('click', () => {
                    sendMessage(lastUserMessageForAI, true); // 最後のユーザーメッセージをAIに強制送信
                    askAIButton.remove(); // ボタンを削除
                });
                botMessageElement.appendChild(askAIButton);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

        } catch (error) {
            if (loadingIntervalId) clearInterval(loadingIntervalId);
            loadingIntervalId = null;
            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);

            fetchAndUpdateQuota();
            console.error('通信エラー:', error);
            addMessageToChat('申し訳ありません、通信エラーが発生しました。ネットワーク接続を確認して再度お試しください。', 'bot');
        }
    }

    /**
     * チャットにメッセージを追加する関数
     * @param {string} text 表示するテキスト（HTMLを含む場合がある）
     * @param {string} sender 'user' または 'bot'
     * @param {boolean} isLoading ローディングメッセージかどうか
     * @returns {HTMLElement} 追加されたメッセージ要素
     */
    function addMessageToChat(text, sender, isLoading = false) {
        const messageId = isLoading ? `loading-${Date.now()}` : null;
        const messageElement = document.createElement('div');
        if (isLoading && messageId) {
            messageElement.id = messageId;
        }
        messageElement.classList.add('message', `${sender}-message`);
        if (isLoading) {
            messageElement.classList.add('loading-message');
        }

        const pElement = document.createElement('p');

        // ★★★★★ 修正点 ★★★★★
        // botからのメッセージはHTMLタグを解釈させるためinnerHTMLを使用
        if (sender === 'bot') {
            pElement.innerHTML = text;
        } else {
            pElement.textContent = text; // ユーザーの入力は安全のためtextContentを使用
        }
        // ★★★★★★★★★★★★★★★

        messageElement.appendChild(pElement);
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return messageElement;
    }

    // 特定のIDを持つメッセージをチャットから削除する関数
    function removeMessageFromChat(messageId) {
        if (messageId) {
            const messageToRemove = document.getElementById(messageId);
            if (messageToRemove) {
                messageToRemove.remove();
            }
        }
    }
});
