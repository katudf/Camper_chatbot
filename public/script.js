document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const remainingQuotaElement = document.getElementById('remainingQuota');
    let lastUserMessageForAI = "";

    // ★ 追加：ローディングアニメーション用のグローバル変数
    let loadingIntervalId = null; // setIntervalのIDを保持
    let loadingDots = 0;          // ドットの数を管理

    // ... (fetchAndUpdateQuota 関数は変更なし) ...
    async function fetchAndUpdateQuota() {
        try {
            const response = await fetch('/api/quota_status');
            if (!response.ok) {
                console.error('[SCRIPT.JS] 残り回数の取得に失敗:', response.status);
                if (remainingQuotaElement) remainingQuotaElement.textContent = '取得失敗';
                return;
            }
            const data = await response.json();
            if (remainingQuotaElement) {
                remainingQuotaElement.textContent = data.remaining;
            }
        } catch (error) {
            console.error('[SCRIPT.JS] 残り回数の取得中にエラー:', error);
            if (remainingQuotaElement) remainingQuotaElement.textContent = 'エラー';
        }
    }
    fetchAndUpdateQuota();

    // ★ 修正: イベントリスナーのコールバックを修正
    sendButton.addEventListener('click', sendMessage); // sendMessage を直接渡す
    userInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            sendMessage(); // こちらは引数なしでOK (messageOverrideがnullになる)
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
        userInput.focus();

        const loadingMessageBaseText = 'お待ちください';
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

            fetchAndUpdateQuota();
            const data = await response.json();

            if (!response.ok) {
                addMessageToChat(`エラー: ${data.reply || data.error || response.statusText}`, 'bot');
                return;
            }

            const botMessageElement = addMessageToChat(data.reply, 'bot');

            if (data.source === 'faq' && botMessageElement && !isForcedAI) { // ★ isForcedAIがfalseの場合のみボタン表示
                const askAIButton = document.createElement('button');
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
            if (loadingIntervalId) clearInterval(loadingIntervalId);
            loadingIntervalId = null;
            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);

            fetchAndUpdateQuota();
            console.error('通信エラー:', error);
            addMessageToChat('エラー：AIとの通信に失敗しました。', 'bot');
        }
    }

    function addMessageToChat(text, sender, isLoading = false) {
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

    function removeMessageFromChat(messageId) {
        if (messageId) {
            const messageToRemove = document.getElementById(messageId);
            if (messageToRemove) {
                messageToRemove.remove();
            }
        }
    }
});
